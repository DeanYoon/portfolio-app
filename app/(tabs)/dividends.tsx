import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Dimensions, StyleSheet, Modal, RefreshControl, Animated, Easing } from 'react-native';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSelectedPortfolioId, setSelectedPortfolioId } from '@/src/utils/portfolio-state';
import { getHoldings } from '@/src/utils/holdings-cache';
import { getDividends } from '@/src/utils/dividends-cache';
import { formatCurrency, getFlag } from '@/src/utils/format';
import { TrendingUp, ChevronDown, ShieldCheck, Info, RefreshCw } from 'lucide-react-native';
import { getTaxRate, calculateDividendYield, calculateLatestTrendEstimate, TrendEstimate } from '@/src/utils/dividend-calc';
import { endOfMonth, isPast, isSameMonth, parseISO } from 'date-fns';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

const DividendSkeleton = ({ insets }: { insets: any }) => (
  <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: insets.top }}>
    {/* Portfolio selector skeleton */}
    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
      <Skeleton width={80} height={36} borderRadius={10} />
    </View>

    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8 }}>
      {/* Controls skeleton */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <Skeleton width={100} height={34} borderRadius={20} />
        <Skeleton width={100} height={34} borderRadius={20} style={{ marginLeft: 'auto' }} />
      </View>

      {/* Chart skeleton */}
      <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 16, borderWidth: 1, borderColor: '#27272a', marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <View>
            <Skeleton width={120} height={16} marginBottom={6} />
            <Skeleton width={80} height={10} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 170, justifyContent: 'space-between' }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
            <Skeleton key={i} width="6%" height={`${Math.random() * 60 + 20}%`} borderRadius={4} />
          ))}
        </View>
      </View>

      {/* Summary skeleton */}
      <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#27272a', marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <Skeleton width={100} height={10} />
          <Skeleton width={40} height={18} borderRadius={6} />
        </View>
        <Skeleton width="70%" height={48} marginBottom={8} />
        <Skeleton width="50%" height={10} />
      </View>

      {/* List headers */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <Skeleton width={100} height={12} />
        <Skeleton width={40} height={12} />
      </View>

      {/* Stock items skeleton */}
      {[1, 2, 3].map((i) => (
        <View key={i} style={{ backgroundColor: '#18181b', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#27272a', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Skeleton width="60%" height={18} marginBottom={6} />
              <Skeleton width="40%" height={12} />
            </View>
            <Skeleton width={100} height={20} />
          </View>
          <Skeleton width="100%" height={80} borderRadius={12} />
        </View>
      ))}
    </ScrollView>
  </View>
);
const VERCEL_API = process.env.EXPO_PUBLIC_YAHOO_API || 'https://yahoo-finance-api-seven.vercel.app';
const CACHE_TTL = 24 * 60 * 60 * 1000;

interface PortfolioItem { id: string; name: string; }
interface DividendEvent { date: string; amount: number; close: number; totalForHolding: number; currency: string; ticker: string; }
interface StockDividendData {
  ticker: string; name: string; quantity: number;
  dividends: DividendEvent[];
  totalDividends: number; totalValueForHolding: number;
  currency: string; country: string;
}
interface StockAnalysis {
  ticker: string; name: string; country: string; currency: string; quantity: number;
  analysis: ReturnType<typeof calculateDividendYield>;
  estimates: TrendEstimate[];
  tax: number; annualKrw: number;
}

export default function DividendsScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isKrwMode, setIsKrwMode] = useState(true);
  const [isAfterTax, setIsAfterTax] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [portfolios, setPortfolios] = useState<PortfolioItem[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioIdLocal] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [stockDividends, setStockDividends] = useState<StockDividendData[]>([]);
  const [exchangeRates, setExchangeRates] = useState({ usdkrw: 1400, jpykrw: 9.5 });
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase.from('portfolios').select('id, name').eq('user_id', session.user.id);
      if (data?.length) { 
        setPortfolios(data); 
        const saved = await getSelectedPortfolioId();
        setSelectedPortfolioIdLocal(saved || data[0].id); 
      }
    })();
  }, [session]);

  // Sync with shared state on mount and on app resume
  useEffect(() => {
    const syncState = async () => {
      const saved = await getSelectedPortfolioId();
      if (saved) setSelectedPortfolioIdLocal(saved);
    };
    syncState();
  }, []);

  // Re-sync when tab gains focus
  useFocusEffect(useCallback(() => {
    getSelectedPortfolioId().then(saved => {
      if (saved && saved !== selectedPortfolioId) setSelectedPortfolioIdLocal(saved);
    });
  }, [selectedPortfolioId]));

  const setSelectedPortfolioIdShared = async (id: string | null) => {
    setSelectedPortfolioIdLocal(id);
    await setSelectedPortfolioId(id);
  };

  // ── Fetch dividends ──
  const fetchDividends = useCallback(async (pid: string, forceRefresh = false) => {
    if (!pid || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setDataLoading(true);
    setLoading(true);
    setError(null);
    try {
      // 1. 보유 종목(Holdings)은 캐시에서 즉시 로드 (Holdings는 캐시 활용)
      const holdings = await getHoldings(pid, forceRefresh);
      if (holdings.length === 0) { 
        setStockDividends([]); 
        setLoading(false); 
        setDataLoading(false);
        isFetchingRef.current = false;
        return; 
      }

      const rawTickers = Array.from(new Set(holdings.map((h) => h.ticker as string))) as string[];
      const jpFundDataPromise = supabase.from('japan_funds').select('*');
      const ratesResPromise = fetch(`${VERCEL_API}/quote?symbols=USDKRW=X,JPYKRW=X`).then(r => r.json());

      // 2. 가장 오래 걸리는 배당 데이터 API 호출 (최우선 시작 & 캐시 활용)
      const dividendsPromise = getDividends(rawTickers, VERCEL_API, forceRefresh);

      // 3. 나머지 가격 데이터 요청 준비
      const rawToApi: Record<string, string> = {};
      const apiTickerSet = new Set<string>();
      for (const t of rawTickers) {
        const h = holdings.find((hh: any) => hh.ticker === t);
        if (h?.currency === 'JPY') continue;
        let apiTicker = t;
        if (/^[0-9]{6}$/.test(apiTicker)) apiTicker = `${apiTicker}.KS`;
        else if (/^[0-9]{4}$/.test(apiTicker)) apiTicker = `${apiTicker}.T`;
        rawToApi[t] = apiTicker;
        apiTickerSet.add(apiTicker);
      }
      const priceResPromise = apiTickerSet.size > 0 
        ? fetch(`${VERCEL_API}/quote?symbols=${[...apiTickerSet].join(',')}`).then(r => r.json())
        : Promise.resolve({});

      const [bulkDivData, jpRes, ratesRes, priceRes] = await Promise.all([
        dividendsPromise,
        jpFundDataPromise,
        ratesResPromise,
        priceResPromise
      ]);

      const jpFundData = jpRes.data || [];
      
      // 환율 설정
      if (ratesRes) {
        setExchangeRates({
          usdkrw: ratesRes['USDKRW=X']?.price || 1400,
          jpykrw: ratesRes['JPYKRW=X']?.price || 9.5,
        });
      }

      // 가격 맵 구성
      const priceMap: Record<string, number> = {};
      if (priceRes) {
        for (const [rawTicker, apiTicker] of Object.entries(rawToApi)) {
          if (priceRes[apiTicker]?.price) priceMap[rawTicker] = priceRes[apiTicker].price;
        }
      }
      for (const fund of jpFundData) {
        if (fund.price_data?.price) priceMap[fund.fcode] = fund.price_data.price;
      }
      setStockPrices(priceMap);

      // 3. 배당 데이터 프로세싱
      const cutoffDate = new Date();
      cutoffDate.setFullYear(cutoffDate.getFullYear() - 2);
      const cutoffStr = cutoffDate.toISOString().split('T')[0];

      const processDivList = (list: any[]) =>
        list
          .filter((d: any) => d.date >= cutoffStr && d.date && d.amount != null && d.amount > 0)
          .map((d: any) => ({ date: d.date, amount: d.amount, close: d.close ?? 0 }))
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const final = rawTickers.map((rawTicker: string) => {
        const holding = holdings.find((h: any) => h.ticker === rawTicker);
        const isJpFund = holding?.country === 'JP' && (/^[0-9A-Z]{8}$/.test(rawTicker) || rawTicker === '9I312249');
        const quantity = holding?.quantity || 0;
        const effectiveQty = isJpFund ? quantity / 10000 : quantity;

        let dividends: any[] = [];
        let fetchedCurrency = holding?.currency || 'USD';

        if (isJpFund) {
          const fund = jpFundData.find((f: any) => f.fcode === rawTicker);
          if (fund?.dividend_data?.length) {
            dividends = fund.dividend_data
              .map((d: any) => ({ date: d.date, amount: d.amount, close: d.close ?? 0 }))
              .filter((d: any) => d.date >= cutoffStr && d.date && d.amount > 0);
          }
          fetchedCurrency = 'JPY';
        } else {
          const tData = bulkDivData[rawTicker];
          if (Array.isArray(tData)) dividends = processDivList(tData);
          else if (tData?.dividends) {
            dividends = processDivList(tData.dividends);
            if (tData.currency) fetchedCurrency = tData.currency;
          }
        }

        if (dividends.length === 0) return null;

        return {
          ticker: rawTicker,
          name: holding?.name || rawTicker,
          quantity: effectiveQty,
          dividends: dividends.map((d: any) => ({
            date: d.date, amount: d.amount, close: d.close, 
            totalForHolding: d.amount * effectiveQty, 
            currency: fetchedCurrency, ticker: rawTicker
          })),
          totalDividends: dividends.reduce((s, d) => s + d.amount, 0),
          totalValueForHolding: dividends.reduce((s, d) => s + d.amount * effectiveQty, 0),
          currency: fetchedCurrency,
          country: holding?.country || 'US',
        };
      }).filter(x => x !== null);

      setStockDividends(final);
    } catch (e: any) {
      setError(e.message);
      console.error(e);
    } finally {
      setLoading(false);
      setDataLoading(false);
      setRefreshing(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => { if (selectedPortfolioId) fetchDividends(selectedPortfolioId); }, [selectedPortfolioId, fetchDividends]);

  const onRefresh = useCallback(() => {
    if (selectedPortfolioId) {
      setRefreshing(true);
      fetchDividends(selectedPortfolioId, true);
    }
  }, [selectedPortfolioId, fetchDividends]);

  // ── Helpers ──
  const convKrw = useCallback((amt: number, cur: string) => {
    if (cur === 'KRW') return amt;
    if (cur === 'USD') return amt * exchangeRates.usdkrw;
    if (cur === 'JPY') return amt * exchangeRates.jpykrw;
    return amt;
  }, [exchangeRates]);

  // ── Monthly aggregation with trend estimates ──
  const monthlyData = useMemo(() => {
    if (!stockDividends.length) return [];
    const cy = new Date().getFullYear();
    const today = new Date();
    return Array.from({ length: 12 }, (_, m) => {
      let total = 0;
      for (const sd of stockDividends) {
        const tax = getTaxRate(sd.country, isAfterTax);
        // 실제 데이터
        const act = sd.dividends.find(d => {
          const dd = new Date(d.date);
          return dd.getFullYear() === cy && dd.getMonth() === m;
        });
        if (act) {
          total += convKrw(act.totalForHolding * tax, sd.currency);
        } else {
          // 예측 데이터
          const est = calculateLatestTrendEstimate(
            sd.dividends as any, null,
            stockPrices[sd.ticker] || 0, m, cy, sd.ticker,
            isKrwMode, 1
          );
          total += convKrw(est.amount * sd.quantity * tax, sd.currency);
        }
      }
      const md = new Date(cy, m, 15);
      const past = isPast(endOfMonth(md)) && !isSameMonth(md, today);
      return {
        month: m,
        label: `${m + 1}월`,
        value: Math.round(total),
        type: past ? 'actual' as const : 'estimate' as const,
      };
    });
  }, [stockDividends, stockPrices, isKrwMode, isAfterTax, convKrw]);

  const totalAnnual = monthlyData.reduce((s, m) => s + m.value, 0);
  const monthVal = selectedMonth !== null ? monthlyData[selectedMonth]?.value ?? 0 : 0;

  // ── Stock analysis list ──
  const analysisList: StockAnalysis[] = useMemo(() => {
    if (!stockDividends.length) return [];
    const cy = new Date().getFullYear();
    return stockDividends.map(sd => {
      const tax = getTaxRate(sd.country, isAfterTax);
      const analysis = calculateDividendYield(sd.dividends as any, stockPrices[sd.ticker] || 0, sd.ticker);
      const estimates: TrendEstimate[] = Array.from({ length: 12 }, (_, m) =>
        calculateLatestTrendEstimate(sd.dividends as any, null, stockPrices[sd.ticker] || 0, m, cy, sd.ticker, isKrwMode, 1)
      );
      const annualKrw = estimates.reduce((s, e) => s + convKrw(e.amount * sd.quantity * tax, sd.currency), 0);
      return { ticker: sd.ticker, name: sd.name, country: sd.country, currency: sd.currency, quantity: sd.quantity, analysis, estimates, tax, annualKrw };
    }).sort((a, b) => b.annualKrw - a.annualKrw);
  }, [stockDividends, stockPrices, isKrwMode, isAfterTax, convKrw]);

  const filteredList = selectedMonth === null ? analysisList : analysisList.filter(s => s.estimates[selectedMonth]?.amount > 0);

  if (dataLoading && !stockDividends.length) {
    return <DividendSkeleton insets={insets} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: insets.top + 12, paddingBottom: 8 }}>
        <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.pbtn}>
          <Text style={styles.ptxt}>{portfolios.find(p => p.id === selectedPortfolioId)?.name?.slice(0, 12) || '계좌'}</Text>
          <ChevronDown size={16} color="#71717a" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onRefresh} style={{ padding: 8, backgroundColor: '#18181b', borderRadius: 8, borderWidth: 1, borderColor: '#27272a' }}>
          <RefreshCw size={20} color="#e4e4e7" />
        </TouchableOpacity>
      </View>
      <ScrollView 
        contentContainerStyle={{ padding: 16, paddingTop: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
      >
        {/* Controls */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
          <TouchableOpacity onPress={() => setIsAfterTax(!isAfterTax)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: isAfterTax ? '#22c55e' : '#18181b', borderWidth: 1, borderColor: isAfterTax ? '#22c55e' : '#27272a' }}>
            <ShieldCheck size={14} color={isAfterTax ? '#052e16' : '#71717a'} />
            <Text style={{ fontSize: 11, fontWeight: '800', color: isAfterTax ? '#052e16' : '#71717a' }}>세후 수령액</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsKrwMode(!isKrwMode)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', marginLeft: 'auto' }}>
            <Info size={14} color="#71717a" />
            <Text style={{ fontSize: 11, fontWeight: '800', color: '#71717a' }}>{isKrwMode ? 'KRW (₩)' : '원본 통화'}</Text>
          </TouchableOpacity>
        </View>

        {/* Chart */}
        <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 16, borderWidth: 1, borderColor: '#27272a', marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#f4f4f5' }}>📊 연간 배당 흐름</Text>
              <Text style={{ fontSize: 9, color: '#71717a', marginTop: 2, fontWeight: '700' }}>트렌드 예측 모델</Text>
            </View>
            <TrendingUp size={24} color="#27272a" style={{ opacity: 0.3 }} />
          </View>

          {stockDividends.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 170, justifyContent: 'space-between', marginTop: 12 }}>
              {(() => {
                const maxVal = Math.max(...monthlyData.map(m => m.value), 1);
                return monthlyData.map((d: any) => {
                  const h = Math.max((d.value / maxVal) * (170 - 24), 2);
                  const isActive = selectedMonth !== null && selectedMonth === d.month;
                  const col = d.type === 'actual' ? '#4ade80' : '#3b82f6';
                  return (
                    <TouchableOpacity key={d.month} onPress={() => setSelectedMonth(d.month)} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', opacity: selectedMonth !== null && !isActive ? 0.4 : 0.9 }}>
                      <View style={{ width: '60%', height: h, backgroundColor: col, borderRadius: 4, minWidth: 8 }} />
                      <Text style={{ fontSize: 8, color: '#52525b', fontWeight: '700', marginTop: 4 }}>{d.label}</Text>
                    </TouchableOpacity>
                  );
                });
              })()}
            </View>
          ) : (
            <View style={{ height: 180, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: '#52525b', fontSize: 13, fontWeight: '700' }}>배당 데이터가 없습니다</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ade80' }} /><Text style={{ fontSize: 10, color: '#52525b', fontWeight: '700' }}>실제</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#3b82f6' }} /><Text style={{ fontSize: 10, color: '#52525b', fontWeight: '700' }}>예측</Text>
            </View>
          </View>
        </View>

        {/* Summary */}
        <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#27272a', marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#71717a', letterSpacing: 1 }}>{selectedMonth !== null ? `${selectedMonth + 1}월 배당 리포트` : '2026 전체 배당'}</Text>
            <TouchableOpacity onPress={() => setSelectedMonth(selectedMonth === null ? new Date().getMonth() : null)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: selectedMonth !== null ? '#22c55e' : '#09090b' }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: selectedMonth !== null ? '#052e16' : '#71717a' }}>{selectedMonth !== null ? '연간' : '월별'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 42, fontWeight: '900', color: '#f4f4f5', letterSpacing: -2, marginBottom: 4 }}>{formatCurrency(selectedMonth !== null ? monthVal : totalAnnual)}</Text>
          <Text style={{ fontSize: 9, color: '#52525b' }}>{stockDividends.length}종목 · {isAfterTax ? '세후' : '세전'} · {isKrwMode ? 'KRW 기준' : '원본 통화'}</Text>
        </View>

        {/* Stock list */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: '#3f3f46', letterSpacing: 2 }}>종목별 배당 분석</Text>
          <Text style={{ fontSize: 10, color: '#52525b', fontWeight: '800' }}>{filteredList.length}종목</Text>
        </View>

        {filteredList.map((s: StockAnalysis) => {
          const est = selectedMonth !== null ? s.estimates[selectedMonth] : null;
          return (
            <View key={s.ticker} style={{ backgroundColor: '#18181b', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#27272a', marginBottom: 12 }}>
              {/* Header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '900', color: '#f4f4f5' }}>{s.name}</Text>
                  <Text style={{ fontSize: 10, color: '#71717a', fontWeight: '700', marginTop: 2 }}>{s.ticker} · {getFlag(s.country === 'JP' ? 'JP' : s.country === 'KR' ? 'KR' : 'US')} {s.quantity}주</Text>
                </View>
                <Text style={{ fontSize: 16, fontWeight: '900', color: '#22c55e' }}>{formatCurrency(s.annualKrw)}</Text>
              </View>

              {/* Yield badges */}
              <View style={{ backgroundColor: '#09090b', borderRadius: 12, padding: 10, marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                  <View style={{ backgroundColor: '#052e16', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: '#4ade80' }}>최근 {s.analysis.singleYieldPercent.toFixed(2)}%</Text>
                  </View>
                  {s.analysis.paymentsPerYear > 0 && (
                    <View style={{ backgroundColor: '#172554', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                      <Text style={{ fontSize: 10, fontWeight: '900', color: '#3b82f6' }}>연환산 {s.analysis.yieldPercent.toFixed(2)}%</Text>
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View><Text style={{ fontSize: 8, color: '#52525b', fontWeight: '700' }}>지급주기</Text><Text style={{ fontSize: 11, fontWeight: '800', color: '#a1a1aa' }}>{s.analysis.isMonthly ? '매월' : `연 ${s.analysis.paymentsPerYear || 4}회`}</Text></View>
                  <View><Text style={{ fontSize: 8, color: '#52525b', fontWeight: '700' }}>현재가</Text><Text style={{ fontSize: 11, fontWeight: '800', color: '#a1a1aa' }}>{formatCurrency(s.analysis.currentPrice, s.currency)}</Text></View>
                  <View><Text style={{ fontSize: 8, color: '#52525b', fontWeight: '700' }}>연간예상</Text><Text style={{ fontSize: 11, fontWeight: '800', color: '#22c55e' }}>{formatCurrency(s.analysis.annualDividendPerShare, s.currency)}</Text></View>
                </View>
              </View>

              {/* Monthly breakdown or single month detail */}
              {selectedMonth === null ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {s.estimates.map((e: TrendEstimate, i: number) => e.amount > 0 ? (
                    <TouchableOpacity key={i} onPress={() => setSelectedMonth(i)} style={{
                      width: '31%', padding: 8, borderRadius: 10, alignItems: 'center', borderWidth: 1,
                      flexBasis: '31%',
                      backgroundColor: e.calculationMethod === 'actual' ? 'rgba(74,222,128,0.08)' : 'rgba(59,130,246,0.08)',
                      borderColor: e.calculationMethod === 'actual' ? 'rgba(74,222,128,0.15)' : 'rgba(59,130,246,0.15)',
                    }}>
                      <Text style={{ fontSize: 9, color: '#71717a', fontWeight: '700' }}>{i + 1}월</Text>
                      <Text style={{ fontSize: 10, fontWeight: '900', color: e.calculationMethod === 'actual' ? '#4ade80' : '#3b82f6' }}>
                        {formatCurrency(convKrw(e.amount * s.quantity * s.tax, s.currency))}
                      </Text>
                    </TouchableOpacity>
                  ) : null)}
                </View>
              ) : est && est.amount > 0 ? (
                <View style={{ borderTopWidth: 1, borderTopColor: '#27272a', paddingTop: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: est.calculationMethod === 'actual' ? '#4ade80' : '#3b82f6' }} />
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#f4f4f5' }}>
                        {est.calculationMethod === 'actual' ? '지급 완료' : est.calculationMethod === 'price_trend' ? '주가 기반 예측' : '배당 이력 기반'}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '900', color: '#f4f4f5' }}>
                      {formatCurrency(convKrw(est.amount * s.quantity * s.tax, s.currency))}
                    </Text>
                  </View>
                  {est.calculationMethod !== 'actual' && est.calculationFormula && (
                    <View style={{ marginTop: 8, backgroundColor: '#09090b', borderRadius: 10, padding: 8 }}>
                      <Text style={{ fontSize: 10, color: '#71717a' }}>{est.calculationFormula}</Text>
                    </View>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}

        {filteredList.length === 0 && stockDividends.length > 0 && (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Text style={{ color: '#52525b', fontSize: 13, fontWeight: '700' }}>이 달에 배당이 없습니다</Text>
          </View>
        )}

        {error && <View style={{ padding: 12, backgroundColor: '#1c0a0a', borderRadius: 12, borderWidth: 1, borderColor: '#7f1d1d', marginBottom: 16 }}><Text style={{ color: '#fca5a5', fontSize: 12, fontWeight: '700' }}>⚠️ {error}</Text></View>}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Portfolio picker */}
      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <TouchableOpacity 
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} 
          activeOpacity={1} 
          onPress={() => setShowPicker(false)}
        >
          <TouchableOpacity 
            activeOpacity={1}
            style={{ backgroundColor: '#18181b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: 400 }}
          >
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#f4f4f5', marginBottom: 12 }}>계좌 선택</Text>
            <ScrollView>
              {portfolios.map(p => (
                <TouchableOpacity key={p.id} onPress={async () => { await setSelectedPortfolioIdShared(p.id); setShowPicker(false); }} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#27272a', flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: p.id === selectedPortfolioId ? '#22c55e' : '#e4e4e7' }}>{p.name}</Text>
                  {p.id === selectedPortfolioId && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setShowPicker(false)} style={{ paddingVertical: 16, alignItems: 'center' }}><Text style={{ fontSize: 14, fontWeight: '700', color: '#52525b' }}>닫기</Text></TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  pbtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  ptxt: { fontSize: 14, fontWeight: '800', color: '#e4e4e7' },
});
