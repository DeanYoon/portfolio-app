import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl, Dimensions } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, Wallet, Clock, Info } from 'lucide-react-native';
import { supabase } from '@/src/lib/supabase';
import { formatCurrency, formatRate, getFlag, getCountry } from '@/src/utils/format';
// VictoryNative imports removed for v36 compatibility; placeholder chart used

const { width } = Dimensions.get('window');

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
  
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [holdings, setHoldings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState('1mo'); // 1mo, 6mo, 1y

  const fetchStockData = async () => {
    if (!ticker) return;
    setLoading(true);

    try {
      // 1. 시세 및 히스토리 가져오기
      const [quoteRes, historyRes] = await Promise.all([
        fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
        fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${period}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      ]);

      const quoteJson = await quoteRes.json();
      const historyJson = await historyRes.json();

      const qResult = quoteJson?.chart?.result?.[0];
      if (qResult) {
        const meta = qResult.meta;
        setPriceData({
          price: meta.regularMarketPrice || 0,
          name: meta.longName || meta.shortName || ticker,
          change_amount: meta.regularMarketChange || 0,
          change_percent: meta.regularMarketChangePercent || 0,
          currency: meta.currency || 'USD',
          last_updated: new Date(meta.regularMarketTime * 1000).toISOString(),
        });
      }

      const hResult = historyJson?.chart?.result?.[0];
      if (hResult && hResult.timestamp) {
        const points = hResult.timestamp.map((ts: number, i: number) => ({
          date: new Date(ts * 1000).toISOString().split('T')[0],
          close: hResult.indicators.quote[0].close[i] || hResult.indicators.quote[0].open[i]
        })).filter((p: any) => p.close != null);
        setHistory(points);
      }

      // 2. 내 보유 여부 확인
      const { data: user } = await supabase.auth.getUser();
      if (user?.user) {
        const { data } = await supabase
          .from('holdings')
          .select('*, portfolios(name)')
          .eq('ticker', ticker);
        setHoldings(data || []);
      }
    } catch (e: any) {
      console.error('Error fetching stock detail:', e);
    }

    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchStockData();
  }, [ticker, period]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStockData();
  }, [ticker, period]);

  if (loading && !priceData) {
    return <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#22c55e" /></View>;
  }

  if (!priceData) return null;

  const isPositive = priceData.change_percent >= 0;
  const chartData = history.map(p => ({ x: new Date(p.date), y: p.close }));

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b' }}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      >
        {/* 헤더 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 16 }}>
            <ArrowLeft size={24} color="#e4e4e7" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 28, fontWeight: '900', color: '#f4f4f5' }}>{ticker}</Text>
            <Text style={{ fontSize: 14, color: '#71717a', marginTop: 2 }}>{priceData.name}</Text>
          </View>
        </View>

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

          <View style={{ height: 180, backgroundColor: '#18181b', borderRadius: 12, borderWidth: 1, borderColor: '#27272a', justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: '#52525b', fontSize: 13 }}>차트 준비 중</Text>
          </View>

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
