import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Dimensions, StyleSheet, Modal, Platform } from 'react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency, getFlag } from '@/src/utils/format';
import { TrendingUp, ChevronDown, ShieldCheck, Info } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTaxRate, calculateDividendYield, calculateLatestTrendEstimate, TrendEstimate } from '@/src/utils/dividend-calc';
import { endOfMonth, isPast, isSameMonth, parseISO, format } from 'date-fns';
import { CartesianChart, Bar, CartesianAxis } from 'victory-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 56;

interface PortfolioItem { id: string; name: string; }
interface DividendEvent { date: string; amount: number; totalForHolding: number; currency: string; }
interface StockDividendData {
  ticker: string; name: string; quantity: number;
  dividends: DividendEvent[];
  totalDividends: number; totalValueForHolding: number;
  currency: string; country: string;
}

const CACHE_KEY_DIV = 'global_dividend_data_cache_v2';
const CACHE_KEY_MKT = 'market_data_cache_v2';
const CACHE_KEY_HIST = 'historical_price_cache_v7';
const CACHE_TTL = 24 * 60 * 60 * 1000;

export default function DividendsScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isKrwMode, setIsKrwMode] = useState(true);
  const [isAfterTax, setIsAfterTax] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [portfolios, setPortfolios] = useState<PortfolioItem[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [stockDividends, setStockDividends] = useState<StockDividendData[]>([]);
  const [exchangeRates, setExchangeRates] = useState({ usdkrw: 1400, jpykrw: 9.5 });
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const [historicalPrices, setHistoricalPrices] = useState<Record<string, any>>({});

  // ── Portfolios ──
  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase.from('portfolios').select('id, name').eq('user_id', session.user.id);
      if (data?.length) { setPortfolios(data); setSelectedPortfolioId(data[0].id); }
    })();
  }, [session]);

  // ── Fetch dividends ──
  const fetchDividends = useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    setError(null);
    try {
      // Check cache
      const cacheStr = await AsyncStorage.getItem(CACHE_KEY_DIV);
      const cache = cacheStr ? JSON.parse(cacheStr) : { items: {} };
      const cached = cache.items[pid];
      const isFresh = cached?.data?.length && Date.now() - (cached.ts || cached.last_updated || 0) < CACHE_TTL;

      if (isFresh) {
        setStockDividends(cached.data);
      } else {
        const resp = await fetch(`/api/portfolio/${pid}/dividends`);
        if (resp.status === 502) throw new Error('JP 데이터 오류');
        if (!resp.ok) throw new Error(`API ${resp.status}`);
        const data = await resp.json();
        setStockDividends(data);
        cache.items[pid] = { ts: Date.now(), data };
        await AsyncStorage.setItem(CACHE_KEY_DIV, JSON.stringify(cache));
      }

      // Load market cache
      const mktStr = await AsyncStorage.getItem(CACHE_KEY_MKT);
      if (mktStr) {
        const mkt = JSON.parse(mktStr);
        if (mkt.prices) setStockPrices(mkt.prices);
        if (mkt.exchangeRates) setExchangeRates(mkt.exchangeRates);
      }

      // Refresh prices if missing
      if (stockDividends.length === 0) {
        fetchPrices();
      }
    } catch (e: any) {
      setError(e.message);
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [stockDividends.length]);

  useEffect(() => { if (selectedPortfolioId) fetchDividends(selectedPortfolioId); }, [selectedPortfolioId, fetchDividends]);

  const fetchPrices = useCallback(async () => {
    if (stockDividends.length === 0) return;
    try {
      const tickers = [...new Set(stockDividends.map(d => d.ticker)), 'USDKRW=X', 'JPYKRW=X'];
      const resp = await fetch('/api/refresh-prices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers })
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.prices) setStockPrices(data.prices);
        if (data.exchangeRates) setExchangeRates(data.exchangeRates);
        await AsyncStorage.setItem(CACHE_KEY_MKT, JSON.stringify(data));
      }
    } catch (e: any) { console.warn('Price fetch failed:', e.message); }
  }, [stockDividends]);

  // ── Historical prices ──
  useEffect(() => {
    if (stockDividends.length === 0 || !selectedPortfolioId) return;
    const run = async () => {
      const ck = `${CACHE_KEY_HIST}_${selectedPortfolioId}`;
      const cached = await AsyncStorage.getItem(ck);
      if (cached) {
        try {
          const p = JSON.parse(cached);
          if (Date.now() - (p.ts || 0) < CACHE_TTL) { setHistoricalPrices(p.data); return; }
        } catch { /* ignore */ }
      }
      const tickers = [...new Set(stockDividends.map(d => d.ticker))];
      const hist: Record<string, any> = {};
      for (const t of tickers) {
        try {
          const start = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);
          const end = Math.floor(Date.now() / 1000);
          const res = await fetch(`/api/historical?ticker=${t}&period1=${start}&period2=${end}`);
          if (res.ok) {
            const d = await res.json();
            const ly = new Date(); ly.setFullYear(ly.getFullYear() - 1);
            hist[t] = { dividendDatePrices: d || {}, lastYearSameMonthPrice: d?.[format(ly, 'yyyy-MM-dd')] || null };
          }
        } catch {}
      }
      setHistoricalPrices(hist);
      await AsyncStorage.setItem(ck, JSON.stringify({ ts: Date.now(), data: hist }));
    };
    const timer = setTimeout(run, 500);
    return () => clearTimeout(timer);
  }, [stockDividends, selectedPortfolioId]);

  // ── Helpers ──
  const convKrw = useCallback((amt: number, cur: string) => {
    if (cur === 'KRW') return amt;
    if (cur === 'USD') return amt * exchangeRates.usdkrw;
    if (cur === 'JPY') return amt * exchangeRates.jpykrw;
    return amt;
  }, [exchangeRates]);

  const fmtC = useCallback((amt: number, cur: string, forceKrw = false) => {
    if (forceKrw || isKrwMode) return formatCurrency(convKrw(amt, cur));
    return formatCurrency(amt, cur);
  }, [isKrwMode, convKrw]);

  // ── Monthly aggregation ──
  const monthlyData: { month: number; label: string; value: number; type: 'actual' | 'estimate' }[] = useMemo(() => {
    if (!stockDividends.length) return [];
    const cy = new Date().getFullYear();
    const today = new Date();
    return Array.from({ length: 12 }, (_, m) => {
      let total = 0;
      for (const sd of stockDividends) {
        const tax = getTaxRate(sd.country, isAfterTax);
        // actual?
        const act = sd.dividends.find(d => { const dd = new Date(d.date); return dd.getFullYear() === cy && dd.getMonth() === m; });
        if (act) {
          total += convKrw(act.totalForHolding * tax, sd.currency);
        } else {
          const est = calculateLatestTrendEstimate(
            sd.dividends as any, historicalPrices,
            stockPrices[sd.ticker] || 0, m, cy, sd.ticker,
            isKrwMode, 1
          );
          total += convKrw(est.amount * sd.quantity * tax, sd.currency);
        }
      }
      const md = new Date(cy, m, 15);
      const past = isPast(endOfMonth(md)) && !isSameMonth(md, today);
      return { month: m, label: `${m + 1}월`, value: Math.round(total), type: past ? 'actual' : 'estimate' };
    });
  }, [stockDividends, historicalPrices, stockPrices, isKrwMode, isAfterTax, convKrw]);

  const totalAnnual = monthlyData.reduce((s, m) => s + m.value, 0);
  const monthVal = selectedMonth !== null ? monthlyData[selectedMonth]?.value ?? 0 : 0;

  // ── Stock analysis list ──
  const analysisList = useMemo(() => {
    if (!stockDividends.length) return [];
    const cy = new Date().getFullYear();
    return stockDividends.map(sd => {
      const tax = getTaxRate(sd.country, isAfterTax);
      const a = calculateDividendYield(sd.dividends as any, stockPrices[sd.ticker] || 0, sd.ticker);
      const estimates: TrendEstimate[] = Array.from({ length: 12 }, (_, m) =>
        calculateLatestTrendEstimate(sd.dividends as any, historicalPrices, stockPrices[sd.ticker] || 0, m, cy, sd.ticker, isKrwMode, 1)
      );
      const annualKrw = estimates.reduce((s, e) => s + convKrw(e.amount * sd.quantity * tax, sd.currency), 0);
      return { ticker: sd.ticker, name: sd.name, country: sd.country, currency: sd.currency, quantity: sd.quantity, analysis: a, estimates, tax, annualKrw };
    }).sort((a, b) => b.annualKrw - a.annualKrw);
  }, [stockDividends, stockPrices, historicalPrices, isKrwMode, isAfterTax, convKrw]);

  const filteredList = selectedMonth === null ? analysisList : analysisList.filter(s => s.estimates[selectedMonth]?.amount > 0);
  const isPos = totalAnnual >= 0;

  if (loading && !stockDividends.length) {
    return (
      <View style={[styles.c, { paddingTop: insets.top, justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color="#22c55e" />
        <Text style={styles.ld}>배당 데이터를 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.c, { paddingTop: insets.top }]}>
      {/* Portfolio selector */}
      <View style={styles.ph}>
        <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.pbtn}>
          <Text style={styles.ptxt}>{portfolios.find(p => p.id === selectedPortfolioId)?.name?.slice(0, 12) || '계좌'}</Text>
          <ChevronDown size={16} color="#71717a" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8 }}>
        {/* Controls */}
        <View style={styles.row}>
          <TouchableOpacity onPress={() => setIsAfterTax(!isAfterTax)} style={[styles.pill, isAfterTax && styles.pillA]}>
            <ShieldCheck size={14} color={isAfterTax ? '#052e16' : '#71717a'} />
            <Text style={[styles.ptl, isAfterTax && styles.pila]}>세후 수령액</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsKrwMode(!isKrwMode)} style={[styles.pill, { marginLeft: 'auto' }]}>
            <Info size={14} color="#71717a" />
            <Text style={styles.ptl}>{isKrwMode ? 'KRW (₩)' : '원본 통화'}</Text>
          </TouchableOpacity>
        </View>

        {/* Chart — simple bar chart in pure RN */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text style={styles.ct}>📊 연간 배당 흐름</Text>
              <Text style={styles.cs}>트렌드 예측 모델</Text>
            </View>
            <TrendingUp size={24} color="#27272a" style={{ opacity: 0.3 }} />
          </View>

          {stockDividends.length > 0 ? (
            <ChartBars
              data={monthlyData}
              selected={selectedMonth}
              onSelect={setSelectedMonth}
            />
          ) : (
            <View style={{ height: 180, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={styles.em}>배당 데이터가 없습니다</Text>
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
        <View style={[styles.card, styles.summary]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={styles.st}>{selectedMonth !== null ? `${selectedMonth + 1}월 배당 리포트` : '2026 전체 배당'}</Text>
            <View style={{ flexDirection: 'row', backgroundColor: '#09090b', borderRadius: 8, padding: 2 }}>
              <TouchableOpacity onPress={() => setSelectedMonth(new Date().getMonth())} style={[styles.vt, selectedMonth !== null && styles.vta]}>
                <Text style={[styles.vtl, selectedMonth !== null && styles.vtla]}>월별</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSelectedMonth(null)} style={[styles.vt, selectedMonth === null && styles.vta]}>
                <Text style={[styles.vtl, selectedMonth === null && styles.vtla]}>연간</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.sa}>{formatCurrency(selectedMonth !== null ? monthVal : totalAnnual)}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={styles.bg}><View style={[styles.bd, { backgroundColor: '#4ade80' }]} /><Text style={styles.bgt}>지급 완료</Text></View>
            <View style={styles.bg}><View style={[styles.bd, { backgroundColor: '#3b82f6' }]} /><Text style={styles.bgt}>트렌드 예측</Text></View>
          </View>
        </View>

        {/* Stock list */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={styles.sect}>{selectedMonth !== null ? `${selectedMonth + 1}월 종목별` : '전체 배당 현황'}</Text>
          <Text style={{ fontSize: 10, color: '#52525b', fontWeight: '800' }}>{filteredList.length}종목</Text>
        </View>

        {filteredList.map((s: any) => {
          const est = selectedMonth !== null ? s.estimates[selectedMonth] : null;
          return (
            <View key={s.ticker} style={styles.sc}>
              <View style={styles.sh}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sn}>{s.name}</Text>
                  <Text style={styles.sk}>{s.ticker} · {getFlag(s.country === 'JP' ? 'JP' : s.country === 'KR' ? 'KR' : 'US')} {s.quantity}주</Text>
                </View>
                <Text style={styles.stot}>{isKrwMode ? formatCurrency(s.annualKrw) : `${s.currency === 'USD' ? '$' : '¥'}${(s.annualKrw / (s.currency === 'USD' ? exchangeRates.usdkrw : exchangeRates.jpykrw)).toFixed(2)}`}</Text>
              </View>

              {/* Yield */}
              <View style={styles.yb}>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                  <View style={[styles.ybg, { backgroundColor: '#052e16' }]}><Text style={[styles.ybt, { color: '#4ade80' }]}>최근 {s.analysis.singleYieldPercent.toFixed(2)}%</Text></View>
                  {s.analysis.paymentsPerYear > 0 && (
                    <View style={[styles.ybg, { backgroundColor: '#172554' }]}><Text style={[styles.ybt, { color: '#3b82f6' }]}>연환산 {s.analysis.yieldPercent.toFixed(2)}%</Text></View>
                  )}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View><Text style={styles.yl}>지급주기</Text><Text style={styles.yv}>{s.analysis.isMonthly ? '매월' : `연 ${s.analysis.paymentsPerYear || 4}회`}</Text></View>
                  <View><Text style={styles.yl}>현재가</Text><Text style={styles.yv}>{formatCurrency(s.analysis.currentPrice, s.currency)}</Text></View>
                  <View><Text style={styles.yl}>연간예상</Text><Text style={[styles.yv, { color: '#22c55e' }]}>{formatCurrency(s.analysis.annualDividendPerShare, s.currency)}</Text></View>
                </View>
              </View>

              {/* Monthly or single month */}
              {selectedMonth === null ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                  {s.estimates.map((e: any, i: number) => e.amount > 0 ? (
                    <TouchableOpacity key={i} onPress={() => setSelectedMonth(i)} style={[
                      { width: (SCREEN_WIDTH - 104) / 3, padding: 8, borderRadius: 10, alignItems: 'center', borderWidth: 1 },
                      { backgroundColor: e.calculationMethod === 'actual' ? 'rgba(74,222,128,0.08)' : 'rgba(59,130,246,0.08)', borderColor: e.calculationMethod === 'actual' ? 'rgba(74,222,128,0.15)' : 'rgba(59,130,246,0.15)' }
                    ]}>
                      <Text style={{ fontSize: 9, color: '#71717a', fontWeight: '700' }}>{i + 1}월</Text>
                      <Text style={{ fontSize: 10, fontWeight: '900', color: e.calculationMethod === 'actual' ? '#4ade80' : '#3b82f6' }}>
                        {formatCurrency(convKrw(e.amount * s.quantity * s.tax, s.currency))}
                      </Text>
                    </TouchableOpacity>
                  ) : null)}
                </View>
              ) : est && est.amount > 0 ? (
                <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: '#27272a', paddingTop: 12 }}>
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
          <View style={{ padding: 40, alignItems: 'center' }}><Text style={styles.em}>이 달에 배당이 없습니다</Text></View>
        )}

        {error && (
          <View style={{ padding: 12, backgroundColor: '#1c0a0a', borderRadius: 12, borderWidth: 1, borderColor: '#7f1d1d', marginBottom: 16 }}>
            <Text style={{ color: '#fca5a5', fontSize: 12, fontWeight: '700' }}>⚠️ {error}</Text>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Portfolio picker modal */}
      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setShowPicker(false)}>
          <View style={{ backgroundColor: '#18181b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: 400 }} onStartShouldSetResponder={() => true}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#f4f4f5', marginBottom: 12 }}>계좌 선택</Text>
            {portfolios.map(p => (
              <TouchableOpacity key={p.id} onPress={() => { setSelectedPortfolioId(p.id); setShowPicker(false); }} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#27272a', flexDirection: 'row', justifyContent: 'space-between' }}>
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

/* ═══════════════════════════════════════════
   Simple bar chart (pure RN, no Victory)
   ═══════════════════════════════════════════ */
function ChartBars({ data, selected, onSelect }: { data: any[]; selected: number | null; onSelect: (m: number) => void }) {
  const maxVal = Math.max(...data.map(m => m.value), 1);
  const barH = 170;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: barH, justifyContent: 'space-between', marginTop: 12 }}>
      {data.map((d: any) => {
        const h = Math.max((d.value / maxVal) * (barH - 24), 2);
        const col = d.type === 'actual' ? '#4ade80' : '#3b82f6';
        const isActive = selected !== null && selected === d.month;
        return (
          <TouchableOpacity
            key={d.month}
            onPress={() => onSelect(d.month)}
            style={{
              flex: 1, alignItems: 'center', justifyContent: 'flex-end',
              opacity: selected !== null && !isActive ? 0.4 : 0.9,
            }}
          >
            <View style={{ width: '60%', height: h, backgroundColor: col, borderRadius: 4, minWidth: 8 }} />
            <Text style={{ fontSize: 8, color: '#52525b', fontWeight: '700', marginTop: 4 }}>{d.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ═══════════════════════════════════════════
   Styles
   ═══════════════════════════════════════════ */
const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#09090b' },
  ld: { color: '#71717a', marginTop: 12, fontSize: 13, fontWeight: '700' },
  em: { color: '#52525b', fontSize: 13, fontWeight: '700' },
  ph: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  pbtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  ptxt: { fontSize: 14, fontWeight: '800', color: '#e4e4e7' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a' },
  pillA: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  ptl: { fontSize: 11, fontWeight: '800', color: '#71717a' },
  pila: { color: '#052e16' },
  card: { backgroundColor: '#18181b', borderRadius: 24, padding: 16, borderWidth: 1, borderColor: '#27272a', marginBottom: 16 },
  summary: { backgroundColor: '#18181b' },
  ct: { fontSize: 14, fontWeight: '900', color: '#f4f4f5' },
  cs: { fontSize: 9, color: '#71717a', marginTop: 2, fontWeight: '700' },
  st: { fontSize: 10, fontWeight: '900', color: '#71717a', letterSpacing: 1 },
  sa: { fontSize: 42, fontWeight: '900', color: '#f4f4f5', letterSpacing: -2, marginBottom: 10 },
  vt: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  vta: { backgroundColor: '#22c55e' },
  vtl: { fontSize: 9, fontWeight: '700', color: '#71717a' },
  vtla: { color: '#052e16' },
  bg: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#09090b', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#27272a' },
  bd: { width: 6, height: 6, borderRadius: 3 },
  bgt: { fontSize: 9, color: '#52525b', fontWeight: '800' },
  sect: { fontSize: 10, fontWeight: '900', color: '#3f3f46', letterSpacing: 2 },
  sc: { backgroundColor: '#18181b', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#27272a', marginBottom: 12 },
  sh: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  sn: { fontSize: 15, fontWeight: '900', color: '#f4f4f5' },
  sk: { fontSize: 10, color: '#71717a', fontWeight: '700', marginTop: 2 },
  stot: { fontSize: 16, fontWeight: '900', color: '#f4f4f5' },
  yb: { backgroundColor: '#09090b', borderRadius: 12, padding: 10 },
  ybg: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  ybt: { fontSize: 10, fontWeight: '900' },
  yl: { fontSize: 8, color: '#52525b', fontWeight: '700', marginBottom: 2 },
  yv: { fontSize: 11, fontWeight: '800', color: '#a1a1aa' },
});
