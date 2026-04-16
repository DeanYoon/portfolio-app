import { View, Text, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, Alert, Modal, Animated, Easing, TextInput } from 'react-native';
import { router, Redirect, useFocusEffect } from 'expo-router';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/hooks/useAuth';
import { formatCurrency, formatRate, getFlag, getCountry, getCurrency } from '@/src/utils/format';
import { calculateTax } from '@/src/utils/math';
import { getSelectedPortfolioId, setSelectedPortfolioId } from '@/src/utils/portfolio-state';
import { getHoldings } from '@/src/utils/holdings-cache';
import {
  TrendingUp, TrendingDown, Wallet, RefreshCw,
  ChevronDown, ArrowUpRight, ArrowDownRight,
  DollarSign, ArrowUpDown, Plus, X
} from 'lucide-react-native';
import HoldingModal from '@/src/components/holding-modal';

// ─── Types ───
interface Portfolio {
  id: string; 
  name: string; 
  description?: string; 
  user_id: string; 
  holdings: Holding[];
  avg_usd_krw_rate?: number;
}
interface Holding {
  id: string; ticker: string; name: string; quantity: number; avg_price: number;
  currency: string; country: string; portfolio_id: string;
}
interface PriceData {
  price: number; name?: string; change_amount?: number; change_percent?: number;
  previous_close?: number;
  last_updated?: string; error?: string;
}

type SortType = 'value' | 'profit' | 'name' | 'rate';

// ─── Constants ───
const VERCEL_API = process.env.EXPO_PUBLIC_YAHOO_API || 'https://yahoo-finance-api-seven.vercel.app';

// ─── Skeleton Component ───
const Skeleton = ({ width, height, borderRadius = 8, marginBottom = 0, style = {} }: any) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          backgroundColor: '#27272a',
          borderRadius,
          marginBottom,
          opacity,
        },
        style,
      ]}
    />
  );
};

const DashboardSkeleton = ({ insets }: { insets: any }) => (
  <View style={{ flex: 1, backgroundColor: '#09090b', paddingHorizontal: 16, paddingTop: insets.top + 60 }}>
    <Skeleton width={100} height={12} marginBottom={12} />
    <Skeleton width={220} height={40} marginBottom={24} />
    
    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
      <Skeleton width="48.5%" height={80} borderRadius={16} />
      <Skeleton width="48.5%" height={80} borderRadius={16} />
    </View>

    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
      <Skeleton width="48.5%" height={50} borderRadius={12} />
      <Skeleton width="48.5%" height={50} borderRadius={12} />
    </View>

    <Skeleton width="100%" height={70} borderRadius={16} marginBottom={24} />

    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
      <Skeleton width={120} height={12} />
      <Skeleton width={80} height={24} borderRadius={8} />
    </View>

    {[1, 2, 3, 4, 5].map((i) => (
      <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1e1e26' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Skeleton width={32} height={32} borderRadius={16} style={{ marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Skeleton width="60%" height={14} marginBottom={6} />
            <Skeleton width="40%" height={10} />
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Skeleton width={80} height={14} marginBottom={6} />
          <Skeleton width={60} height={10} />
        </View>
      </View>
    ))}
  </View>
);

const isJapaneseFund = (ticker: string) => /^[0-9A-Z]{8}$/i.test(ticker);

const fetchPricesNew = async (tickers: string[]): Promise<Record<string, PriceData>> => {
  const map: Record<string, PriceData> = {};
  const cashTickers: string[] = [];
  const yahooTickers: string[] = []; 
  const jpTickers: string[] = [];

  tickers.forEach(tk => {
    if (tk.startsWith('CASH_')) cashTickers.push(tk);
    else if (isJapaneseFund(tk)) jpTickers.push(tk);
    else yahooTickers.push(tk);
  });

  // 1. Yahoo tickers integration (Stocks, VIX, FX)
  if (yahooTickers.length > 0) {
    try {
      const res = await fetch(`${VERCEL_API}/quote?symbols=${yahooTickers.join(',')}`);
      const json = await res.json();
      if (json) {
        for (const [tk, info] of Object.entries(json)) {
          const i = info as any;
          if (i.price !== undefined) {
            map[tk] = { 
              price: i.price, 
              name: i.symbol || tk, 
              change_amount: i.change || 0, 
              change_percent: i.changePercent || 0, 
              previous_close: i.previousClose,
              last_updated: new Date().toISOString() 
            };
          }
        }
      }
    } catch (e) { console.error('Yahoo fetch error:', e); }
  }

  // 2. Japan Funds (Supabase Cache)
  if (jpTickers.length > 0) {
    try {
      const { data } = await supabase.from('japan_funds').select('fcode, price_data').in('fcode', jpTickers);
      if (data) {
        for (const fund of data) {
          const pd = fund.price_data;
          if (pd) map[fund.fcode] = { price: pd.price, name: pd.name || fund.fcode, change_amount: pd.change_amount || 0, change_percent: pd.change_percent || 0, last_updated: pd.last_updated || new Date().toISOString() };
        }
      }
    } catch (e) { console.error('JP Cache error:', e); }
  }

  // 3. Cash
  cashTickers.forEach(tk => {
    const cur = tk.split('_')[1];
    map[tk] = { price: cur === 'KRW' ? 1 : 0, change_amount: 0, change_percent: 0 };
  });

  return map;
};

const fetchYahooPrices = fetchPricesNew;

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { session, loading: authLoading } = useAuth();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedIdLocal] = useState<string | undefined>();
  const [dataLoading, setDataLoading] = useState(true);
  const [priceMap, setPriceMap] = useState<Record<string, PriceData>>({});
  const [usdkrw, setUsdKrw] = useState(1400);
  const [jpykrw, setJpyKrw] = useState(9.5);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showPortfolioPicker, setShowPortfolioPicker] = useState(false);
  const [sortBy, setSortBy] = useState<SortType>('value');
  const [isTodayMode, setIsTodayMode] = useState(false);
  const [isLocalCurrency, setIsLocalCurrency] = useState(false);
  const [showExchangeRateModal, setShowExchangeRateModal] = useState(false);
  const [exchangeRateValue, setExchangeRateValue] = useState('');
  const [showHoldingModal, setShowHoldingModal] = useState(false);
  const [editHolding, setEditHolding] = useState<any>(null);
  const isFetchingRef = useRef(false);
  const rotation = useRef(new Animated.Value(0)).current;

  // ─── Animation Logic ───
  useEffect(() => {
    if (refreshing) {
      Animated.loop(
        Animated.timing(rotation, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      Animated.timing(rotation, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }
  }, [refreshing, rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const setSelectedId = async (id: string | undefined) => {
    setSelectedIdLocal(id);
    await setSelectedPortfolioId(id === 'ALL' ? 'ALL' : (id || null));
    setShowPortfolioPicker(false);
  };

  const loadDashboard = useCallback(async (forceRefresh = false) => {
    if (!session || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setDataLoading(true); setLoading(true);
    try {
      const pResPromise = supabase.from('portfolios').select('*, holdings(*)').eq('user_id', session.user.id);
      const cachedHoldings = await getHoldings(undefined, forceRefresh);
      const tickers = Array.from(new Set([...cachedHoldings.map((h: Holding) => h.ticker), '^VIX', 'USDKRW=X', 'JPYKRW=X']));
      const pricesPromise = fetchYahooPrices(tickers);

      const { data: pData, error } = await pResPromise;
      if (error || !pData) { setLoading(false); isFetchingRef.current = false; return; }

      const prices = await pricesPromise;
      if (!selectedId && pData.length > 0) setSelectedIdLocal(String(pData[0].id));

      const updatedPData = pData.map(p => ({
        ...p,
        holdings: cachedHoldings.filter(h => h.portfolio_id === p.id)
      }));
      setPortfolios(updatedPData as Portfolio[]);
      setPriceMap(prices);
      setUsdKrw(prices['USDKRW=X']?.price || 1400);
      setJpyKrw(prices['JPYKRW=X']?.price || 9.5);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setDataLoading(false); setRefreshing(false); isFetchingRef.current = false; }
  }, [session, selectedId]);

  useFocusEffect(useCallback(() => {
    let isActive = true;
    const init = async () => {
      const saved = await getSelectedPortfolioId();
      if (isActive) {
        if (saved && saved !== selectedId) setSelectedIdLocal(saved);
        loadDashboard();
      }
    };
    init();
    return () => { isActive = false; };
  }, [selectedId, loadDashboard]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') loadDashboard();
    });
    return () => sub.remove();
  }, [loadDashboard]);

  const onRefresh = useCallback(() => { setRefreshing(true); loadDashboard(true); }, [loadDashboard]);

  const processedData = useMemo(() => {
    const actId = selectedId || (portfolios.length > 0 ? String(portfolios[0].id) : undefined);
    const activePortfolios = selectedId === 'ALL' 
      ? portfolios 
      : portfolios.filter(p => String(p.id) === actId);
      
    let gT = 0, gI = 0, gD = 0, uP = 0, uV = 0, jP = 0, jV = 0, kP = 0, kV = 0;

    const result = activePortfolios.map(p => {
      let pT = 0, pI = 0, pD = 0;
      // Portfolio-level constant buy rate for USD
      const buyRate = p.avg_usd_krw_rate || usdkrw; 

      const rows = p.holdings.map(h => {
        const mi = priceMap[h.ticker]; const cp = mi?.price || h.avg_price;
        const currentRate = h.currency === 'USD' ? usdkrw : h.currency === 'JPY' ? jpykrw : 1;
        const isJp = h.country === 'JP' && /^[0-9A-Z]{8}$/.test(h.ticker);
        const isCash = h.ticker.startsWith('CASH_');
        const qty = isJp ? h.quantity / 10000 : h.quantity;
        
        const vL = qty * cp; 
        const iL = qty * (isCash ? cp : h.avg_price);
        
        // --- 🛡️ 정확한 수익률 계산 (2번 방식: 포트폴리오 기준 환율 적용) ---
        const vK = vL * currentRate;  // 현재 가치 (현재 환율)
        const iK = iL * (h.currency === 'USD' ? buyRate : currentRate); // 매수 금액 (매수 시점 환율 적용)
        
        // --- 📊 일일 변동 계산 (주가 변동 + 환율 변동 모두 반영) ---
        const fxInfo = h.currency === 'USD' ? priceMap['USDKRW=X'] : h.currency === 'JPY' ? priceMap['JPYKRW=X'] : null;
        
        const currentLocalPrice = cp;
        const previousLocalPrice = mi?.previous_close || (currentLocalPrice - (mi?.change_amount || 0));
        
        const currentFX = currentRate;
        const previousFX = fxInfo?.previous_close || currentFX; // 환율 변동이 없는 경우(KRW 등) 현재 환율 유지

        const currentValueKRW = currentLocalPrice * currentFX * qty;
        const previousValueKRW = previousLocalPrice * previousFX * qty;
        
        const dK = isCash ? 0 : (currentValueKRW - previousValueKRW);
        const dayChangePct = isCash ? 0 : (previousValueKRW > 0 ? ((currentValueKRW - previousValueKRW) / previousValueKRW) * 100 : 0);
        
        const effectiveProfitRate = isCash ? 0 : (iK > 0 ? ((vK - iK) / iK) * 100 : 0);
        
        pT += vK; pI += iK; pD += dK;
        if (h.currency === 'USD') { uV += vK; uP += (vK - iK); }
        else if (h.currency === 'JPY') { jV += vK; jP += (vK - iK); }
        else { kV += vK; kP += (vK - iK); }

        return { 
          ...h, 
          currentPrice: cp, 
          valueKRW: vK, 
          valueLocal: vL, 
          profitValueKRW: vK - iK, 
          profitRate: effectiveProfitRate, 
          dayChangeKRW: dK, 
          dayChangePercent: isCash ? 0 : dayChangePct, 
          displayName: mi?.name || h.name || h.ticker, 
          flag: getFlag(h.country) 
        };
      });
      rows.sort((a, b) => {
        if (sortBy === 'value') return b.valueKRW - a.valueKRW;
        if (sortBy === 'profit') return b.profitValueKRW - a.profitValueKRW;
        if (sortBy === 'rate') return b.profitRate - a.profitRate;
        return a.displayName.localeCompare(b.displayName);
      });
      gT += pT; gI += pI; gD += pD;
      return { ...p, rows, pT, pI, pD };
    });

    const tax = calculateTax(uP, 'USD');
    return {
      processed: result,
      totals: { gT, gI, gD, gProfit: gT - gI, gRate: gI > 0 ? ((gT - gI) / gI) * 100 : 0, dRate: (gT - gD) !== 0 ? (gD / (gT - gD)) * 100 : 0, vix: priceMap['^VIX']?.price },
      exitSimulation: { totalValue: gT, tax, netAmount: gT - tax, breakdown: { uV, uP, kV, kP, jV, jP } }
    };
  }, [portfolios, selectedId, priceMap, usdkrw, jpykrw, sortBy]);

  if (authLoading || (dataLoading && portfolios.length === 0)) return <DashboardSkeleton insets={insets} />;

  const { processed, totals, exitSimulation } = processedData;
  const tp = totals.gProfit >= 0; const dp = totals.gD >= 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: insets.top + 12, paddingBottom: 8 }}>
        <TouchableOpacity onPress={() => setShowPortfolioPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: '#e4e4e7' }}>{selectedId === 'ALL' ? '통합 계좌' : (processed[0]?.name?.substring(0, 12) || '계좌')}</Text><ChevronDown size={16} color="#71717a" />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <TouchableOpacity onPress={onRefresh} style={{ padding: 8, backgroundColor: '#18181b', borderRadius: 8, borderWidth: 1, borderColor: '#27272a' }}>
            <RefreshCw size={20} color="#e4e4e7" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setEditHolding(null); setShowHoldingModal(true); }} style={{ padding: 8, backgroundColor: '#22c55e', borderRadius: 8 }}><Plus size={20} color="#052e16" /></TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />} contentContainerStyle={{ padding: 16, paddingTop: 8 }}>
        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 2, marginBottom: 10 }}>TOTAL ASSET</Text>
          <Text style={{ fontSize: 32, fontWeight: '900', color: '#f4f4f5', letterSpacing: -1 }}>{formatCurrency(totals.gT)}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
          <View style={{ flex: 1, backgroundColor: tp ? '#1a0a0a' : '#0a0a1a', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: tp ? '#7f1d1d' : '#1e3a5f' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>{tp ? <TrendingUp size={14} color="#ef4444" /> : <TrendingDown size={14} color="#3b82f6" />}<Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1 }}>총 손익</Text></View>
            <Text style={{ fontSize: 18, fontWeight: '900', color: tp ? '#ef4444' : '#3b82f6' }}>{tp ? '+' : ''}{formatCurrency(Math.abs(totals.gProfit))}</Text>
            <Text style={{ fontSize: 12, fontWeight: '800', color: tp ? '#ef4444' : '#3b82f6', marginTop: 2 }}>{formatRate(totals.gRate)}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: dp ? '#1a0a0a' : '#0a0a1a', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: dp ? '#7f1d1d' : '#1e3a5f' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>{dp ? <ArrowUpRight size={14} color="#ef4444" /> : <ArrowDownRight size={14} color="#3b82f6" />}<Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1 }}>오늘</Text></View>
            <Text style={{ fontSize: 18, fontWeight: '900', color: dp ? '#ef4444' : '#3b82f6' }}>{dp ? '+' : ''}{formatCurrency(Math.abs(totals.gD))}</Text>
            <Text style={{ fontSize: 12, fontWeight: '800', color: dp ? '#ef4444' : '#3b82f6', marginTop: 2 }}>{formatRate(totals.dRate)}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
          <TouchableOpacity 
            onPress={() => {
              const activePortfolio = portfolios.find(p => String(p.id) === (selectedId || String(portfolios[0]?.id)));
              setExchangeRateValue(String(activePortfolio?.avg_usd_krw_rate || ""));
              setShowExchangeRateModal(true);
            }}
            style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#27272a' }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1 }}>USD/KRW</Text>
              {(() => {
                const p = portfolios.find(p => String(p.id) === (selectedId || String(portfolios[0]?.id)));
                if (!p?.avg_usd_krw_rate) return null;
                const diff = usdkrw - p.avg_usd_krw_rate;
                return (
                  <Text style={{ fontSize: 9, fontWeight: '700', color: diff >= 0 ? '#ef4444' : '#3b82f6' }}>
                    {diff >= 0 ? '▲' : '▼'}{Math.abs(diff).toFixed(1)} ({(diff / p.avg_usd_krw_rate * 100).toFixed(1)}%)
                  </Text>
                );
              })()}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#e4e4e7' }}>{usdkrw.toFixed(2)}</Text>
              {(() => {
                const p = portfolios.find(p => String(p.id) === (selectedId || String(portfolios[0]?.id)));
                if (p?.avg_usd_krw_rate) return <Text style={{ fontSize: 10, color: '#52525b' }}>/ {p.avg_usd_krw_rate}</Text>;
                return null;
              })()}
            </View>
          </TouchableOpacity>
          
          {totals.vix && (
            <View style={{ flex: 1, backgroundColor: '#18181b', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#27272a' }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 4 }}>VIX</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: totals.vix > 25 ? '#22c55e' : totals.vix < 15 ? '#ef4444' : '#e4e4e7' }}>{totals.vix.toFixed(2)}</Text>
            </View>
          )}
        </View>

        <View style={{ backgroundColor: '#18181b', borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#27272a' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}><Wallet size={14} color="#71717a" /><Text style={{ fontSize: 10, fontWeight: '900', color: '#71717a', letterSpacing: 1 }}>전량 매도 시 예상 금액</Text></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View><Text style={{ fontSize: 20, fontWeight: '900', color: '#22c55e' }}>{formatCurrency(exitSimulation.netAmount)}</Text><Text style={{ fontSize: 11, color: '#52525b', marginTop: 4 }}>세금: -{formatCurrency(exitSimulation.tax)} (미국 22%)</Text></View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1 }}>HOLDINGS · 길게눌러 수정</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => setIsTodayMode(!isTodayMode)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: isTodayMode ? '#1e3a5f' : '#18181b', borderWidth: 1, borderColor: isTodayMode ? '#3b82f6' : '#27272a' }}><Text style={{ fontSize: 11, fontWeight: '700', color: isTodayMode ? '#3b82f6' : '#71717a' }}>오늘 기준</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { const types: SortType[] = ['value', 'profit', 'rate', 'name']; const next = types[(types.indexOf(sortBy) + 1) % types.length]; setSortBy(next); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#18181b', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}><ArrowUpDown size={12} color="#71717a" /><Text style={{ fontSize: 11, fontWeight: '700', color: '#71717a' }}>{sortBy === 'value' ? '가치순' : sortBy === 'profit' ? '수익순' : sortBy === 'rate' ? '수익률순' : '이름순'}</Text></TouchableOpacity>
          </View>
        </View>

        {processed.map(p => (
          <View key={p.id} style={{ marginBottom: 16 }}>
            {p.rows.map((h: any) => (
                <TouchableOpacity
                  key={h.id}
                  onPress={() => { 
                    if (h.ticker === 'CASH_KRW') return;
                    router.push(`/stock/${h.ticker}`); 
                  }}
                  onLongPress={() => { setEditHolding(h); setShowHoldingModal(true); }}
                  delayLongPress={500}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1e1e26' }}
                >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Text style={{ fontSize: 20, marginRight: 10 }}>{h.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#e4e4e7' }} numberOfLines={1}>{h.displayName}</Text>
                    <Text style={{ fontSize: 11, color: '#52525b' }}>{h.currency}<Text style={{ color: '#71717a' }}> · 현재가: {formatCurrency(h.currentPrice * (h.currency==='USD'?usdkrw:(h.currency==='JPY'?jpykrw:1)), 'KRW')}</Text></Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#e4e4e7' }}>{formatCurrency(h.valueKRW)}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: (isTodayMode ? h.dayChangeKRW >= 0 : h.profitValueKRW >= 0) ? '#22c55e' : '#3b82f6' }}>{isTodayMode ? `${h.dayChangeKRW >= 0 ? '+' : ''}${formatCurrency(h.dayChangeKRW)} (${formatRate(h.dayChangePercent)})` : `${h.profitValueKRW >= 0 ? '+' : ''}${formatCurrency(h.profitValueKRW)} (${formatRate(h.profitRate)})`}</Text>
                    {(isTodayMode ? h.dayChangeKRW >= 0 : h.profitValueKRW >= 0) ? <TrendingUp size={10} color="#22c55e" /> : <TrendingDown size={10} color="#3b82f6" />}
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ))}
        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal visible={showPortfolioPicker} transparent animationType="fade" onRequestClose={() => setShowPortfolioPicker(false)}>
        <TouchableOpacity 
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} 
          activeOpacity={1} 
          onPress={() => setShowPortfolioPicker(false)}
        >
          <TouchableOpacity 
            activeOpacity={1}
            style={{ backgroundColor: '#18181b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: 400 }}
          >
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#f4f4f5', marginBottom: 12 }}>계좌 선택</Text>
            <ScrollView>
              <TouchableOpacity onPress={() => setSelectedId('ALL')} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#27272a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: 'bold', color: selectedId === 'ALL' ? '#22c55e' : '#e4e4e7' }}>통합 계좌</Text>
                {selectedId === 'ALL' && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />}
              </TouchableOpacity>
              {portfolios.map(p => (
                <TouchableOpacity key={p.id} onPress={() => setSelectedId(p.id)} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#27272a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: String(p.id) === selectedId ? '#22c55e' : '#e4e4e7' }}>{p.name}</Text>
                  {String(p.id) === selectedId && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setShowPortfolioPicker(false)} style={{ paddingVertical: 16, alignItems: 'center' }}><Text style={{ fontSize: 14, fontWeight: '700', color: '#52525b' }}>닫기</Text></TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 환율 설정 모달 */}
      <Modal visible={showExchangeRateModal} transparent animationType="slide" onRequestClose={() => setShowExchangeRateModal(false)}>
        <TouchableOpacity 
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 }} 
          activeOpacity={1} 
          onPress={() => setShowExchangeRateModal(false)}
        >
          <TouchableOpacity 
            activeOpacity={1}
            style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#27272a' }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '900', color: '#f4f4f5' }}>평균 매수 환율 설정 커스텀</Text>
              <TouchableOpacity onPress={() => setShowExchangeRateModal(false)}><X size={20} color="#71717a" /></TouchableOpacity>
            </View>
            
            <Text style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 20, lineHeight: 18 }}>
              포트폴리오의 정확한 수익률 계산을 위해{'\n'}
              미국 주식 매수 시점의 평균 환율을 입력해주세요.
            </Text>

            <View style={{ backgroundColor: '#09090b', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#27272a' }}>
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 8 }}>AVERAGE BUY RATE (USD/KRW)</Text>
              <TextInput
                style={{ backgroundColor: '#18181b', color: '#e4e4e7', fontSize: 24, fontWeight: '900', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#3f3f46' }}
                keyboardType="numeric"
                autoFocus
                placeholder="1400.00"
                placeholderTextColor="#27272a"
                value={exchangeRateValue}
                onChangeText={setExchangeRateValue}
              />
            </View>

            <TouchableOpacity 
              onPress={async () => {
                const val = parseFloat(exchangeRateValue);
                const activeId = selectedId || String(portfolios[0]?.id);
                if (!isNaN(val) && activeId) {
                  const { error } = await supabase.from('portfolios').update({ avg_usd_krw_rate: val }).eq('id', activeId);
                  if (!error) {
                    loadDashboard(true);
                    setShowExchangeRateModal(false);
                  } else {
                    Alert.alert("오류", "환율 저장에 실패했습니다.");
                  }
                }
              }}
              style={{ marginTop: 24, paddingVertical: 18, backgroundColor: '#22c55e', borderRadius: 12, alignItems: 'center', shadowColor: '#22c55e', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 }}
            >
              <Text style={{ fontSize: 16, fontWeight: '900', color: '#052e16' }}>설정 반영하기</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => setShowExchangeRateModal(false)}
              style={{ marginTop: 12, paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#52525b' }}>취소</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <HoldingModal visible={showHoldingModal} onClose={() => { setShowHoldingModal(false); setEditHolding(null); }} portfolioId={selectedId || portfolios[0]?.id || ''} holdingId={editHolding?.id} initialData={editHolding ? { ...editHolding, avg_price: editHolding.avg_price } : undefined} onSuccess={() => { loadDashboard(true); }} />
    </View>
  );
}
