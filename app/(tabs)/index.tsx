import { View, Text, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, Alert, Modal } from 'react-native';
import { router, Redirect } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/hooks/useAuth';
import { formatCurrency, formatRate, getFlag, getCountry, getCurrency } from '@/src/utils/format';
import {
  TrendingUp, TrendingDown, Wallet, RefreshCw,
  MoreHorizontal, LogOut, ChevronDown, ChevronUp,
  ArrowUpRight, ArrowDownRight, Eye, DollarSign
} from 'lucide-react-native';

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

// ─── Yahoo Finance ───
const fetchYahooPrices = async (tickers: string[]): Promise<Record<string, PriceData>> => {
  const map: Record<string, PriceData> = {};
  const promises = tickers.map(async (tk) => {
    try {
      if (tk.startsWith('CASH_')) {
        const cur = tk.split('_')[1];
        return [tk, { price: cur === 'KRW' ? 1 : 0, change_amount: 0, change_percent: 0 }] as [string, PriceData];
      }
      if (tk.includes('=') || tk === '^VIX') {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${tk}?interval=1d&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const json = await res.json();
        const m = json?.chart?.result?.[0]?.meta;
        return [tk, m ? { price: m.regularMarketPrice || 0, name: m.symbol, change_amount: m.regularMarketChange || 0, change_percent: m.regularMarketChangePercent || 0, last_updated: new Date(m.regularMarketTime * 1000).toISOString() } : { price: 0, error: 'No data' }] as [string, PriceData];
      }
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${tk}?interval=1d&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const json = await res.json();
      const m = json?.chart?.result?.[0]?.meta;
      return [tk, m ? { price: m.regularMarketPrice || 0, name: m.symbol, change_amount: m.regularMarketChange || 0, change_percent: m.regularMarketChangePercent || 0, last_updated: new Date(m.regularMarketTime * 1000).toISOString() } : { price: 0, error: 'No data' }] as [string, PriceData];
    } catch { return [tk, { price: 0, error: 'fetch failed' }] as [string, PriceData]; }
  });
  const results = await Promise.all(promises) as [string, PriceData][];
  results.forEach(([k, v]) => { map[k] = v; });
  return map;
};

// ─── Main Component ───
export default function DashboardScreen() {
  const { session, signOut } = useAuth();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [priceMap, setPriceMap] = useState<Record<string, PriceData>>({});
  const [usdkrw, setUsdKrw] = useState(1400);
  const [jpykrw, setJpyKrw] = useState(9.5);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showPortfolioPicker, setShowPortfolioPicker] = useState(false);

  // 인증 체크
  if (!session) return <Redirect href="/(auth)/login" />;

  const loadDashboard = async () => {
    setLoading(true);
    try {
      // 포트폴리오
      const { data: pData, error } = await supabase
        .from('portfolios').select('*, holdings(*)').eq('user_id', session.user.id);
      if (error || !pData) { console.error(error); setLoading(false); return; }
      setPortfolios(pData as Portfolio[]);

      const actId = selectedId || String(pData[0]?.id);
      if (!selectedId && pData.length > 0) setSelectedId(String(pData[0].id));
      const actPortfolios = pData.filter(p => String(p.id) === actId);
      const tickers = Array.from(new Set([...actPortfolios.flatMap(p => p.holdings.map((h: Holding) => h.ticker)), '^VIX', 'USDKRW=X', 'JPYKRW=X']));

      const prices = await fetchYahooPrices(tickers);
      setPriceMap(prices);
      setUsdKrw(prices['USDKRW=X']?.price || 1400);
      setJpyKrw(prices['JPYKRW=X']?.price || 9.5);
    } catch (e) { console.error(e); }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { loadDashboard(); }, []);
  useEffect(() => { if (selectedId) loadDashboard(); }, [selectedId]);

  const onRefresh = useCallback(() => { setRefreshing(true); loadDashboard(); }, []);

  const handleSignOut = async () => {
    Alert.alert('로그아웃', '정말 로그아웃하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: async () => { const { error } = await signOut(); if (!error) router.replace('/(auth)/login'); } },
    ]);
  };

  // 데이터 처리
  const actId = selectedId || String(portfolios[0]?.id);
  const actPortfolios = portfolios.filter(p => String(p.id) === actId);
  const actPortfolio = actPortfolios[0];

  if (!actPortfolio && !loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 3, marginBottom: 12 }}>NO ACCOUNTS LINKED</Text>
        <Text style={{ fontSize: 14, color: '#71717a' }}>웹에서 계좌를 추가하세요</Text>
      </View>
    );
  }
  if (loading) return <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#22c55e" /></View>;

  // ── 계산 ──
  let grandTotalKRW = 0, grandInitialKRW = 0, grandDayChangeKRW = 0;
  const processed = actPortfolios.map(p => {
    let pTotal = 0, pInitial = 0, pDayChg = 0;
    const rows = p.holdings.map(h => {
      const mi = priceMap[h.ticker];
      const cp = mi?.price || h.avg_price;
      const rate = h.currency === 'USD' ? usdkrw : h.currency === 'JPY' ? jpykrw : 1;
      const isJpFund = h.country === 'JP' && (/^[0-9A-Z]{8}$/.test(h.ticker) || h.ticker === '9I312249');
      const isCash = h.ticker.startsWith('CASH_');
      const qty = isJpFund ? h.quantity / 10000 : h.quantity;
      const effRate = isCash ? 1 : rate;
      const vL = qty * cp;
      const effAvg = isCash ? cp : h.avg_price;
      const iL = qty * effAvg;
      const vK = vL * effRate; const iK = iL * effRate;
      const dChg = (mi?.change_amount || 0) * qty * effRate;
      pTotal += vK; pInitial += iK; pDayChg += dChg;
      return { ...h, currentPrice: cp, valueKRW: vK, profitValueKRW: vK - iK, profitRate: isCash ? 0 : ((cp - h.avg_price) / h.avg_price) * 100, dayChangeKRW: dChg, dayChangePercent: mi?.change_percent || 0, displayName: mi?.name || h.name || h.ticker, flag: getFlag(h.country), isFetchFailed: !mi || !!mi.error };
    });
    grandTotalKRW += pTotal; grandInitialKRW += pInitial; grandDayChangeKRW += pDayChg;
    return { ...p, rows, pTotal, pInitial, pDayChg };
  });

  const totalProfit = grandTotalKRW - grandInitialKRW;
  const totalProfitRate = grandInitialKRW > 0 ? (totalProfit / grandInitialKRW) * 100 : 0;
  const dayChgRate = (grandTotalKRW - grandDayChangeKRW) !== 0 ? (grandDayChangeKRW / (grandTotalKRW - grandDayChangeKRW)) * 100 : 0;
  const vixVal = priceMap['^VIX']?.price;
  const tp = totalProfit >= 0;
  const dp = grandDayChangeKRW >= 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b' }}>
      {/* 헤더 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <TouchableOpacity onPress={() => setShowPortfolioPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: '#e4e4e7' }}>{actPortfolio?.name?.substring(0, 12) || '계좌'}</Text>
          <ChevronDown size={16} color="#71717a" />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <TouchableOpacity onPress={onRefresh} style={{ padding: 8 }}>
            <RefreshCw size={20} color="#71717a" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSignOut} style={{ padding: 8 }}>
            <LogOut size={20} color="#71717a" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />} contentContainerStyle={{ padding: 16, paddingTop: 8 }}>
        {/* 요약 카드 */}
        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 2, marginBottom: 10 }}>TOTAL ASSET</Text>
          <Text style={{ fontSize: 32, fontWeight: '900', color: '#f4f4f5', letterSpacing: -1 }}>{formatCurrency(grandTotalKRW)}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
          {/* 총 손익 */}
          <View style={{ flex: 1, backgroundColor: tp ? '#1a0a0a' : '#0a0a1a', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: tp ? '#7f1d1d' : '#1e3a5f' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              {tp ? <TrendingUp size={14} color="#ef4444" /> : <TrendingDown size={14} color="#3b82f6" />}
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1 }}>총 손익</Text>
            </View>
            <Text style={{ fontSize: 18, fontWeight: '900', color: tp ? '#ef4444' : '#3b82f6' }}>{tp ? '+' : ''}{formatCurrency(Math.abs(totalProfit))}</Text>
            <Text style={{ fontSize: 12, fontWeight: '800', color: tp ? '#ef4444' : '#3b82f6', marginTop: 2 }}>{formatRate(totalProfitRate)}</Text>
          </View>
          {/* 일일 변동 */}
          <View style={{ flex: 1, backgroundColor: dp ? '#1a0a0a' : '#0a0a1a', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: dp ? '#7f1d1d' : '#1e3a5f' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              {dp ? <ArrowUpRight size={14} color="#ef4444" /> : <ArrowDownRight size={14} color="#3b82f6" />}
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1 }}>오늘</Text>
            </View>
            <Text style={{ fontSize: 18, fontWeight: '900', color: dp ? '#ef4444' : '#3b82f6' }}>{dp ? '+' : ''}{formatCurrency(Math.abs(grandDayChangeKRW))}</Text>
            <Text style={{ fontSize: 12, fontWeight: '800', color: dp ? '#ef4444' : '#3b82f6', marginTop: 2 }}>{formatRate(dayChgRate)}</Text>
          </View>
        </View>

        {/* 환율 & VIX */}
        {(usdkrw || vixVal) && (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            {usdkrw > 0 && <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#27272a' }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 4 }}>USD/KRW</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#e4e4e7' }}>{usdkrw.toFixed(2)}</Text>
            </View>}
            {jpykrw > 0 && <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#27272a' }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 4 }}>JPY/KRW</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#e4e4e7' }}>{jpykrw.toFixed(4)}</Text>
            </View>}
            {vixVal && <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#27272a' }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 4 }}>VIX</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: vixVal > 25 ? '#22c55e' : vixVal < 15 ? '#ef4444' : '#e4e4e7' }}>{vixVal.toFixed(2)}</Text>
            </View>}
          </View>
        )}

        {/* 종목 목록 */}
        {processed.map(p => {
          const pProfit = p.pTotal - p.pInitial;
          const pProfitRate = p.pInitial > 0 ? (pProfit / p.pInitial) * 100 : 0;
          const pIsPos = pProfit >= 0;

          return (
            <View key={p.id} style={{ marginBottom: 16 }}>
              {/* 포트폴리오 요약 */}
              <View style={{ backgroundColor: '#18181b', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#27272a' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ fontSize: 8, fontWeight: '900', color: '#52525b', letterSpacing: 2 }}>{p.name.toUpperCase()}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: '#e4e4e7', marginTop: 2 }}>{formatCurrency(p.pTotal)}</Text>
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: '900', color: pIsPos ? '#ef4444' : '#3b82f6' }}>
                    {pIsPos ? '+' : ''}{formatCurrency(Math.abs(pProfit))} ({formatRate(pProfitRate)})
                  </Text>
                </View>
              </View>

              {/* 종목 행 */}
              {p.rows.map((h: any) => {
                const isPos = h.profitValueKRW >= 0;
                const country = getCountry(h.ticker) || h.country;
                const currency = h.currency || getCurrency(country);
                return (
                  <TouchableOpacity
                    key={h.id}
                    onPress={() => router.push(`/stock/${encodeURIComponent(h.ticker)}`)}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1e1e26' }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <Text style={{ fontSize: 20, marginRight: 10 }}>{h.flag}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#e4e4e7' }} numberOfLines={1}>{h.displayName}</Text>
                        <Text style={{ fontSize: 11, color: '#52525b' }}>{h.ticker} · {currency}</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#e4e4e7' }}>{formatCurrency(h.valueKRW)}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: isPos ? '#22c55e' : '#3b82f6' }}>{formatRate(h.profitRate)}</Text>
                        {!isPos && <TrendingDown size={10} color="#3b82f6" />}
                        {isPos && <TrendingUp size={10} color="#22c55e" />}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* 포트폴리오 선택 모달 */}
      <Modal visible={showPortfolioPicker} transparent animationType="fade" onRequestClose={() => setShowPortfolioPicker(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setShowPortfolioPicker(false)}>
          <View style={{ backgroundColor: '#18181b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: 400 }} onStartShouldSetResponder={() => true}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#f4f4f5', marginBottom: 16 }}>계좌 선택</Text>
            {portfolios.map(p => (
              <TouchableOpacity key={p.id} onPress={() => { setSelectedId(String(p.id)); setShowPortfolioPicker(false); }} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#27272a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: String(p.id) === actId ? '#22c55e' : '#e4e4e7' }}>{p.name}</Text>
                {String(p.id) === actId && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setShowPortfolioPicker(false)} style={{ paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#52525b' }}>닫기</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
