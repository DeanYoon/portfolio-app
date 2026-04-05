import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Dimensions, StyleSheet, Alert, Platform } from 'react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency } from '@/src/utils/format';
import { VictoryBar, VictoryChart, VictoryAxis, VictoryTheme, VictoryLabel, VictoryContainer } from 'victory-native';
import { PieChart, Calendar, DollarSign, Info, Wallet, TrendingUp, ChevronRight, Calculator, Globe, ShieldCheck } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTaxRate, calculateDividendYield, calculateLatestTrendEstimate, StockDividend, TrendEstimate } from '@/src/utils/dividend-calc';
import { format, parseISO, startOfMonth, endOfMonth, isPast, isSameMonth } from 'date-fns';

const { width } = Dimensions.get('window');

// --- Constants & Cache Keys ---
const CACHE_KEY_DIVIDENDS = 'global_dividend_data_cache';
const CACHE_KEY_MARKET = 'market_data_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface Portfolio {
  id: string;
  name: string;
}

export default function DividendsScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  // 6.1 State Management
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isKrwMode, setIsKrwMode] = useState(true);
  const [isAfterTax, setIsAfterTax] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null); // null = Annual view
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  
  const [stockDividends, setStockDividends] = useState<StockDividend[]>([]);
  const [exchangeRates, setExchangeRates] = useState({ usdkrw: 1400, jpykrw: 9.5 });
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const [historicalPrices, setHistoricalPrices] = useState<Record<string, any>>({});

  // --- Initial Data Load & Portfolios ---
  useEffect(() => {
    if (!session) return;
    const loadInit = async () => {
      const { data, error } = await supabase.from('portfolios').select('id, name').eq('user_id', session.user.id);
      if (data && data.length > 0) {
        setPortfolios(data);
        setSelectedPortfolioId(data[0].id);
      }
    };
    loadInit();
  }, [session]);

  // 6.2 Data Fetch Logic (useEffect #1)
  const fetchDividends = useCallback(async (portfolioId: string) => {
    if (!portfolioId) return;
    setLoading(true);
    try {
      // 1. Check Cache
      const cacheStr = await AsyncStorage.getItem(CACHE_KEY_DIVIDENDS);
      const cache = cacheStr ? JSON.parse(cacheStr) : { items: {} };
      const item = cache.items[portfolioId];
      
      const isFresh = item && (Date.now() - item.last_updated < CACHE_TTL);
      
      if (isFresh) {
        setStockDividends(item.dividends);
        // Load market data from cache too
        const marketStr = await AsyncStorage.getItem(CACHE_KEY_MARKET);
        if (marketStr) {
          const market = JSON.parse(marketStr);
          setStockPrices(market.prices || {});
          setExchangeRates(market.exchangeRates || { usdkrw: 1400, jpykrw: 9.5 });
        }
        setLoading(false);
        return;
      }

      // 2. Fetch API
      const response = await fetch(`/api/portfolio/${portfolioId}/dividends`);
      if (response.status === 502) throw new Error('Japan Data Error (Cache Retained)');
      const dividends = await response.json();
      
      // 3. Merge & Cache
      setStockDividends(dividends);
      cache.items[portfolioId] = {
        last_updated: Date.now(),
        dividends
      };
      await AsyncStorage.setItem(CACHE_KEY_DIVIDENDS, JSON.stringify(cache));

      // 4. Update Prices
      const tickers = [...new Set(dividends.map((d: any) => d.ticker))];
      const priceRes = await fetch('/api/refresh-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers })
      });
      const priceData = await priceRes.json();
      setStockPrices(priceData.prices);
      setExchangeRates(priceData.exchangeRates);
      await AsyncStorage.setItem(CACHE_KEY_MARKET, JSON.stringify(priceData));

    } catch (e: any) {
      setError(e.message);
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPortfolioId) fetchDividends(selectedPortfolioId);
  }, [selectedPortfolioId, fetchDividends]);

  // Real-time Update Listener
  useEffect(() => {
    const handlePriceUpdate = (e: any) => {
      if (e.detail?.prices) {
        setStockPrices(prev => ({ ...prev, ...e.detail.prices }));
      }
      if (e.detail?.exchangeRates) {
        setExchangeRates(prev => ({ ...prev, ...e.detail.exchangeRates }));
      }
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pricesUpdated', handlePriceUpdate);
      return () => window.removeEventListener('pricesUpdated', handlePriceUpdate as EventListener);
    }
  }, []);

  // 6.3 Historical Prices (useEffect #2)
  useEffect(() => {
    if (stockDividends.length === 0 || !selectedPortfolioId) return;
    
    const fetchHistorical = async () => {
      const tickers = [...new Set(stockDividends.map(d => d.ticker))];
      const historical: Record<string, any> = {};
      
      for (const ticker of tickers) {
        const start = Math.floor(Date.now() / 1000) - (365 * 60 * 60 * 24);
        const end = Math.floor(Date.now() / 1000);
        const res = await fetch(`/api/historical?ticker=${ticker}&period1=${start}&period2=${end}`);
        const data = await res.json();
        
        // Process last year same month price
        const lastYearDate = format(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
        historical[ticker] = {
          dividendDatePrices: data,
          lastYearSameMonthPrice: data[lastYearDate] || 0
        };
      }
      setHistoricalPrices(historical);
    };

    const timer = setTimeout(fetchHistorical, 500); // 500ms delay
    return () => clearTimeout(timer);
  }, [stockDividends, selectedPortfolioId]);

  // 6.7 Monthly Data Aggregation (useMemo)
  const monthlyData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => i);
    const currentYear = new Date().getFullYear();
    const today = new Date();

    return months.map(month => {
      const targetDate = new Date(currentYear, month, 15);
      const isPastMonth = isPast(endOfMonth(targetDate)) && !isSameMonth(targetDate, today);
      
      let totalValue = 0;
      let hasActual = false;

      const items = [...new Set(stockDividends.map(d => d.ticker))].map(ticker => {
        const estimate = calculateLatestTrendEstimate(
          stockDividends.filter(d => d.ticker === ticker),
          historicalPrices,
          stockPrices[ticker] || 0,
          month,
          currentYear,
          ticker,
          isKrwMode,
          isKrwMode ? exchangeRates.usdkrw : 1
        );

        if (estimate.calculationMethod === 'actual') hasActual = true;
        
        const rate = isKrwMode ? (ticker.endsWith('.T') ? exchangeRates.jpykrw / 100 : exchangeRates.usdkrw) : 1;
        const tax = getTaxRate(ticker.includes('.') ? 'US' : 'KR', isAfterTax); // Simplified logic
        
        return estimate.amount * rate * tax;
      });

      totalValue = items.reduce((a, b) => a + b, 0);

      return {
        month: month + 1,
        value: totalValue,
        type: isPastMonth ? 'actual' : (hasActual ? 'actual' : 'estimate'),
        label: `${month + 1}월`
      };
    });
  }, [stockDividends, historicalPrices, stockPrices, exchangeRates, isKrwMode, isAfterTax]);

  const totalAnnual = useMemo(() => monthlyData.reduce((a, b) => a + b.value, 0), [monthlyData]);
  const selectedMonthData = useMemo(() => selectedMonth !== null ? monthlyData[selectedMonth] : null, [selectedMonth, monthlyData]);

  // 6.8 Filtered Stocks
  const stockList = useMemo(() => {
    const tickers = [...new Set(stockDividends.map(d => d.ticker))];
    const currentYear = new Date().getFullYear();

    return tickers.map(ticker => {
      const tickerDivs = stockDividends.filter(d => d.ticker === ticker);
      const analysis = calculateDividendYield(tickerDivs, stockPrices[ticker] || 0, ticker);
      
      // If month selected, get that month estimate
      const monthlyEstimates = Array.from({ length: 12 }, (_, i) => 
        calculateLatestTrendEstimate(tickerDivs, historicalPrices, stockPrices[ticker] || 0, i, currentYear, ticker, isKrwMode, 1)
      );

      const country = ticker.endsWith('.T') ? 'JP' : (ticker.includes('.') ? 'US' : 'KR');
      const taxRate = getTaxRate(country, isAfterTax);
      const fxRate = isKrwMode ? (country === 'JP' ? exchangeRates.jpykrw / 100 : (country === 'KR' ? 1 : exchangeRates.usdkrw)) : 1;

      return {
        ticker,
        analysis,
        monthlyEstimates,
        taxRate,
        fxRate,
        country
      };
    }).filter(s => selectedMonth === null || s.monthlyEstimates[selectedMonth].amount > 0);
  }, [stockDividends, stockPrices, historicalPrices, selectedMonth, isKrwMode, isAfterTax, exchangeRates]);

  if (loading && stockDividends.length === 0) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color="#22c55e" />
        <Text style={{ color: '#71717a', marginTop: 12, textAlign: 'center' }}>배당 트렌드를 분석하는 중...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        
        {/* 7.1 상단 컨트롤바 */}
        <View style={styles.headerControls}>
          <TouchableOpacity onPress={() => setIsAfterTax(!isAfterTax)} style={[styles.pillButton, isAfterTax && styles.pillButtonActive]}>
            <ShieldCheck size={14} color={isAfterTax ? '#052e16' : '#71717a'} />
            <Text style={[styles.pillText, isAfterTax && styles.pillTextActive]}>{isAfterTax ? '세후 수령액' : '세전 금액'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsKrwMode(!isKrwMode)} style={[styles.pillButton, styles.mlAuto]}>
            <Globe size={14} color="#71717a" />
            <Text style={styles.pillText}>{isKrwMode ? 'KRW (₩)' : 'USD ($)'}</Text>
          </TouchableOpacity>
        </View>

        {/* 7.2 연간 배당 흐름 차트 */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <View>
              <Text style={styles.chartTitle}>📊 연간 배당 흐름 및 예측</Text>
              <Text style={styles.chartSubtitle}>✨ 최신 성장 트렌드 반영 모델</Text>
            </View>
            <TrendingUp size={24} color="#27272a" style={styles.watermark} />
          </View>
          
          <VictoryChart width={width - 56} height={180} padding={{ top: 20, bottom: 40, left: 10, right: 10 }} domainPadding={{ x: 20 }}>
            <VictoryAxis 
              style={{ 
                axis: { stroke: 'transparent' }, 
                tickLabels: { fill: '#3f3f46', fontSize: 10, fontWeight: '700' } 
              }} 
            />
            <VictoryBar 
              data={monthlyData.map(d => ({ x: d.label, y: d.value, type: d.type }))} 
              style={{ 
                data: { 
                  fill: ({ datum }) => datum.type === 'actual' ? '#4ade80' : '#3b82f6', 
                  width: 10, 
                  rx: 4 
                } 
              }} 
              events={[{
                target: "data",
                eventHandlers: {
                  onPress: () => {
                    return [{
                      target: "data",
                      mutation: (props) => {
                        const monthIdx = props.index;
                        setSelectedMonth(selectedMonth === monthIdx ? null : monthIdx);
                        return null;
                      }
                    }];
                  }
                }
              }]}
            />
          </VictoryChart>
          
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#4ade80' }]} />
              <Text style={styles.legendText}>실제</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} />
              <Text style={styles.legendText}>예측</Text>
            </View>
          </View>
        </View>

        {/* 7.3 요약 카드 */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>
              {selectedMonth !== null ? `${selectedMonth + 1}월 배당 리포트` : '연간 배향 요약'}
            </Text>
            <TouchableOpacity onPress={() => setSelectedMonth(null)} style={styles.viewToggle}>
              <Text style={styles.viewToggleText}>{selectedMonth !== null ? '연간 통합' : '월별 상세'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.summaryAmount}>
            {isKrwMode ? formatCurrency(selectedMonth !== null ? selectedMonthData?.value || 0 : totalAnnual) : `$${(selectedMonth !== null ? (selectedMonthData?.value || 0) / exchangeRates.usdkrw : totalAnnual / exchangeRates.usdkrw).toFixed(2)}`}
          </Text>
          <View style={styles.summaryBadges}>
            <View style={styles.badge}><Text style={styles.badgeText}>● 지급 완료 내역 포함</Text></View>
            <View style={styles.badge}><Text style={styles.badgeText}>● AI 트렌드 예측 모델</Text></View>
          </View>
        </View>

        {/* 7.4 종목별 분석 카드 */}
        <Text style={styles.sectionTitle}>STOCK ANALYSIS</Text>
        {stockList.map((stock, idx) => (
          <View key={stock.ticker} style={styles.stockCard}>
            <View style={styles.stockHeader}>
              <View>
                <Text style={styles.stockSymbol}>{stock.ticker}</Text>
                <Text style={styles.stockInfo}>{stock.country === 'US' ? '미국 주식' : (stock.country === 'JP' ? '일본 주식' : '한국 주식')}</Text>
              </View>
              <Text style={styles.stockTotal}>
                {isKrwMode ? 
                  formatCurrency(stock.monthlyEstimates.reduce((a, b) => a + b.amount, 0) * stock.fxRate * stock.taxRate) : 
                  `$${(stock.monthlyEstimates.reduce((a, b) => a + b.amount, 0) * (stock.fxRate / exchangeRates.usdkrw) * stock.taxRate).toFixed(2)}`
                }
              </Text>
            </View>

            {/* A. 배당수익률 박스 */}
            <View style={styles.yieldBox}>
              <View style={styles.yieldRow}>
                <View style={[styles.yieldBadge, { backgroundColor: '#052e16' }]}>
                  <Text style={[styles.yieldBadgeText, { color: '#4ade80' }]}>최근: {stock.analysis.singleYieldPercent.toFixed(2)}%</Text>
                </View>
                <View style={[styles.yieldBadge, { backgroundColor: '#172554' }]}>
                  <Text style={[styles.yieldBadgeText, { color: '#3b82f6' }]}>연환산: {stock.analysis.yieldPercent.toFixed(2)}%</Text>
                </View>
              </View>
              <View style={styles.yieldGrid}>
                <View>
                  <Text style={styles.yieldGridLabel}>지급 주기</Text>
                  <Text style={styles.yieldGridValue}>연 {stock.analysis.paymentsPerYear}회</Text>
                </View>
                <View>
                  <Text style={styles.yieldGridLabel}>현재 시가</Text>
                  <Text style={styles.yieldGridValue}>${stock.analysis.currentPrice.toFixed(2)}</Text>
                </View>
                <View>
                  <Text style={styles.yieldGridLabel}>연 예상 배당</Text>
                  <Text style={styles.yieldGridValue}>${stock.analysis.annualDividendPerShare.toFixed(2)}</Text>
                </View>
              </View>
            </View>

            {/* B. 지급 상태 행 (2026/Current Monthly) */}
            {selectedMonth !== null && (
              <View style={styles.statusRow}>
                <View style={styles.flexRow}>
                  <View style={[styles.statusDot, { backgroundColor: stock.monthlyEstimates[selectedMonth].calculationMethod === 'actual' ? '#4ade80' : '#3b82f6' }]} />
                  <Text style={styles.statusText}>{stock.monthlyEstimates[selectedMonth].calculationMethod === 'actual' ? '지급 완료' : '예측 배당'}</Text>
                </View>
                <Text style={styles.statusAmount}>
                  {isKrwMode ? formatCurrency(stock.monthlyEstimates[selectedMonth].amount * stock.fxRate * stock.taxRate) : `$${(stock.monthlyEstimates[selectedMonth].amount * (stock.fxRate / exchangeRates.usdkrw) * stock.taxRate).toFixed(2)}`}
                </Text>
              </View>
            )}

            {/* C. 예측 vs 실제 비교 (실제 배당 시 예측치도 계산하여 표시) */}
            {selectedMonth !== null && stock.monthlyEstimates[selectedMonth].calculationMethod === 'actual' && (
              <View style={styles.detailBox}>
                <Text style={styles.detailBoxTitle}>예측 vs 실제 비교</Text>
                <View style={styles.comparisonGrid}>
                  <View style={styles.compCol}>
                    <Text style={styles.compLabel}>예측 배당 (Avg)</Text>
                    <Text style={styles.compValue}>$—</Text> 
                  </View>
                  <View style={styles.compCol}>
                    <Text style={styles.compLabel}>실제 배당</Text>
                    <Text style={styles.compValue}>${(stock.monthlyEstimates[selectedMonth].amount).toFixed(2)}</Text>
                  </View>
                  <View style={styles.compCol}>
                    <Text style={styles.compLabel}>차이</Text>
                    <Text style={[styles.compValue, { color: '#4ade80' }]}>—</Text>
                  </View>
                </View>
              </View>
            )}

            {/* D. 트렌드 분석 근거 (예측 종목) */}
            {selectedMonth !== null && stock.monthlyEstimates[selectedMonth].calculationMethod !== 'actual' && (
              <View style={styles.detailBox}>
                <Text style={styles.detailBoxTitle}>트렌드 분석 근거 (1yr)</Text>
                <Text style={styles.detailText}>{stock.monthlyEstimates[selectedMonth].calculationFormula}</Text>
                <View style={styles.comparisonGrid}>
                  <View style={styles.compCol}>
                    <Text style={styles.compLabel}>종가 기준</Text>
                    <Text style={styles.compValue}>${(stock.monthlyEstimates[selectedMonth].lastYearSameMonthPrice || stock.analysis.currentPrice).toFixed(2)}</Text>
                  </View>
                  <View style={styles.compCol}>
                    <Text style={styles.compLabel}>적용 수익률</Text>
                    <Text style={styles.compValue}>{(stock.monthlyEstimates[selectedMonth].lastYearSameMonthYield || stock.analysis.singleYieldPercent).toFixed(2)}%</Text>
                  </View>
                </View>
              </View>
            )}

            {/* E. 월별 내역 (연간 뷰) */}
            {selectedMonth === null && (
              <View style={styles.monthlyGrid}>
                {stock.monthlyEstimates.map((est, mIdx) => est.amount > 0 ? (
                  <View key={mIdx} style={[styles.monthlyCell, { backgroundColor: est.calculationMethod === 'actual' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(59, 130, 246, 0.1)' }]}>
                    <Text style={styles.cellMonth}>{mIdx + 1}월</Text>
                    <Text style={[styles.cellAmount, { color: est.calculationMethod === 'actual' ? '#4ade80' : '#3b82f6' }]}>
                      {isKrwMode ? formatCurrency(est.amount * stock.fxRate * stock.taxRate) : `$${(est.amount * stock.taxRate).toFixed(2)}`}
                    </Text>
                  </View>
                ) : null)}
              </View>
            )}
          </View>
        ))}
        
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  pillButtonActive: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#71717a',
  },
  pillTextActive: {
    color: '#052e16',
  },
  mlAuto: {
    marginLeft: 'auto',
  },
  chartCard: {
    backgroundColor: '#18181b',
    borderRadius: 32,
    padding: 20,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 24,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#f4f4f5',
  },
  chartSubtitle: {
    fontSize: 10,
    color: '#71717a',
    marginTop: 4,
  },
  watermark: {
    opacity: 0.2,
  },
  legend: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    justifyContent: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: '#52525b',
    fontWeight: '700',
  },
  summaryCard: {
    marginBottom: 32,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#71717a',
    letterSpacing: 1,
  },
  viewToggle: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#27272a',
  },
  viewToggleText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#a1a1aa',
  },
  summaryAmount: {
    fontSize: 48,
    fontWeight: '900',
    color: '#f4f4f5',
    letterSpacing: -2,
  },
  summaryBadges: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  badge: {
    backgroundColor: '#18181b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  badgeText: {
    fontSize: 9,
    color: '#52525b',
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#3f3f46',
    letterSpacing: 2,
    marginBottom: 16,
  },
  stockCard: {
    backgroundColor: '#18181b',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 16,
  },
  stockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  stockSymbol: {
    fontSize: 18,
    fontWeight: '900',
    color: '#f4f4f5',
  },
  stockInfo: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 2,
  },
  stockTotal: {
    fontSize: 18,
    fontWeight: '900',
    color: '#f4f4f5',
  },
  yieldBox: {
    backgroundColor: '#09090b',
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
  },
  yieldRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  yieldBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  yieldBadgeText: {
    fontSize: 10,
    fontWeight: '900',
  },
  yieldGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  yieldGridLabel: {
    fontSize: 9,
    color: '#52525b',
    fontWeight: '700',
    marginBottom: 4,
  },
  yieldGridValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#a1a1aa',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  flexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#f4f4f5',
  },
  statusAmount: {
    fontSize: 14,
    fontWeight: '900',
    color: '#f4f4f5',
  },
  monthlyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  monthlyCell: {
    width: (width - 110) / 3,
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  cellMonth: {
    fontSize: 10,
    color: '#71717a',
    fontWeight: '700',
    marginBottom: 4,
  },
  cellAmount: {
    fontSize: 11,
    fontWeight: '900',
  },
  detailBox: {
    backgroundColor: '#09090b',
    borderRadius: 16,
    padding: 12,
    marginTop: 16,
  },
  detailBoxTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#a1a1aa',
    marginBottom: 8,
  },
  detailText: {
    fontSize: 10,
    color: '#71717a',
    marginBottom: 8,
  },
  comparisonGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  compCol: {
    flex: 1,
  },
  compLabel: {
    fontSize: 9,
    color: '#52525b',
    fontWeight: '700',
    marginBottom: 4,
  },
  compValue: {
    fontSize: 13,
    fontWeight: '900',
    color: '#f4f4f5',
  }
});
