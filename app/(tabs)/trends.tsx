import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Dimensions } from 'react-native';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency, formatRate } from '@/src/utils/format';
import { getSelectedPortfolioId, setSelectedPortfolioId } from '@/src/utils/portfolio-state';
import { Wallet, ArrowUpRight, ArrowDownRight } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Stop, Line, Path, Circle, Text as SvgText, G, Rect } from 'react-native-svg';

const { width } = Dimensions.get('window');
const CHART_H = 200;
const PAD_LEFT = 65;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

/* ---------- SVG Mini-Chart ---------- */
function MiniChart({
  data,
  yDomain,
  containerW,
  activeIndices,
  onHit,
  onRelease,
}: {
  data: { x: Date; y: number; datum: Snapshot }[];
  yDomain: [number, number];
  containerW: number;
  activeIndices: number[];
  onHit: (i: number) => void;
  onRelease: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerW = containerW - PAD_LEFT - PAD_RIGHT;
  const innerH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const ys: [number, number] = yDomain;

  const sx = (i: number) => (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW + PAD_LEFT);
  const sy = (v: number) => {
    if (ys[1] === ys[0]) return PAD_TOP + innerH / 2;
    return PAD_TOP + innerH - ((v - ys[0]) / (ys[1] - ys[0])) * innerH;
  };

  const handlePointer = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = (x - PAD_LEFT) / innerW;
    const rawIdx = Math.round(ratio * (data.length - 1));
    const idx = Math.max(0, Math.min(data.length - 1, rawIdx));
    if (!Number.isNaN(idx)) onHit(idx);
  }, [innerW, data.length, onHit]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onPointerMove = (e: PointerEvent) => { handlePointer(e.clientX); };
    const onPointerUp = () => onRelease();
    const onClick = (e: MouseEvent) => { handlePointer(e.clientX); };

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('click', onClick);
    };
  }, [handlePointer, onRelease]);

  // Line path
  const lineD = data.length > 1
    ? data.map((d, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(d.y).toFixed(1)}`).join(' ')
    : '';

  // Area fill path
  const areaD = data.length > 1
    ? lineD + ` L${sx(data.length - 1).toFixed(1)},${PAD_TOP + innerH} L${sx(0).toFixed(1)},${PAD_TOP + innerH} Z`
    : '';

  // Grid lines (3 y-axis ticks)
  const isPositive = data.length > 1 ? data[data.length - 1].y >= data[0].y : true;
  const colorPositive = isPositive ? '#22c55e' : '#3b82f6';
  const gridTicks = 3;
  const gridLines: React.ReactElement[] = [];
  for (let i = 0; i <= gridTicks; i++) {
    const yVal = ys[0] + ((ys[1] - ys[0]) * i) / gridTicks;
    const yPos = sy(yVal);
    gridLines.push(
      <Line key={`grid-${i}`} x1={PAD_LEFT} x2={PAD_LEFT + innerW} y1={yPos} y2={yPos}
        stroke="#27272a" strokeWidth={1} />,
      <SvgText key={`y-${i}`} x={PAD_LEFT - 6} y={yPos + 4} fontSize={9} fill="#52525b" textAnchor="end">
        {yVal >= 1e6 ? `${(yVal / 1e6).toFixed(0)}M` : yVal >= 1e3 ? `${(yVal / 1e3).toFixed(0)}K` : Math.round(yVal)}
      </SvgText>
    );
  }

  // X-axis labels — show ~4 labels
  const labelStep = Math.max(1, Math.floor(data.length / 4));
  const xLabelIndices = new Set<number>();
  data.forEach((_, i) => {
    if (i === 0 || i === data.length - 1 || i % labelStep === 0) xLabelIndices.add(i);
  });

  // ─── Floating tooltip position ───
  const tooltipInfo = useMemo(() => {
    if (activeIndices.length === 0 || data.length === 0) return null;
    const shortDate = (ds: string) => ds.split('T')[0].slice(2).replace(/-/g, '.');
    if (activeIndices.length === 1) {
      const idx = activeIndices[0];
      if (idx < 0 || idx >= data.length) return null;
      const d = data[idx];
      return {
        x: sx(idx),
        y: sy(d.y),
        lines: [shortDate(d.datum.snapshot_date), formatCurrency(d.y)],
        highlight: null,
        crosshairX: sx(idx),
      };
    }
    const iStart = Math.min(activeIndices[0], activeIndices[1]);
    const iEnd = Math.max(activeIndices[0], activeIndices[1]);
    if (iStart < 0 || iEnd >= data.length) return null;
    const s = data[iStart]; const e = data[iEnd];
    const diff = e.y - s.y;
    const roi = s.y > 0 ? (diff / s.y) * 100 : 0;
    return {
      x: (sx(iStart) + sx(iEnd)) / 2,
      y: Math.min(sy(s.y), sy(e.y)),
      lines: [
        `${shortDate(s.datum.snapshot_date)} ~ ${shortDate(e.datum.snapshot_date)}`,
        `${diff >= 0 ? '+' : ''}${formatCurrency(diff)} (${roi.toFixed(2)}%)`,
      ],
      highlight: { x1: sx(iStart), x2: sx(iEnd) },
      crosshairX: null,
    };
  }, [activeIndices, data, innerW, innerH]);

  return (
    <View ref={containerRef} style={{ position: 'relative', cursor: 'crosshair' }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderMove={(e) => {
        const locX = (e.nativeEvent as any).locationX;
        if (typeof locX === 'number') {
          const ratio = (locX - PAD_LEFT) / innerW;
          const rawIdx = Math.round(ratio * (data.length - 1));
          const idx = Math.max(0, Math.min(data.length - 1, rawIdx));
          if (!Number.isNaN(idx)) onHit(idx);
        }
      }}
      onResponderRelease={() => onRelease()}
      onResponderTerminate={() => onRelease()}
    >
      <Svg width={containerW} height={CHART_H}>
        <Defs>
          <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colorPositive} stopOpacity="0.25" />
            <Stop offset="100%" stopColor={colorPositive} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        {gridLines}
        {areaD ? <Path d={areaD} fill="url(#areaGrad)" /> : null}
        {lineD ? <Path d={lineD} fill="none" stroke={colorPositive} strokeWidth={2.5} strokeLinejoin="round" /> : null}

        {/* X labels */}
        {data.length > 0 && [...xLabelIndices].map((i) => (
          <SvgText key={`x-${i}`} x={sx(i)} y={CHART_H - 4} fontSize={9} fill="#52525b" textAnchor="middle">
            {data[i].datum.snapshot_date.split('T')[0].slice(2)}
          </SvgText>
        ))}

        {/* Range highlight */}
        {tooltipInfo?.highlight && (
          <Path
            d={`M${tooltipInfo.highlight.x1},${PAD_TOP} L${tooltipInfo.highlight.x1},${PAD_TOP + innerH} L${tooltipInfo.highlight.x2},${PAD_TOP + innerH} L${tooltipInfo.highlight.x2},${PAD_TOP} Z`}
            fill={colorPositive}
            opacity={0.08}
          />
        )}

        {/* Crosshair vertical line */}
        {tooltipInfo?.crosshairX !== null && tooltipInfo.crosshairX !== undefined && (
          <Line
            x1={tooltipInfo.crosshairX} x2={tooltipInfo.crosshairX}
            y1={PAD_TOP} y2={PAD_TOP + innerH}
            stroke="#a1a1aa" strokeWidth={1} strokeDasharray="4,3" opacity={0.5}
          />
        )}

        {/* Active point circles */}
        {activeIndices.map(idx => {
          if (idx < 0 || idx >= data.length) return null;
          return <Circle key={`a-${idx}`} cx={sx(idx)} cy={sy(data[idx].y)} r={5} fill="#fff" stroke={colorPositive} strokeWidth={2} />;
        })}

        {/* Floating tooltip */}
        {tooltipInfo && (
          <G>
            {(() => {
              const tipY = Math.max(PAD_TOP, tooltipInfo.y - 40);
              const tipW = 170;
              const tipH = 42;
              let tipX = tooltipInfo.x - tipW / 2;
              // Clamp to chart bounds
              if (tipX < PAD_LEFT) tipX = PAD_LEFT;
              if (tipX + tipW > PAD_LEFT + innerW) tipX = PAD_LEFT + innerW - tipW;
              const line2 = tooltipInfo.lines[1];
              const isRange = line2.includes('(') && line2.includes('%');
              const tipColor = isRange
                ? (line2.startsWith('+') ? '#ef4444' : '#3b82f6')
                : '#f4f4f5';
              return (
                <>
                  <Rect x={tipX} y={tipY} width={tipW} height={tipH}
                    rx={8} ry={8} fill="#27272a" stroke="#3f3f46" strokeWidth={1} />
                  <SvgText x={tipX + tipW / 2} y={tipY + 17} fontSize={9}
                    fill="#a1a1aa" textAnchor="middle" fontWeight="600">{tooltipInfo.lines[0]}</SvgText>
                  <SvgText x={tipX + tipW / 2} y={tipY + 32} fontSize={11}
                    fill={tipColor}
                    textAnchor="middle" fontWeight="800">{tooltipInfo.lines[1]}</SvgText>
                </>
              );
            })()}
          </G>
        )}
      </Svg>
    </View>
  );
}

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
  const [selectedPortfolioId, setSelectedPortfolioIdLocal] = useState<'ALL' | string>('ALL');
  const [dataLoading, setDataLoading] = useState(true);
  const [rawSnapshots, setRawSnapshots] = useState<Snapshot[]>([]);
  const [period, setPeriod] = useState<'1M' | '3M' | '1Y' | 'ALL'>('1M');

  // 터치 분석 상태
  const [activeIndices, setActiveIndices] = useState<number[]>([]);
  const [containerWidth, setContainerWidth] = useState(width - 32);

  // Sync with shared state on mount
  useEffect(() => {
    (async () => {
      const saved = await getSelectedPortfolioId();
      if (saved) setSelectedPortfolioIdLocal(saved);
    })();
  }, []);

  const fetchData = useCallback(async () => {
    if (!session) return;
    setDataLoading(true);
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
    setDataLoading(false);
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

  if (dataLoading) return <View style={{ flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#22c55e" /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b', paddingTop: insets.top }}>
      <ScrollView scrollEnabled={activeIndices.length === 0} contentContainerStyle={{ padding: 16 }}>
        
        <View style={{ marginBottom: 16 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <TouchableOpacity onPress={async () => { setSelectedPortfolioIdLocal('ALL'); await setSelectedPortfolioId(null); }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: selectedPortfolioId === 'ALL' ? '#22c55e' : '#18181b', borderWidth: 1, borderColor: selectedPortfolioId === 'ALL' ? '#22c55e' : '#27272a' }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: selectedPortfolioId === 'ALL' ? '#052e16' : '#71717a' }}>전체 자산</Text>
            </TouchableOpacity>
            {portfolios.map(p => (
              <TouchableOpacity key={p.id} onPress={async () => { setSelectedPortfolioIdLocal(p.id); await setSelectedPortfolioId(p.id); }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: selectedPortfolioId === p.id ? '#22c55e' : '#18181b', borderWidth: 1, borderColor: selectedPortfolioId === p.id ? '#22c55e' : '#27272a' }}>
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

        {/* Line Chart */}
        {chartData.length > 0 && (
          <View style={{ backgroundColor: '#18181b', borderRadius: 24, borderWidth: 1, borderColor: '#27272a', marginBottom: 12, overflow: 'hidden' }}>
            {/* Analysis tooltip removed — floating tooltip inside chart now */}
            <MiniChart
              data={chartData}
              yDomain={yDomain}
              containerW={width - 32}
              activeIndices={activeIndices}
              onHit={(i) => {
                setActiveIndices(prev => {
                  if (prev.length >= 2) return [i]; // 3rd tap → reset to single
                  if (prev.length === 0) return [i]; // 1st tap
                  const exists = prev.includes(i);
                  if (exists) return prev.filter(idx => idx !== i);
                  return [prev[0], i]; // 2nd tap → range
                });
              }}
              onRelease={() => setActiveIndices([])}
            />
          </View>
        )}

        {/* Period selector */}

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
