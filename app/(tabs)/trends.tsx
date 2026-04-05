import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Dimensions } from 'react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency, formatRate } from '@/src/utils/format';
import { VictoryChart, VictoryAxis, VictoryArea, VictoryVoronoiContainer, VictoryScatter } from 'victory-native';
import { Wallet, ArrowUpRight, ArrowDownRight } from 'lucide-react-native';
import { Svg, Defs, LinearGradient, Stop } from 'react-native-svg';

const { width } = Dimensions.get('window');

interface Portfolio {
  id: string;
  name: string;
}

interface Snapshot {
  snapshot_date: string;
  total_value_krw: number;
  change?: number;
  portfolio_id?: string;
}

// 분석 데이터 타입 정의 (타입 에러 방지)
type AnalysisData = 
  | { type: 'SINGLE'; date: string; value: number }
  | { type: 'RANGE'; start: string; end: string; diff: number; roi: number; iStart: number; iEnd: number };

export default function TrendsScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<'ALL' | string>('ALL');
  const [rawSnapshots, setRawSnapshots] = useState<Snapshot[]>([]);
  const [period, setPeriod] = useState<'1M' | '3M' | '1Y' | 'ALL'>('1M');

  // 터치 분석 상태
  const [activeIndices, setActiveIndices] = useState<number[]>([]);
  const [containerWidth, setContainerWidth] = useState(width - 32);

  const fetchData = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const { data: pData } = await supabase.from('portfolios').select('id, name').eq('user_id', session.user.id);
      setPortfolios(pData || []);
      if (!pData || pData.length === 0) {
        setLoading(false);
        return;
      }
      const pIds = pData.map(p => p.id);
      const { data: snapshotData, error } = await supabase.from('portfolio_snapshots').select('snapshot_date, total_value_krw, portfolio_id').in('portfolio_id', pIds).order('snapshot_date', { ascending: true });
      if (error) throw error;
      setRawSnapshots(snapshotData || []);
    } catch (e) {
      console.error('Error fetching trends data:', e);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const allHistory = useMemo(() => {
    let filtered = rawSnapshots;
    if (selectedPortfolioId !== 'ALL') filtered = rawSnapshots.filter(s => s.portfolio_id === selectedPortfolioId);
    const grouped = filtered.reduce((acc: Record<string, number>, curr) => {
      const date = curr.snapshot_date.split('T')[0]; // 날짜만 추출
      acc[date] = (acc[date] || 0) + Number(curr.total_value_krw);
      return acc;
    }, {});
    let formatted = Object.entries(grouped).map(([date, val]) => ({ snapshot_date: date, total_value_krw: val as number })).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    return formatted.map((s, i) => ({ ...s, change: i === 0 ? 0 : s.total_value_krw - formatted[i - 1].total_value_krw }));
  }, [rawSnapshots, selectedPortfolioId]);

  const displayedSnapshots = useMemo(() => {
    if (period === 'ALL') return allHistory;
    const now = new Date();
    const cutoff = new Date();
    if (period === '1M') cutoff.setMonth(now.getMonth() - 1);
    else if (period === '3M') cutoff.setMonth(now.getMonth() - 3);
    else if (period === '1Y') cutoff.setFullYear(now.getFullYear() - 1);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return allHistory.filter(s => s.snapshot_date >= cutoffStr);
  }, [allHistory, period]);

  const chartData = useMemo(() => displayedSnapshots.map(s => ({ x: new Date(s.snapshot_date), y: s.total_value_krw, datum: s })), [displayedSnapshots]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const vals = chartData.map(d => d.y);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min;
    const padding = range === 0 ? min * 0.1 : range * 0.1;
    return [Math.max(0, min - padding), max + padding];
  }, [chartData]);

  const latest = allHistory[allHistory.length - 1]?.total_value_krw || 0;
  const first = allHistory[0]?.total_value_krw || 0;
  const totalChange = latest - first;
  const changeRate = first > 0 ? (totalChange / first) * 100 : 0;

  // ─── 분석 데이터 렌더링 ───
  const analysis = useMemo((): AnalysisData | null => {
    if (activeIndices.length === 0 || chartData.length === 0) return null;
    
    const shortDate = (dateStr: string) => {
      const pureDate = dateStr.split('T')[0];
      return pureDate.slice(2).replace(/-/g, '.');
    };

    if (activeIndices.length === 1) {
      const idx = activeIndices[0];
      if (idx < 0 || idx >= chartData.length) return null;
      const point = chartData[idx].datum;
      return { type: 'SINGLE', date: shortDate(point.snapshot_date), value: point.total_value_krw };
    }

    const iStart = Math.min(activeIndices[0], activeIndices[1]);
    const iEnd = Math.max(activeIndices[0], activeIndices[1]);
    
    if (iStart < 0 || iEnd >= chartData.length) return null;

    const start = chartData[iStart].datum;
    const end = chartData[iEnd].datum;
    const diff = end.total_value_krw - start.total_value_krw;
    const roi = start.total_value_krw > 0 ? (diff / start.total_value_krw) * 100 : 0;

    return { type: 'RANGE', start: shortDate(start.snapshot_date), end: shortDate(end.snapshot_date), diff, roi, iStart, iEnd };
  }, [activeIndices, chartData]);

  const onTouch = (evt: any) => {
    const touches = evt.nativeEvent.touches;
    const padding = 20;
    const contentWidth = containerWidth - padding * 2;
    const mapXtoIdx = (x: number) => {
       const idx = Math.round((Math.max(0, Math.min(x - padding, contentWidth)) / contentWidth) * (chartData.length - 1));
       return isNaN(idx) ? 0 : idx;
    };

    if (touches.length === 1) {
      setActiveIndices([mapXtoIdx(touches[0].locationX)]);
    } else if (touches.length === 2) {
      setActiveIndices([mapXtoIdx(touches[0].locationX), mapXtoIdx(touches[1].locationX)]);
    } else {
      setActiveIndices([]);
    }
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#22c55e" /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: insets.top }}>
      <ScrollView scrollEnabled={activeIndices.length === 0} contentContainerStyle={{ padding: 16 }}>
        
        <View style={{ marginBottom: 16 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <TouchableOpacity onPress={() => setSelectedPortfolioId('ALL')} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: selectedPortfolioId === 'ALL' ? '#22c55e' : '#18181b', borderWidth: 1, borderColor: selectedPortfolioId === 'ALL' ? '#22c55e' : '#27272a' }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: selectedPortfolioId === 'ALL' ? '#052e16' : '#71717a' }}>전체 자산</Text>
            </TouchableOpacity>
            {portfolios.map(p => (
              <TouchableOpacity key={p.id} onPress={() => setSelectedPortfolioId(p.id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: selectedPortfolioId === p.id ? '#22c55e' : '#18181b', borderWidth: 1, borderColor: selectedPortfolioId === p.id ? '#22c55e' : '#27272a' }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: selectedPortfolioId === p.id ? '#052e16' : '#71717a' }}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 32, fontWeight: '900', color: '#f4f4f5', letterSpacing: -1 }}>{formatCurrency(latest)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
             <Text style={{ fontSize: 14, fontWeight: '800', color: totalChange >= 0 ? '#ef4444' : '#3b82f6' }}>{totalChange >= 0 ? '+' : ''}{formatCurrency(totalChange)} ({formatRate(changeRate)})</Text>
             <Text style={{ fontSize: 11, color: '#52525b' }}>전체 기간</Text>
          </View>
        </View>

        {/* 차트 영역 */}
        <View onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)} onTouchStart={onTouch} onTouchMove={onTouch} onTouchEnd={() => setActiveIndices([])} style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 12, borderWidth: 1, borderColor: '#27272a', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
          
          {analysis && (
            <View style={{ position: 'absolute', top: 12, left: 12, right: 12, backgroundColor: 'rgba(9,9,11,0.95)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#22c55e', zIndex: 100, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none' }}>
               {analysis.type === 'SINGLE' ? (
                 <>
                   <Text style={{ fontSize: 11, fontWeight: '800', color: '#a1a1aa' }}>{analysis.date}</Text>
                   <Text style={{ fontSize: 15, fontWeight: '900', color: '#f4f4f5' }}>{formatCurrency(analysis.value)}</Text>
                 </>
               ) : (
                 <>
                   <Text style={{ fontSize: 10, color: '#a1a1aa' }}>{analysis.start}..{analysis.end}</Text>
                   <View style={{ alignItems: 'flex-end' }}>
                     <Text style={{ fontSize: 14, fontWeight: '900', color: '#f4f4f5' }}>{formatCurrency(analysis.diff)}</Text>
                     <Text style={{ fontSize: 11, fontWeight: '800', color: analysis.diff >= 0 ? '#ef4444' : '#3b82f6' }}>{formatRate(analysis.roi)}</Text>
                   </View>
                 </>
               )}
            </View>
          )}

          {chartData.length > 1 ? (
            <View pointerEvents="none">
              <Svg style={{ height: 0 }}><Defs><LinearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%"><Stop offset="0%" stopColor="#22c55e" stopOpacity="0.1" /><Stop offset="100%" stopColor="#22c55e" stopOpacity="0" /></LinearGradient></Defs></Svg>
              <VictoryChart width={containerWidth - 24} height={180} padding={{ top: 10, bottom: 25, left: 0, right: 0 }} domain={{ y: yDomain as any }}>
                <VictoryAxis style={{ axis: { stroke: 'transparent' }, tickLabels: { fill: '#3f3f46', fontSize: 9, fontWeight: '700' } }} tickValues={chartData.length > 3 ? [chartData[0].x, chartData[Math.floor(chartData.length/2)].x, chartData[chartData.length-1].x] : undefined} tickFormat={(x) => `${new Date(x).getMonth() + 1}/${new Date(x).getDate()}`} />
                <VictoryArea name="area" data={chartData} interpolation="monotoneX" style={{ data: { fill: 'url(#gradient)', stroke: '#22c55e', strokeWidth: 2 } }} />
                
                {analysis?.type === 'RANGE' && (
                   <VictoryArea data={chartData.slice(analysis.iStart, analysis.iEnd + 1)} style={{ data: { fill: 'rgba(34, 197, 94, 0.3)', stroke: '#22c55e', strokeWidth: 3 } }} interpolation="monotoneX" />
                )}

                <VictoryScatter name="scatter" data={chartData} size={({ index }) => activeIndices.includes(index) ? 6 : 0} style={{ data: { fill: '#22c55e', stroke: '#f4f4f5', strokeWidth: 2 } }} />
              </VictoryChart>
            </View>
          ) : (
            <View style={{ height: 180, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: '#52525b', fontSize: 13 }}>데이터 기록이 필요합니다.</Text></View>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 24 }}>
          {['1M', '3M', '1Y', 'ALL'].map(p => (
            <TouchableOpacity key={p} onPress={() => setPeriod(p as any)} style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: period === p ? '#22c55e' : '#18181b', borderWidth: 1, borderColor: period === p ? '#22c55e' : '#27272a', alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontWeight: '900', color: period === p ? '#052e16' : '#71717a' }}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 12 }}>HISTORY</Text>
        <View style={{ backgroundColor: '#18181b', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#27272a' }}>
          {allHistory.slice().reverse().slice(0, 15).map((s, i) => {
            const diff = s.change || 0;
            const isPositive = diff > 0;
            const isNegative = diff < 0;
            const dStr = s.snapshot_date.split('T')[0];
            const formattedDate = dStr.slice(2).replace(/-/g, '.');
            return (
              <View key={s.snapshot_date} style={{ padding: 16, borderBottomWidth: i === allHistory.length - 1 ? 0 : 1, borderBottomColor: '#27272a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View><Text style={{ fontSize: 14, fontWeight: '700', color: '#e4e4e7' }}>{formattedDate}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    {isPositive && <ArrowUpRight size={10} color="#ef4444" />}
                    {isNegative && <ArrowDownRight size={10} color="#3b82f6" />}
                    <Text style={{ fontSize: 11, color: isPositive ? '#ef4444' : (isNegative ? '#3b82f6' : '#52525b'), fontWeight: '600' }}>{diff === 0 ? '변동 없음' : `${diff > 0 ? '+' : ''}${formatCurrency(diff)}`}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#f4f4f5' }}>{formatCurrency(s.total_value_krw)}</Text>
              </View>
            );
          })}
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}
