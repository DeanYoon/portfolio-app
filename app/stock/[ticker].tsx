import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl, Dimensions } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, Wallet, Clock, Info } from 'lucide-react-native';
import { supabase } from '@/src/lib/supabase';
import { formatCurrency, formatRate, getFlag, getCountry } from '@/src/utils/format';
import Svg, { Defs, LinearGradient, Stop, Line, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');
const SPARKLINE_H = 200;
const SPARKLINE_PAD = { top: 12, bottom: 28, left: 10, right: 10 };

const VERCEL_API = process.env.EXPO_PUBLIC_YAHOO_API || 'https://yahoo-finance-api-seven.vercel.app';
const isJapaneseFund = (ticker: string) => /^[0-9A-Z]{8}$/i.test(ticker);

interface PriceData {
  price: number;
  name: string;
  change_amount: number;
  change_percent: number;
  currency: string;
  last_updated: string;
  error?: string;
}

interface HistoryPoint {
  date: string;
  close: number;
}

export default function StockDetailScreen() {
  const { ticker: encodedTicker } = useLocalSearchParams<{ ticker: string }>();
  const ticker = encodedTicker ? decodeURIComponent(encodedTicker) : '';
  const insets = useSafeAreaInsets();
  
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [holdings, setHoldings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState('6mo');

  const fetchStockData = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);

    try {
      const isJp = isJapaneseFund(ticker);
      const isCash = ticker.startsWith('CASH_');

      if (isCash) {
        // 현금 자산 처리
        const cur = ticker.split('_')[1] || 'USD';
        // 환율 정보 가져오기 (Yahoo Finance 연동)
        const fxTicker = cur === 'KRW' ? null : `${cur}KRW=X`;
        let currentFxPrice = 1;

        if (fxTicker) {
          try {
            const fxRes = await fetch(`${VERCEL_API}/quote?symbols=${fxTicker}`);
            const fxJson = await fxRes.json();
            if (fxJson?.[fxTicker]?.price) {
              currentFxPrice = fxJson[fxTicker].price;
            }
          } catch (e) {
            console.error('FX fetch error:', e);
            // 실패 시 기본값 (기존 캐시 등 활용 가능하지만 여기선 fallback)
            currentFxPrice = cur === 'USD' ? 1400 : (cur === 'JPY' ? 9.5 : 1);
          }
        }

        setPriceData({
          price: currentFxPrice,
          name: `${cur} Cash`,
          change_amount: 0,
          change_percent: 0,
          currency: 'KRW', // 현금 자산의 상세페이지 가치는 원화 환산가로 표시
          last_updated: new Date().toISOString(),
        });
        setHistory([]);
      } else if (isJp) {
        // 일본 펀드 처리
        const { data: fundData } = await supabase
          .from('japan_funds')
          .select('*')
          .eq('fcode', ticker)
          .single();

        if (fundData?.price_data) {
          const pd = fundData.price_data;
          setPriceData({
            price: pd.price,
            name: pd.name || ticker,
            change_amount: pd.change_amount || 0,
            change_percent: pd.change_percent || 0,
            currency: 'JPY',
            last_updated: pd.last_updated || new Date().toISOString(),
          });
        }
        setHistory([]);
      } else {
        // 주식 (US/KR) 처리
        const [quoteRes, historyRes] = await Promise.all([
          fetch(`${VERCEL_API}/quote?symbols=${ticker}`).catch(() => null),
          fetch(`${VERCEL_API}/history?symbols=${ticker}&period=${period}`).catch(() => null),
        ]);

        if (quoteRes?.ok) {
          const quoteJson = await quoteRes.json();
          const q = quoteJson?.[ticker];
          if (q?.price) {
            setPriceData({
              price: q.price,
              name: q.name || q.symbol || ticker,
              change_amount: q.change || 0,
              change_percent: q.changePercent || 0,
              currency: q.currency || 'USD',
              last_updated: new Date().toISOString(),
            });
          }
        }

        if (historyRes?.ok) {
          const histJson = await historyRes.json();
          if (histJson?.[ticker] && typeof histJson[ticker] === 'object' && !Array.isArray(histJson[ticker])) {
            const entries = Object.entries(histJson[ticker]);
            const points = entries
              .map(([date, bar]: [string, any]) => ({ date, close: bar.close }))
              .filter((b: any) => b.close != null)
              .sort((a, b) => a.date.localeCompare(b.date));
            setHistory(points);
          }
        }
      }

      // 보유 여부 확인 (항상 실행)
      const { data: user } = await supabase.auth.getUser();
      if (user?.user) {
        const { data: hData } = await supabase
          .from('holdings')
          .select('*, portfolios(name)')
          .eq('ticker', ticker);
        setHoldings(hData || []);
      }
    } catch (e: any) {
      console.error('Error fetching stock detail:', e);
      // 에러 발생 시에도 최소한의 이름 정보 표시
      if (!priceData) {
        setPriceData({
          price: 0,
          name: ticker,
          change_amount: 0,
          change_percent: 0,
          currency: 'USD',
          last_updated: new Date().toISOString(),
          error: '데이터를 가져올 수 없습니다.'
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ticker, period, priceData]);


  useEffect(() => {
    fetchStockData();
  }, [fetchStockData]);

  // Set page title for web
  useEffect(() => {
    if (priceData?.name) {
      document.title = `${priceData.name} (${ticker}) — 상세 정보`;
    }
  }, [priceData, ticker]);

  // Mini chart data
  const chartLine = useMemo(() => {
    if (history.length < 2) return '';
    const innerW = width - 32 - SPARKLINE_PAD.left - SPARKLINE_PAD.right;
    const innerH = SPARKLINE_H - SPARKLINE_PAD.top - SPARKLINE_PAD.bottom;
    const closes = history.map(h => h.close);
    const minC = Math.min(...closes);
    const maxC = Math.max(...closes);
    const range = maxC - minC || 1;

    return history.map((h, i) => {
      const x = SPARKLINE_PAD.left + (i / (history.length - 1)) * innerW;
      const y = SPARKLINE_PAD.top + innerH - ((h.close - minC) / range) * innerH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }, [history]);

  const chartArea = useMemo(() => {
    if (history.length < 2 || !chartLine) return '';
    const innerW = width - 32 - SPARKLINE_PAD.left - SPARKLINE_PAD.right;
    const bottomY = SPARKLINE_H - SPARKLINE_PAD.bottom;
    return chartLine + ` L${(SPARKLINE_PAD.left + innerW).toFixed(1)},${bottomY} L${SPARKLINE_PAD.left},${bottomY} Z`;
  }, [history, chartLine]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStockData();
  }, [fetchStockData]);

  if (loading && !priceData) {
    return <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#22c55e" /></View>;
  }

  if (!priceData && !loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Info size={48} color="#71717a" />
        <Text style={{ color: '#f4f4f5', fontSize: 16, fontWeight: '800', marginTop: 16 }}>종목 정보를 찾을 수 없습니다</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#27272a', borderRadius: 8 }}>
          <Text style={{ color: '#e4e4e7', fontWeight: '700' }}>뒤로 가기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!priceData) return null;

  const isPositive = priceData.change_percent >= 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: insets.top }}>
      {/* Fixed Header */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#27272a', backgroundColor: '#09090b' }}>
        <TouchableOpacity onPress={() => { try { if (typeof window !== 'undefined' && window.history.length > 1) window.history.back(); else router.replace('/'); } catch { router.replace('/'); } }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} hitSlop={12}>
          <ArrowLeft size={24} color="#e4e4e7" style={{ flexShrink: 0 }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: '#f4f4f5' }} numberOfLines={1}>{priceData.name.length > 10 ? priceData.name.slice(0, 10) + '...' : priceData.name}</Text>
            <Text style={{ fontSize: 12, color: '#71717a' }} numberOfLines={1}>{ticker}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      >
        {/* 현재가 및 차트 */}
        <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#27272a', marginBottom: 24 }}>
          <Text style={{ fontSize: 36, fontWeight: '900', color: '#f4f4f5', letterSpacing: -1 }}>
            {priceData.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: isPositive ? '#ef4444' : '#3b82f6' }}>
              {isPositive ? '+' : ''}{priceData.change_amount.toFixed(2)} ({isPositive ? '+' : ''}{priceData.change_percent.toFixed(2)}%)
            </Text>
          </View>

          {/* Price sparkline chart */}
          {chartLine ? (
            <View style={{ height: SPARKLINE_H, backgroundColor: '#09090b', borderRadius: 12, borderWidth: 1, borderColor: '#27272a', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
              <Svg width={width - 32} height={SPARKLINE_H}>
                <Defs>
                  <LinearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={isPositive ? '#ef4444' : '#3b82f6'} stopOpacity="0.3" />
                    <Stop offset="100%" stopColor={isPositive ? '#ef4444' : '#3b82f6'} stopOpacity="0.02" />
                  </LinearGradient>
                </Defs>
                {chartArea ? <Path d={chartArea} fill="url(#sparkGrad)" /> : null}
                {chartLine ? <Path d={chartLine} fill="none" stroke={isPositive ? '#ef4444' : '#3b82f6'} strokeWidth={2} strokeLinejoin="round" /> : null}
                {/* End dot */}
                {(() => {
                  if (history.length < 2) return null;
                  const lastX = (width - 32 - SPARKLINE_PAD.right);
                  const closes = history.map(h => h.close);
                  const minC = Math.min(...closes);
                  const maxC = Math.max(...closes);
                  const range = maxC - minC || 1;
                  const innerH = SPARKLINE_H - SPARKLINE_PAD.top - SPARKLINE_PAD.bottom;
                  const lastY = SPARKLINE_PAD.top + innerH - ((history[history.length - 1].close - minC) / range) * innerH;
                  return <circle cx={lastX} cy={lastY} r={4} fill={isPositive ? '#ef4444' : '#3b82f6'} />;
                })()}
              </Svg>
            </View>
          ) : (
            <View style={{ height: SPARKLINE_H, backgroundColor: '#09090b', borderRadius: 12, borderWidth: 1, borderColor: '#27272a', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: '#52525b', fontSize: 13 }}>데이터 없음</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            {['1mo', '6mo', '1y'].map(p => (
              <TouchableOpacity
                key={p}
                onPress={() => setPeriod(p)}
                style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: period === p ? '#22c55e' : '#27272a', alignItems: 'center' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: period === p ? '#052e16' : '#71717a' }}>{p.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 내 포지션 */}
        {holdings.length > 0 && (
          <View style={{ marginBottom: 24, backgroundColor: '#18181b', borderRadius: 24, borderWidth: 1, borderColor: '#27272a', padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Wallet size={16} color="#71717a" />
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 2 }}>MY POSITION</Text>
            </View>
            {holdings.map((h, i) => {
              const profitValue = (priceData.price - h.avg_price) * h.quantity;
              const profitRate = ((priceData.price - h.avg_price) / h.avg_price) * 100;
              const isProfit = profitValue >= 0;

              return (
                <View key={i} style={{ marginBottom: i === holdings.length - 1 ? 0 : 20 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#71717a', marginBottom: 8 }}>{h.portfolios?.name}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <View>
                      <Text style={{ fontSize: 20, fontWeight: '900', color: '#f4f4f5' }}>{h.quantity.toLocaleString()} 주</Text>
                      <Text style={{ fontSize: 12, color: '#52525b' }}>평균단가: {h.avg_price.toLocaleString()}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 18, fontWeight: '900', color: isProfit ? '#ef4444' : '#3b82f6' }}>
                        {isProfit ? '+' : ''}{profitValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: isProfit ? '#ef4444' : '#3b82f6' }}>{formatRate(profitRate)}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#27272a' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Clock size={16} color="#71717a" />
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 2 }}>MARKET INFO</Text>
          </View>
          <InfoRow label="Symbol" value={ticker} />
          <InfoRow label="Currency" value={priceData.currency} />
          <InfoRow label="Update" value={new Date(priceData.last_updated).toLocaleString()} />
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#27272a' }}>
      <Text style={{ fontSize: 13, color: '#71717a' }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: '#e4e4e7' }}>{value}</Text>
    </View>
  );
}
