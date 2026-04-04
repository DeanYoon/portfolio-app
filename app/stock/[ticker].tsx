import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, Wallet, Clock, DollarSign } from 'lucide-react-native';
import { supabase } from '@/src/lib/supabase';
import { formatCurrency, formatRate, getFlag, getCountry } from '@/src/utils/format';

interface PriceData {
  price: number;
  name: string;
  change_amount: number;
  change_percent: number;
  currency: string;
  last_updated: string;
  error?: string;
}

export default function StockDetailScreen() {
  const { ticker: encodedTicker } = useLocalSearchParams<{ ticker: string }>();
  const ticker = encodedTicker ? decodeURIComponent(encodedTicker) : '';
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [holdings, setHoldings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStockData = async () => {
    if (!ticker) return;
    setLoading(true);

    // Yahoo Finance에서 시세 가져오기
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const json = await res.json();
      const result = json?.chart?.result?.[0];

      if (result) {
        const meta = result.meta;
        setPriceData({
          price: meta.regularMarketPrice || 0,
          name: meta.symbol || ticker,
          change_amount: meta.regularMarketChange || 0,
          change_percent: meta.regularMarketChangePercent || 0,
          currency: meta.currency || 'USD',
          last_updated: new Date(meta.regularMarketTime * 1000).toISOString(),
        });
      } else {
        setPriceData({ price: 0, name: ticker, change_amount: 0, change_percent: 0, currency: 'USD', last_updated: '', error: 'No data' });
      }
    } catch (e: any) {
      setPriceData({ price: 0, name: ticker, change_amount: 0, change_percent: 0, currency: 'USD', last_updated: '', error: e.message });
    }

    // 내 보유 여부 확인
    const { data: user } = await supabase.auth.getUser();
    if (user?.user) {
      const { data } = await supabase
        .from('holdings')
        .select('*, portfolios(name)')
        .eq('ticker', ticker);
      setHoldings(data || []);
    }

    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchStockData();
  }, [ticker]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStockData();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#22c55e" />
      </View>
    );
  }

  if (!priceData || priceData.error) {
    return (
      <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ fontSize: 20, fontWeight: '900', color: '#f4f4f5', marginBottom: 8 }}>데이터를 찾을 수 없습니다</Text>
        <Text style={{ fontSize: 14, color: '#71717a', textAlign: 'center' }}>{ticker}</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 24, padding: 12, backgroundColor: '#22c55e', borderRadius: 12 }}>
          <Text style={{ color: '#052e16', fontWeight: '700' }}>뒤로 가기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isPositive = priceData.change_percent >= 0;
  const isCash = ticker.startsWith('CASH_');
  const country = getCountry(ticker);
  const currency = isCash ? ticker.split('_')[1] : priceData.currency;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#09090b' }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
      contentContainerStyle={{ padding: 16 }}
    >
      {/* 헤더 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 16 }}>
          <ArrowLeft size={24} color="#e4e4e7" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 28, fontWeight: '900', color: '#f4f4f5' }}>{ticker}</Text>
            <View style={{ backgroundColor: '#18181b', borderColor: '#27272a', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: '900', color: '#71717a' }}>{currency}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 14, color: '#71717a', marginTop: 4 }}>{priceData.name}</Text>
        </View>
      </View>

      {/* 현재가 */}
      <View style={{ marginBottom: 24, padding: 20, backgroundColor: '#18181b', borderRadius: 20, borderWidth: 1, borderColor: '#27272a' }}>
        <Text style={{ fontSize: 36, fontWeight: '900', color: '#f4f4f5', letterSpacing: -1 }}>
          {priceData.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          {isPositive ? <TrendingUp size={20} color="#ef4444" /> : <TrendingDown size={20} color="#3b82f6" />}
          <Text style={{ fontSize: 16, fontWeight: '700', color: isPositive ? '#ef4444' : '#3b82f6' }}>
            {isPositive ? '+' : ''}{priceData.change_amount.toFixed(2)} ({isPositive ? '+' : ''}{priceData.change_percent.toFixed(2)}%)
          </Text>
        </View>
      </View>

      {/* 내 포지션 */}
      {holdings.length > 0 && (
        <View style={{ marginBottom: 16, backgroundColor: '#18181b', borderRadius: 20, borderWidth: 1, borderColor: '#27272a', overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, paddingBottom: 0 }}>
            <Wallet size={16} color="#71717a" />
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 2 }}>내 포지션</Text>
          </View>
          {holdings.map((h, i) => {
            const calcQty = h.quantity;
            const totalValue = isCash ? h.quantity * priceData.price : calcQty * priceData.price;
            const totalProfit = isCash ? 0 : (priceData.price - h.avg_price) * calcQty;
            const profitRate = isCash ? 0 : ((priceData.price - h.avg_price) / h.avg_price) * 100;
            const profitColor = totalProfit >= 0 ? '#ef4444' : '#3b82f6';

            return (
              <View key={i} style={{ padding: 16, paddingTop: i === 0 ? 12 : 16 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 2, marginBottom: 8 }}>
                  {h.portfolios?.name || 'Portfolio'}
                </Text>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#f4f4f5', marginBottom: 12 }}>
                  {h.quantity.toLocaleString()} 주
                </Text>
                {!isCash && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ fontSize: 10, color: '#52525b', fontWeight: '900', letterSpacing: 1 }}>평균가</Text>
                    <Text style={{ fontSize: 13, color: '#a1a1aa', fontWeight: '700' }}>{h.avg_price.toLocaleString()}</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={{ fontSize: 10, color: '#52525b', fontWeight: '900', letterSpacing: 1 }}>총 가치</Text>
                  <Text style={{ fontSize: 13, color: '#a1a1aa', fontWeight: '700' }}>{totalValue.toLocaleString()} {currency}</Text>
                </View>
                {!isCash && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 10, color: '#52525b', fontWeight: '900', letterSpacing: 1 }}>손익</Text>
                    <View>
                      <Text style={{ fontSize: 18, fontWeight: '900', color: profitColor }}>
                        {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
                      </Text>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: profitColor, textAlign: 'right' }}>
                        {formatRate(profitRate)}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* 시장 정보 */}
      <View style={{ backgroundColor: '#18181b', borderRadius: 20, borderWidth: 1, borderColor: '#27272a', overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, paddingBottom: 0 }}>
          <Clock size={16} color="#71717a" />
          <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 2 }}>시장 정보</Text>
        </View>
        <View style={{ padding: 16 }}>
          <InfoRow label="티커" value={ticker} />
          <View style={{ height: 1, backgroundColor: '#27272a', marginVertical: 8 }} />
          <InfoRow label="통화" value={currency} />
          <View style={{ height: 1, backgroundColor: '#27272a', marginVertical: 8 }} />
          <InfoRow label="최종 거래가" value={priceData.price.toFixed(2)} />
          {priceData.last_updated && (
            <>
              <View style={{ height: 1, backgroundColor: '#27272a', marginVertical: 8 }} />
              <InfoRow label="최신 업데이트" value={new Date(priceData.last_updated).toLocaleString()} />
            </>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 13, color: '#71717a' }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: '#e4e4e7' }}>{value}</Text>
    </View>
  );
}
