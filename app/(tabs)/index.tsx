import { View, Text, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, Alert, Modal } from 'react-native';
import { router, Redirect, useFocusEffect } from 'expo-router';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/hooks/useAuth';
import { formatCurrency, formatRate, getFlag, getCountry, getCurrency } from '@/src/utils/format';
import { calculateTax } from '@/src/utils/math';
import { getSelectedPortfolioId, setSelectedPortfolioId } from '@/src/utils/portfolio-state';
import {
  TrendingUp, TrendingDown, Wallet, RefreshCw,
  ChevronDown, ArrowUpRight, ArrowDownRight,
  DollarSign, ArrowUpDown, Plus,
} from 'lucide-react-native';
import HoldingModal from '@/src/components/holding-modal';

// ─── Types ───
interface Portfolio {
  id: string; name: string; description?: string; user_id: string; holdings: Holding[];
}
interface Holding {
  id: string; ticker: string; name: string; quantity: number; avg_price: number;
  currency: string; country: string; portfolio_id: string;
}
interface PriceData {
  price: number; name?: string; change_amount?: number; change_percent?: number;
  last_updated?: string; error?: string;
}

type SortType = 'value' | 'profit' | 'name' | 'rate';

// ─── API Configuration ───
const VERCEL_API = process.env.EXPO_PUBLIC_YAHOO_API || 'https://yahoo-finance-api-seven.vercel.app';

// 다키엔 펀드 코드 패턴 (8자리 영문+숫자, 예: 9I312249, 4731925B)
const isJapaneseFund = (ticker: string) => /^[0-9A-Z]{8}$/i.test(ticker);

// ─── Data Fetching ───
const fetchPricesNew = async (tickers: string[]): Promise<Record<string, PriceData>> => {
  const map: Record<string, PriceData> = {};
  
  // 1. CASH 분리
  const cashTickers: string[] = [];
  const usTickers: string[] = []; // 미국주식 + VIX + 지표
  const jpTickers: string[] = []; // 일본 펀드
  const currencyTickers: string[] = []; // 환율

  tickers.forEach(tk => {
    if (tk.startsWith('CASH_')) cashTickers.push(tk);
    else if (isJapaneseFund(tk)) jpTickers.push(tk);
    else if (tk.endsWith('=X')) currencyTickers.push(tk);
    else usTickers.push(tk);
  });

  // 2. 미국/VIX (Vercel API) - 한 번에 묶어서 요청
  if (usTickers.length > 0) {
    const url = `${VERCEL_API}/quote?symbols=${usTickers.join(',')}`;
    console.log('[fetchPrices] US tickers:', usTickers);
    console.log('[fetchPrices] URL:', url);
    try {
      const res = await fetch(url);
      console.log('[fetchPrices] Status:', res.status, res.statusText);
      const text = await res.text();
      console.log('[fetchPrices] Response (first 500):', text.substring(0, 500));
      let json: any;
      try { json = JSON.parse(text); } catch {
        console.error('[fetchPrices] JSON parse failed. Response:', text.substring(0, 200));
      }
      if (json) {
        for (const [tk, info] of Object.entries(json)) {
          const i = info as any;
          if (i.price) {
            map[tk] = {
              price: i.price,
              name: i.symbol || tk,
              change_amount: i.change || 0,
              change_percent: i.changePercent || 0,
              last_updated: new Date().toISOString()
            };
          } else {
            console.warn('[fetchPrices] No price for', tk, JSON.stringify(info));
          }
        }
      }
    } catch (e: any) { console.error('[fetchPrices] Error:', e.message || e); }
  }

  // 3. 일본 펀드 (Supabase japan_funds 캐시에서 직접 읽기)
  if (jpTickers.length > 0) {
    try {
      const { data } = await supabase
        .from('japan_funds')
        .select('fcode, price_data')
        .in('fcode', jpTickers);

      if (data) {
        for (const fund of data) {
          const pd = fund.price_data;
          if (pd) {
            map[fund.fcode] = {
              price: pd.price,
              name: pd.name || fund.fcode,
              change_amount: pd.change_amount || 0,
              change_percent: pd.change_percent || 0,
              last_updated: pd.last_updated || new Date().toISOString()
            };
          }
        }
      }
    } catch (e) {
      console.error('JP fund cache read error', e);
    }
  }

  // 4. 환율/지표 (CORS 방지: Vercel API 경유)
  if (currencyTickers.length > 0) {
    const currRes = await fetch(`${VERCEL_API}/quote?symbols=${currencyTickers.join(',')}`);
    const currJson = await currRes.json();
    if (currJson) {
      for (const [tk, val] of Object.entries(currJson)) {
        const v = val as any;
        map[tk] = { price: v.price || 0, change_amount: v.change || 0, change_percent: v.changePercent || 0 };
      }
    }
  }

  // 5. CASH 처리
  cashTickers.forEach(tk => {
    const cur = tk.split('_')[1];
    map[tk] = { price: cur === 'KRW' ? 1 : 0, change_amount: 0, change_percent: 0 };
  });

  return map;
};

// 기존 호환성 alias
const fetchYahooPrices = fetchPricesNew;

// ─── Main Component ───
export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { session, loading: authLoading, signOut } = useAuth();
  
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedIdLocal] = useState<string | undefined>();
  const [dataLoading, setDataLoading] = useState(true);

  // Sync with shared state on mount and on app resume
  useEffect(() => {
    const syncState = async () => {
      const saved = await getSelectedPortfolioId();
      setSelectedIdLocal(saved || undefined);
    };
    syncState();
    
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') syncState();
    });
    return () => sub.remove();
  }, []);

  // Re-sync when tab gains focus (user switches from another tab)
  useFocusEffect(useCallback(() => {
    getSelectedPortfolioId().then(saved => {
      if (saved && saved !== selectedId) setSelectedIdLocal(saved);
    });
  }, [selectedId]));

  const setSelectedId = async (id: string | undefined) => {
    setSelectedIdLocal(id);
    await setSelectedPortfolioId(id || null);
  };
  const [priceMap, setPriceMap] = useState<Record<string, PriceData>>({});
  const [usdkrw, setUsdKrw] = useState(1400);
  const [jpykrw, setJpyKrw] = useState(9.5);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showPortfolioPicker, setShowPortfolioPicker] = useState(false);
  
  // New State for parity with dashboard
  const [sortBy, setSortBy] = useState<SortType>('value');
  const [isLocalCurrency, setIsLocalCurrency] = useState(false);
  const [showHoldingModal, setShowHoldingModal] = useState(false);
  const [editHolding, setEditHolding] = useState<any>(null);

  const loadDashboard = useCallback(async () => {
    if (!session) return;
    setDataLoading(true);
    setLoading(true);
    try {
      const { data: pData, error } = await supabase
        .from('portfolios').select('*, holdings(*)').eq('user_id', session.user.id);
      if (error || !pData) { console.error(error); setLoading(false); return; }
      setPortfolios(pData as Portfolio[]);

      const actId = selectedId || String(pData[0]?.id);
      if (!selectedId && pData.length > 0) setSelectedId(String(pData[0].id));
      
      const tickers = Array.from(new Set([...pData.flatMap(p => p.holdings.map((h: Holding) => h.ticker)), '^VIX', 'USDKRW=X', 'JPYKRW=X']));
      const prices = await fetchYahooPrices(tickers);
      setPriceMap(prices);
      setUsdKrw(prices['USDKRW=X']?.price || 1400);
      setJpyKrw(prices['JPYKRW=X']?.price || 9.5);
    } catch (e) { console.error(e); }
    setLoading(false);
    setDataLoading(false);
    setRefreshing(false);
  }, [session, selectedId]);
  useEffect(() => { if (session) loadDashboard(); }, [session, loadDashboard]);

  const onRefresh = useCallback(() => { setRefreshing(true); loadDashboard(); }, [loadDashboard]);

  // ─── Computing logic ───
  const processedData = useMemo(() => {
    const actId = selectedId || String(portfolios[0]?.id);
    const activePortfolios = portfolios.filter(p => String(p.id) === actId);
    
    let grandTotalKRW = 0, grandInitialKRW = 0, grandDayChangeKRW = 0;
    let usProfitKRW = 0, usValueKRW = 0;
    let jpProfitKRW = 0, jpValueKRW = 0;
    let krProfitKRW = 0, krValueKRW = 0;

    const result = activePortfolios.map(p => {
      let pTotal = 0, pInitial = 0, pDayChg = 0;
      const rows = p.holdings.map(h => {
        const mi = priceMap[h.ticker];
        const cp = mi?.price || h.avg_price;
        const rate = h.currency === 'USD' ? usdkrw : h.currency === 'JPY' ? jpykrw : 1;
        const isJpFund = h.country === 'JP' && (/^[0-9A-Z]{8}$/.test(h.ticker) || h.ticker === '9I312249');
        const isCash = h.ticker.startsWith('CASH_');
        const qty = isJpFund ? h.quantity / 10000 : h.quantity;
        // 현금은 원화 단위일 때 환율 적용 (USD/JPY 현금)
        const effRate = rate;
        
        const valueLocal = qty * cp;
        const initialLocal = qty * (isCash ? cp : h.avg_price);
        const vK = valueLocal * effRate; 
        const iK = initialLocal * effRate;
        const dChgK = (mi?.change_amount || 0) * qty * effRate;

        pTotal += vK; pInitial += iK; pDayChg += dChgK;

        // Categorize for tax calculation
        if (h.currency === 'USD') { usValueKRW += vK; usProfitKRW += (vK - iK); }
        else if (h.currency === 'JPY') { jpValueKRW += vK; jpProfitKRW += (vK - iK); }
        else { krValueKRW += vK; krProfitKRW += (vK - iK); }

        return { 
          ...h, 
          currentPrice: cp, 
          valueKRW: vK, 
          valueLocal,
          profitValueKRW: vK - iK, 
          profitRate: isCash ? 0 : ((cp - h.avg_price) / h.avg_price) * 100, 
          dayChangeKRW: dChgK, 
          dayChangePercent: mi?.change_percent || 0, 
          displayName: mi?.name || h.name || h.ticker, 
          flag: getFlag(h.country), 
          isFetchFailed: !mi || !!mi.error 
        };
      });

      // Sorting
      rows.sort((a, b) => {
        if (sortBy === 'value') return b.valueKRW - a.valueKRW;
        if (sortBy === 'profit') return b.profitValueKRW - a.profitValueKRW;
        if (sortBy === 'rate') return b.profitRate - a.profitRate;
        return a.displayName.localeCompare(b.displayName);
      });

      grandTotalKRW += pTotal; grandInitialKRW += pInitial; grandDayChangeKRW += pDayChg;
      return { ...p, rows, pTotal, pInitial, pDayChg };
    });

    const tax = calculateTax(usProfitKRW, 'USD');
    
    return {
      processed: result,
      totals: {
        grandTotalKRW,
        grandInitialKRW,
        grandDayChangeKRW,
        grandProfitKRW: grandTotalKRW - grandInitialKRW,
        grandProfitRate: grandInitialKRW > 0 ? ((grandTotalKRW - grandInitialKRW) / grandInitialKRW) * 100 : 0,
        dayChgRate: (grandTotalKRW - grandDayChangeKRW) !== 0 ? (grandDayChangeKRW / (grandTotalKRW - grandDayChangeKRW)) * 100 : 0,
        vix: priceMap['^VIX']?.price,
      },
      exitSimulation: {
        totalValue: grandTotalKRW,
        tax,
        netAmount: grandTotalKRW - tax,
        breakdown: { usValueKRW, usProfitKRW, krValueKRW, krProfitKRW, jpValueKRW, jpProfitKRW }
      }
    };
  }, [portfolios, selectedId, priceMap, usdkrw, jpykrw, sortBy]);

  if (authLoading) return <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#22c55e" /></View>;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (dataLoading && portfolios.length === 0) return <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#22c55e" /></View>;

  const { processed, totals, exitSimulation } = processedData;
  const tp = totals.grandProfitKRW >= 0;
  const dp = totals.grandDayChangeKRW >= 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b' }}>
      {/* 헤더 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: insets.top + 12, paddingBottom: 8 }}>
        <TouchableOpacity onPress={() => setShowPortfolioPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: '#e4e4e7' }}>{processed[0]?.name?.substring(0, 12) || '계좌'}</Text>
          <ChevronDown size={16} color="#71717a" />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <TouchableOpacity onPress={() => { setEditHolding(null); setShowHoldingModal(true); }} style={{ padding: 8, backgroundColor: '#22c55e', borderRadius: 8 }}>
            <Plus size={20} color="#052e16" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />} contentContainerStyle={{ padding: 16, paddingTop: 8 }}>
        {/* 요약 카드 */}
        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 2, marginBottom: 10 }}>TOTAL ASSET</Text>
          <Text style={{ fontSize: 32, fontWeight: '900', color: '#f4f4f5', letterSpacing: -1 }}>
            {isLocalCurrency ? formatCurrency(totals.grandTotalKRW / usdkrw, 'USD') : formatCurrency(totals.grandTotalKRW)}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
          <View style={{ flex: 1, backgroundColor: tp ? '#1a0a0a' : '#0a0a1a', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: tp ? '#7f1d1d' : '#1e3a5f' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              {tp ? <TrendingUp size={14} color="#ef4444" /> : <TrendingDown size={14} color="#3b82f6" />}
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1 }}>총 손익</Text>
            </View>
            <Text style={{ fontSize: 18, fontWeight: '900', color: tp ? '#ef4444' : '#3b82f6' }}>{tp ? '+' : ''}{formatCurrency(Math.abs(totals.grandProfitKRW))}</Text>
            <Text style={{ fontSize: 12, fontWeight: '800', color: tp ? '#ef4444' : '#3b82f6', marginTop: 2 }}>{formatRate(totals.grandProfitRate)}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: dp ? '#1a0a0a' : '#0a0a1a', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: dp ? '#7f1d1d' : '#1e3a5f' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              {dp ? <ArrowUpRight size={14} color="#ef4444" /> : <ArrowDownRight size={14} color="#3b82f6" />}
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1 }}>오늘</Text>
            </View>
            <Text style={{ fontSize: 18, fontWeight: '900', color: dp ? '#ef4444' : '#3b82f6' }}>{dp ? '+' : ''}{formatCurrency(Math.abs(totals.grandDayChangeKRW))}</Text>
            <Text style={{ fontSize: 12, fontWeight: '800', color: dp ? '#ef4444' : '#3b82f6', marginTop: 2 }}>{formatRate(totals.dayChgRate)}</Text>
          </View>
        </View>

        {/* 환율 & VIX */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
          <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#27272a' }}>
            <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 4 }}>USD/KRW</Text>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#e4e4e7' }}>{usdkrw.toFixed(2)}</Text>
          </View>
          {totals.vix && <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#27272a' }}>
            <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 4 }}>VIX</Text>
            <Text style={{ fontSize: 14, fontWeight: '800', color: totals.vix > 25 ? '#22c55e' : totals.vix < 15 ? '#ef4444' : '#e4e4e7' }}>{totals.vix.toFixed(2)}</Text>
          </View>}
        </View>

        {/* 판매 시뮬레이션 카드 */}
        <View style={{ backgroundColor: '#18181b', borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#27272a' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Wallet size={14} color="#71717a" />
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#71717a', letterSpacing: 1 }}>전량 매도 시 예상 금액</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text style={{ fontSize: 20, fontWeight: '900', color: '#22c55e' }}>{formatCurrency(exitSimulation.netAmount)}</Text>
              <Text style={{ fontSize: 11, color: '#52525b', marginTop: 4 }}>세금: -{formatCurrency(exitSimulation.tax)} (미국 22%)</Text>
            </View>
          </View>
        </View>

        {/* 정렬 셀렉터 */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1 }}>HOLDINGS · 길게눌러 수정</Text>
          <TouchableOpacity 
            onPress={() => {
              const types: SortType[] = ['value', 'profit', 'rate', 'name'];
              const next = types[(types.indexOf(sortBy) + 1) % types.length];
              setSortBy(next);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#18181b', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
          >
            <ArrowUpDown size={12} color="#71717a" />
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#71717a' }}>
              {sortBy === 'value' ? '가치순' : sortBy === 'profit' ? '수익순' : sortBy === 'rate' ? '수익률순' : '이름순'}
            </Text>
          </TouchableOpacity>
        </View>

        {processed.map(p => (
          <View key={p.id} style={{ marginBottom: 16 }}>
            {p.rows.map((h: any) => {
              const isPos = h.profitValueKRW >= 0;
              return (
                <TouchableOpacity
                  key={h.id}
                  onPress={() => router.push(`/stock/${encodeURIComponent(h.ticker)}`)}
                  onLongPress={() => { setEditHolding(h); setShowHoldingModal(true); }}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1e1e26' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <Text style={{ fontSize: 20, marginRight: 10 }}>{h.flag}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#e4e4e7' }} numberOfLines={1}>{h.displayName}</Text>
                      <Text style={{ fontSize: 11, color: '#52525b' }}>
                        {h.currency}
                        <Text style={{ color: '#71717a' }}> · 현재가: {isLocalCurrency ? formatCurrency(h.currentPrice, h.currency) : formatCurrency(h.currentPrice * (h.currency === 'USD' ? usdkrw : h.currency === 'JPY' ? jpykrw : 1), 'KRW')}</Text>
                      </Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#e4e4e7' }}>
                      {isLocalCurrency ? formatCurrency(h.valueLocal, h.currency) : formatCurrency(h.valueKRW)}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: isPos ? '#22c55e' : '#3b82f6' }}>{formatRate(h.profitRate)}</Text>
                      {isPos ? <TrendingUp size={10} color="#22c55e" /> : <TrendingDown size={10} color="#3b82f6" />}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* 포트폴리오 선택 모달 */}
      <Modal visible={showPortfolioPicker} transparent animationType="fade" onRequestClose={() => setShowPortfolioPicker(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setShowPortfolioPicker(false)}>
          <View style={{ backgroundColor: '#18181b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: 400 }} onStartShouldSetResponder={() => true}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#f4f4f5', marginBottom: 16 }}>계좌 선택</Text>
            {portfolios.map(p => (
              <TouchableOpacity key={p.id} onPress={() => { setSelectedId(String(p.id)); setShowPortfolioPicker(false); }} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#27272a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: String(p.id) === selectedId ? '#22c55e' : '#e4e4e7' }}>{p.name}</Text>
                {String(p.id) === selectedId && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setShowPortfolioPicker(false)} style={{ paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#52525b' }}>닫기</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Holdings 추가/수정 모달 */}
      <HoldingModal
        visible={showHoldingModal}
        onClose={() => { setShowHoldingModal(false); setEditHolding(null); }}
        portfolioId={selectedId || portfolios[0]?.id || ''}
        holdingId={editHolding?.id}
        initialData={editHolding ? { ...editHolding, avg_price: editHolding.avg_price } : undefined}
        onSuccess={() => { loadDashboard(); }}
      />
    </View>
  );
}
