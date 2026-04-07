import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Dimensions, StyleSheet, Modal } from 'react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency, getFlag } from '@/src/utils/format';
import { TrendingUp, ChevronDown, ShieldCheck, Info } from 'lucide-react-native';
import { getTaxRate } from '@/src/utils/dividend-calc';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VERCEL_API = process.env.EXPO_PUBLIC_YAHOO_API || 'https://yahoo-finance-api-seven.vercel.app';

interface PortfolioItem { id: string; name: string; }
interface DividendEvent { date: string; amount: number; totalForHolding: number; currency: string; }
interface StockDividendData {
  ticker: string; name: string; quantity: number;
  dividends: DividendEvent[];
  totalDividends: number; totalValueForHolding: number;
  currency: string; country: string;
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
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [stockDividends, setStockDividends] = useState<StockDividendData[]>([]);
  const [exchangeRates, setExchangeRates] = useState({ usdkrw: 1400, jpykrw: 9.5 });

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

      // 3. 환율 로드 (모든 non-JP 티커 포함해서)
      const usTickers = rawTickers.filter(t => {
        const h = holdings.find((hh: any) => hh.ticker === t);
        return h && h.currency !== 'JPY';
      });
      if (usTickers.length > 0) {
        try {
          const rateTickers = [...new Set(['USDKRW=X', 'JPYKRW=X', 'KRWKRW=X'])];
          const res = await fetch(`${VERCEL_API}/quote?symbols=${rateTickers.join(',')}`);
          if (res.ok) {
            const rates = await res.json();
            setExchangeRates({
              usdkrw: rates['USDKRW=X']?.price || 1400,
              jpykrw: rates['JPYKRW=X']?.price || 9.5,
            });
          }
        } catch (e) {
          console.error('Exchange rate fetch error:', e);
        }
      }

      // 4. 종목별 배당 데이터 수집 (병렬)
      const dividendPromises = rawTickers.map(async (rawTicker: string) => {
        const holding = holdings.find((h: any) => h.ticker === rawTicker);
        const isJpFund = holding?.country === 'JP' && (/^[0-9A-Z]{8}$/.test(rawTicker) || rawTicker === '9I312249');
        const quantity = holding?.quantity || 0;
        const effectiveQty = isJpFund ? quantity / 10000 : quantity;

        let dividends: any[] = [];
        let fetchedCurrency = holding?.currency || 'USD';

        if (isJpFund) {
          // 일본 펀드 → Supabase japan_funds 캐시
          const fund = jpFundData.find((f: any) => f.fcode === rawTicker);
          if (fund?.dividend_data && Array.isArray(fund.dividend_data) && fund.dividend_data.length > 0) {
            dividends = fund.dividend_data
              .map((d: any) => ({ date: d.date, amount: d.amount }))
              .filter((d: any) => d.date && d.amount != null);
          }
          fetchedCurrency = 'JPY';
        } else {
          // US/KR → Yahoo Finance API 경유
          let ticker = rawTicker;
          if (/^[0-9]{6}$/.test(ticker)) ticker = `${ticker}.KS`;
          if (/^[0-9]{4}$/.test(ticker)) ticker = `${ticker}.T`;

          try {
            const apiRes = await fetch(`${VERCEL_API}/dividends?symbols=${ticker}&years=5`);
            if (apiRes.ok) {
              const j = await apiRes.json();
              // Response: { "AAPL": { dividends: [...], currency: "USD" }, "005930.KS": { ... } }
              const tData = j?.[ticker];
              if (tData?.dividends && Array.isArray(tData.dividends) && tData.dividends.length > 0) {
                dividends = tData.dividends
                  .map((d: any) => ({ date: d.date, amount: d.amount }))
                  .filter((d: any) => d.date && d.amount != null)
                  .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
                fetchedCurrency = tData.currency || holding?.currency || 'USD';
              }
            }
          } catch (e: any) {
            console.error(`Dividend fetch error ${ticker}:`, e.message);
          }
        }

        if (dividends.length === 0) return null;

        const tax = getTaxRate(holding?.country || 'US', isAfterTax);
        return {
          ticker: rawTicker,
          name: holding?.name || rawTicker,
          quantity: effectiveQty,
          dividends: dividends.map((d: any) => ({
            date: d.date,
            amount: d.amount,
            totalForHolding: d.amount * effectiveQty * tax,
            currency: fetchedCurrency,
          })),
          totalDividends: dividends.reduce((s, d) => s + d.amount, 0),
          totalValueForHolding: dividends.reduce((s, d) => s + d.amount * effectiveQty * tax, 0),
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
    }
  }, [isAfterTax]);

  useEffect(() => { if (selectedPortfolioId) fetchDividends(selectedPortfolioId); }, [selectedPortfolioId, fetchDividends]);

  // ── Helpers ──
  const convKrw = useCallback((amt: number, cur: string) => {
    if (cur === 'KRW') return amt;
    if (cur === 'USD') return amt * exchangeRates.usdkrw;
    if (cur === 'JPY') return amt * exchangeRates.jpykrw;
    return amt;
  }, [exchangeRates]);

  // ── Monthly aggregation ──
  const monthlyData = useMemo(() => {
    if (!stockDividends.length) return [];
    const cy = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    return Array.from({ length: 12 }, (_, m) => {
      let total = 0;
      for (const sd of stockDividends) {
        const act = sd.dividends.find(d => {
          const dd = new Date(d.date);
          return dd.getFullYear() === cy && dd.getMonth() === m;
        });
        if (act) {
          total += convKrw(act.totalForHolding, sd.currency);
        }
      }
      return {
        month: m,
        label: `${m + 1}월`,
        value: Math.round(total),
        type: m <= currentMonth ? 'actual' as const : 'estimate' as const,
      };
    });
  }, [stockDividends, convKrw]);

  const totalAnnual = monthlyData.reduce((s, m) => s + m.value, 0);
  const monthVal = selectedMonth !== null ? monthlyData[selectedMonth]?.value ?? 0 : 0;

  if (loading && !stockDividends.length) {
    return <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#22c55e" /><Text style={{ color: '#71717a', marginTop: 12, fontSize: 13, fontWeight: '700' }}>배당 데이터를 불러오는 중...</Text></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
        <TouchableOpacity onPress={() => setShowPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: '#e4e4e7' }}>{portfolios.find(p => p.id === selectedPortfolioId)?.name?.slice(0, 12) || '계좌'}</Text>
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
              <Text style={{ fontSize: 9, color: '#71717a', marginTop: 2, fontWeight: '700' }}>{stockDividends.length}종목 · 실제 지급 기준</Text>
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
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#3b82f6' }} /><Text style={{ fontSize: 10, color: '#52525b', fontWeight: '700' }}>예상</Text>
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
          <Text style={{ fontSize: 10, fontWeight: '900', color: '#3f3f46', letterSpacing: 2 }}>종목별 배당 현황</Text>
          <Text style={{ fontSize: 10, color: '#52525b', fontWeight: '800' }}>{stockDividends.length}종목</Text>
        </View>

        {stockDividends.map((sd: StockDividendData) => {
          const yearTotal = sd.dividends.filter(d => new Date(d.date).getFullYear() === new Date().getFullYear()).reduce((s, d) => s + convKrw(d.totalForHolding, sd.currency), 0);

          return (
            <View key={sd.ticker} style={{ backgroundColor: '#18181b', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#27272a', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '900', color: '#f4f4f5' }}>{sd.name}</Text>
                  <Text style={{ fontSize: 10, color: '#71717a', fontWeight: '700', marginTop: 2 }}>{sd.ticker} · {getFlag(sd.country === 'JP' ? 'JP' : sd.country === 'KR' ? 'KR' : 'US')} {sd.quantity}주</Text>
                </View>
                <Text style={{ fontSize: 16, fontWeight: '900', color: '#f4f4f5' }}>{formatCurrency(yearTotal)}</Text>
              </View>

              {sd.dividends.slice(0, 8).map((d: any, i: number) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: i < Math.min(sd.dividends.length, 8) - 1 ? 1 : 0, borderBottomColor: '#27272a' }}>
                  <Text style={{ fontSize: 12, color: '#71717a' }}>{d.date}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#e4e4e7' }}>{formatCurrency(d.totalForHolding, sd.currency)}</Text>
                </View>
              ))}
            </View>
          );
        })}

        {stockDividends.length === 0 && !loading && (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Text style={{ color: '#52525b', fontSize: 13, fontWeight: '700' }}>배당 데이터가 없습니다</Text>
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
