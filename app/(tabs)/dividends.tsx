import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Dimensions, StyleSheet, Modal } from 'react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSelectedPortfolioId, setSelectedPortfolioId } from '@/src/utils/portfolio-state';
import { formatCurrency, getFlag } from '@/src/utils/format';
import { TrendingUp, ChevronDown, ShieldCheck, Info } from 'lucide-react-native';
import { getTaxRate, calculateDividendYield, calculateLatestTrendEstimate, TrendEstimate } from '@/src/utils/dividend-calc';
import { endOfMonth, isPast, isSameMonth, parseISO } from 'date-fns';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VERCEL_API = process.env.EXPO_PUBLIC_YAHOO_API || 'https://yahoo-finance-api-seven.vercel.app';
const CACHE_TTL = 24 * 60 * 60 * 1000;

interface PortfolioItem { id: string; name: string; }
interface DividendEvent { date: string; amount: number; close: number; totalForHolding: number; currency: string; }
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
  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase.from('portfolios').select('id, name').eq('user_id', session.user.id);
      if (data?.length) { setPortfolios(data); setSelectedPortfolioId(data[0].id); }
    })();
  }, [session]);

  // Sync with shared state on mount
  useEffect(() => {
    (async () => {
      const saved = await getSelectedPortfolioId();
      if (saved) setSelectedPortfolioIdLocal(saved);
    })();
  }, []);

  const setSelectedPortfolioIdShared = async (id: string | null) => {
    setSelectedPortfolioIdLocal(id);
    await setSelectedPortfolioId(id);
  };

  // ── Fetch dividends ──
  const fetchDividends = useCallback(async (pid: string) => {
    if (!pid) return;
    setDataLoading(true);
    setLoading(true);
    setError(null);
    try {
      // 1. Holdings 조회
      const { data: holdings, error: hErr } = await supabase
        .from('holdings')
        .select('ticker, name, quantity, currency, country, portfolio_id')
        .eq('portfolio_id', pid);
      if (hErr) throw new Error(hErr.message);
      if (!holdings || holdings.length === 0) { setStockDividends([]); setLoading(false); return; }

      const rawTickers = Array.from(new Set(holdings.map((h: any) => h.ticker as string)));

      // 2. 일본 펀드 캐시 로드
      const jpTickers = rawTickers.filter(t => {
        const h = holdings.find((hh: any) => hh.ticker === t);
        return h?.country === 'JP' && (/^[0-9A-Z]{8}$/.test(t) || t === '9I312249');
      });
      let jpFundData: any[] = [];
      if (jpTickers.length > 0) {
        const { data } = await supabase.from('japan_funds').select('*').in('fcode', jpTickers);
        jpFundData = data || [];
      }

      // 3. 가격 + 환율 로드 (raw ticker → API ticker 매핑)
      const rawToApi: Record<string, string> = {};
      const apiTickerSet = new Set<string>();
      for (const rawTicker of rawTickers) {
        const h = holdings.find((hh: any) => hh.ticker === rawTicker);
        if (h?.currency === 'JPY') continue; // JP 펀드는 제외 (아래에서 캐시로 처리)
        let apiTicker = rawTicker;
        if (/^[0-9]{6}$/.test(apiTicker)) apiTicker = `${apiTicker}.KS`;
        else if (/^[0-9]{4}$/.test(apiTicker)) apiTicker = `${apiTicker}.T`;
        rawToApi[rawTicker] = apiTicker;
        apiTickerSet.add(apiTicker);
      }
      apiTickerSet.add('USDKRW=X');
      apiTickerSet.add('JPYKRW=X');

      const priceMap: Record<string, number> = {};
      try {
        const url = `${VERCEL_API}/quote?symbols=${[...apiTickerSet].join(',')}`;
        console.log('[dividends] Price URL:', url);
        const res = await fetch(url);
        console.log('[dividends] Price Status:', res.status, res.statusText);
        if (res.ok) {
          const text = await res.text();
          console.log('[dividends] Response (first 300):', text.substring(0, 300));
          let apiRes: any;
          try { apiRes = JSON.parse(text); } catch {
            console.error('[dividends] JSON parse failed. Response:', text.substring(0, 200));
          }
          if (apiRes) {
            for (const [rawTicker, apiTicker] of Object.entries(rawToApi)) {
              const v = apiRes?.[apiTicker];
              console.log('[dividends] Price', apiTicker, '→', v?.price, 'mapped to', rawTicker);
              if (v?.price) priceMap[rawTicker] = v.price;
            }
            setExchangeRates({
              usdkrw: apiRes['USDKRW=X']?.price || 1400,
              jpykrw: apiRes['JPYKRW=X']?.price || 9.5,
            });
          }
        }
      } catch (e) { console.error('Price fetch error:', e); }

      // 일본 펀드 현재가 → Supabase 캐시에서
      for (const fund of jpFundData) {
        if (fund.price_data?.price) {
          priceMap[fund.fcode] = fund.price_data.price;
        }
      }
      setStockPrices(priceMap);

      // Fetch dividends for ALL tickers in ONE bulk API call
      const divUrl = `${VERCEL_API}/dividends?symbols=${rawTickers.join(',')}`;
      let bulkDivData: Record<string, any[]> = {};
      try {
        const divRes = await fetch(divUrl);
        if (divRes.ok) {
          bulkDivData = await divRes.json();
        }
      } catch (e) {
        console.error('Bulk dividend fetch error:', e);
      }
      
      // Cutoff: 최근 2년
      const cutoffDate = new Date();
      cutoffDate.setFullYear(cutoffDate.getFullYear() - 2);
      const cutoffStr = cutoffDate.toISOString().split('T')[0];

      const processDivList = (list: any[]) =>
        list
          .filter((d: any) => d.date >= cutoffStr && d.date && d.amount != null && d.amount > 0)
          .map((d: any) => ({ date: d.date, amount: d.amount, close: d.close ?? 0 }))
          .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Process each ticker from bulk response
      const dividendPromises = rawTickers.map(async (rawTicker: string) => {
        const holding = holdings.find((h: any) => h.ticker === rawTicker);
        const isJpFund = holding?.country === 'JP' && (/^[0-9A-Z]{8}$/.test(rawTicker) || rawTicker === '9I312249');
        const quantity = holding?.quantity || 0;
        const effectiveQty = isJpFund ? quantity / 10000 : quantity;

        let dividends: any[] = [];
        let fetchedCurrency = holding?.currency || 'USD';

        if (isJpFund) {
          const fund = jpFundData.find((f: any) => f.fcode === rawTicker);
          if (fund?.dividend_data && Array.isArray(fund.dividend_data) && fund.dividend_data.length > 0) {
            dividends = fund.dividend_data
              .map((d: any) => ({ date: d.date, amount: d.amount, close: d.close ?? 0 }))
              .filter((d: any) => d.date >= cutoffStr && d.date && d.amount != null && d.amount > 0);
          }
          fetchedCurrency = 'JPY';
        } else {
          const tData = bulkDivData[rawTicker];
          if (Array.isArray(tData) && tData.length > 0) {
            dividends = processDivList(tData);
          } else if (tData?.dividends && Array.isArray(tData.dividends) && tData.dividends.length > 0) {
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
            date: d.date,
            amount: d.amount,
            close: d.close ?? 0,
            totalForHolding: d.amount * effectiveQty,
            currency: fetchedCurrency,
          })),
          totalDividends: dividends.reduce((s, d) => s + d.amount, 0),
          totalValueForHolding: dividends.reduce((s, d) => s + d.amount * effectiveQty, 0),
          currency: fetchedCurrency,
          country: holding?.country || 'US',
        };
      });

      const results = await Promise.allSettled(dividendPromises);
      const final = results
        .filter(r => r.status === 'fulfilled' && r.value !== null)
        .map(r => (r as PromiseFulfilledResult<any>).value);

      setStockDividends(final);
    } catch (e: any) {
      setError(e.message);
      console.error(e);
    } finally {
      setLoading(false);
      setDataLoading(false);
    }
  }, []);

  useEffect(() => { if (selectedPortfolioId) fetchDividends(selectedPortfolioId); }, [selectedPortfolioId, fetchDividends]);

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
    return <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#22c55e" /><Text style={{ color: '#71717a', marginTop: 12, fontSize: 13, fontWeight: '700' }}>배당 데이터를 불러오는 중...</Text></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: insets.top }}>
      {/* Portfolio selector */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
        <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.pbtn}>
          <Text style={styles.ptxt}>{portfolios.find(p => p.id === selectedPortfolioId)?.name?.slice(0, 12) || '계좌'}</Text>
          <ChevronDown size={16} color="#71717a" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8 }}>
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
                      flex: 1, minWidth: '30%', padding: 8, borderRadius: 10, alignItems: 'center', borderWidth: 1,
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
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setShowPicker(false)}>
          <View style={{ backgroundColor: '#18181b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: 400 }} onStartShouldSetResponder={() => true}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#f4f4f5', marginBottom: 12 }}>계좌 선택</Text>
            {portfolios.map(p => (
              <TouchableOpacity key={p.id} onPress={async () => { await setSelectedPortfolioIdShared(p.id); setShowPicker(false); }} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#27272a', flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: p.id === selectedPortfolioId ? '#22c55e' : '#e4e4e7' }}>{p.name}</Text>
                {p.id === selectedPortfolioId && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  pbtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  ptxt: { fontSize: 14, fontWeight: '800', color: '#e4e4e7' },
});
