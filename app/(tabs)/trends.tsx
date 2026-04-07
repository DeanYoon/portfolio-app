import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Dimensions, Pressable } from 'react-native';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency, formatRate } from '@/src/utils/format';
import { getSelectedPortfolioId, setSelectedPortfolioId } from '@/src/utils/portfolio-state';
import { Wallet, ArrowUpRight, ArrowDownRight } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Stop, Line, Path, Circle, Text as SvgText, G, Rect, Path as SvgPath } from 'react-native-svg';

const { width } = Dimensions.get('window');
const CHART_H = 200;
const PAD_LEFT = 65;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

/* ---------- Allocation Pie Chart ---------- */
const PIE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a855f7', '#6366f1', '#84cc16'];

function AllocationPie({ data, total }: { data: { name: string; ticker: string; value: number; percentage: string }[]; total: number }) {
  const pieSize = 220;
  const cx = pieSize / 2;
  const cy = pieSize / 2;
  const r = 90;
  const innerR = 55;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const slices = useMemo(() => {
    if (total === 0 || data.length === 0) return [];
    const result: { d: string; dInner: string; color: string; midAngle: number; item: typeof data[0]; idx: number }[] = [];
    let cumAngle = -Math.PI / 2;
    
    data.forEach((item, i) => {
      const sliceAngle = (item.value / total) * 2 * Math.PI;
      const startAngle = cumAngle;
      const endAngle = cumAngle + sliceAngle;
      
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      
      const ix1 = cx + innerR * Math.cos(startAngle);
      const iy1 = cy + innerR * Math.sin(startAngle);
      const ix2 = cx + innerR * Math.cos(endAngle);
      const iy2 = cy + innerR * Math.sin(endAngle);
      
      const largeArc = sliceAngle > Math.PI ? 1 : 0;
      
      // Outer arc (clockwise)
      const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
      
      const midAngle = startAngle + sliceAngle / 2;
      result.push({ d, dInner: '', color: PIE_COLORS[i % PIE_COLORS.length], midAngle, item, idx: i });
      cumAngle = endAngle;
    });
    
    return result;
  }, [data, total]);

  const selectedSlice = selectedIndex !== null ? slices[selectedIndex] : null;
  const tipColor = selectedSlice ? selectedSlice.color : null;
  const tipItem = selectedSlice?.item;

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={pieSize} height={pieSize + (selectedSlice ? 50 : 20)}>
        {/* Center text */}
        <G>
          <SvgText x={cx} y={cy - 8} fontSize={11} fill="#52525b" textAnchor="middle">TOTAL</SvgText>
          {(() => {
            const displayVal = total >= 1e8 ? `${(total / 1e8).toFixed(2)}억` : total >= 1e6 ? `${(total / 1e6).toFixed(1)}M` : total >= 1e4 ? `${Math.round(total / 1e4).toLocaleString()}만` : Math.round(total).toLocaleString();
            return <SvgText x={cx} y={cy + 12} fontSize={14} fill="#f4f4f5" fontWeight="900" textAnchor="middle">{displayVal}</SvgText>;
          })()}
        </G>
        
        {/* Slices */}
        {slices.map((s, i) => (
          <Pressable
            key={s.idx}
            onPressIn={() => setSelectedIndex(s.idx)}
            onPress={() => setSelectedIndex(selectedIndex === s.idx ? null : s.idx)}
            style={{ position: 'absolute', top: 0, left: 0, width: pieSize, height: pieSize }}
          />
        ))}
        {slices.map(s => (
          <SvgPath key={`slice-${s.idx}`}
            d={s.d}
            fill={s.color}
            opacity={selectedIndex !== null && selectedIndex !== s.idx ? 0.4 : 1}
            stroke="#09090b"
            strokeWidth={2}
          />
        ))}
        
        {/* Selected label below */}
        {selectedSlice && tipItem && (
          <G>
            <SvgText x={cx} y={pieSize + 16} fontSize={10} fill={tipColor} fontWeight="800" textAnchor="middle">{tipItem.name}</SvgText>
            <SvgText x={cx} y={pieSize + 30} fontSize={11} fill="#f4f4f5" fontWeight="700" textAnchor="middle">
              ₩{tipItem.value >= 1e8 ? `${(tipItem.value / 1e8).toFixed(2)}억` : tipItem.value >= 1e6 ? `${(tipItem.value / 1e6).toFixed(1)}M` : Math.round(tipItem.value).toLocaleString()}
            </SvgText>
            <SvgText x={cx} y={pieSize + 44} fontSize={10} fill="#a1a1aa" fontWeight="600" textAnchor="middle">{tipItem.percentage}%</SvgText>
          </G>
        )}
      </Svg>
      
      {/* Legend */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 8 }}>
        {data.slice(0, 8).map((d, i) => (
          <View key={d.ticker} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
            <Text style={{ fontSize: 9, color: '#a1a1aa', fontWeight: '600' }}>{d.name} {d.percentage}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

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

        {/* Crosshair vertical line (single point only) */}
        {tooltipInfo?.highlight === null && tooltipInfo?.crosshairX != null && (
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
  const [period, setPeriod] = useState<'1W' | '1M' | '3M' | 'ALL'>('1M');

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

  const [holdings, setHoldings] = useState<any[]>([]);
  const [priceMap, setPriceMap] = useState<Record<string, any>>({});

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
      // Fetch holdings for allocation
      const { data: hData } = await supabase.from('holdings').select('id, ticker, name, avg_price, quantity, currency, country, portfolio_id').in('portfolio_id', pIds);
      setHoldings(hData || []);
      // Fetch prices
      if (hData && hData.length > 0) {
        const tickers = Array.from(new Set([...hData.map(h => h.ticker), 'USDKRW=X', 'JPYKRW=X']));
        const symbols = tickers.join(',');
        try {
          const res = await fetch(`https://yahoo-finance-api-seven.vercel.app/quote?symbols=${symbols}`);
          const json = await res.json();
          setPriceMap(json || {});
        } catch (e) {
          console.error('Failed to fetch prices:', e);
        }
      }
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
    if (period === '1W') cutoff.setDate(now.getDate() - 7);
    else if (period === '1M') cutoff.setMonth(now.getMonth() - 1);
    else if (period === '3M') cutoff.setMonth(now.getMonth() - 3);
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

  const displayedFirst = displayedSnapshots[0]?.total_value_krw || 0;
  const displayedLast = displayedSnapshots[displayedSnapshots.length - 1]?.total_value_krw || 0;
  const periodChange = displayedLast - displayedFirst;
  const periodRate = displayedFirst > 0 ? (periodChange / displayedFirst) * 100 : 0;

  // ─── Allocation data ───
  const [allocationTotal, setAllocationTotal] = useState(0);
  const allocationData = useMemo(() => {
    const filtered = selectedPortfolioId === 'ALL' ? holdings : holdings.filter(h => h.portfolio_id === selectedPortfolioId);
    if (filtered.length === 0) return [];
    
    const usdkrw = priceMap['USDKRW=X']?.price || 1400;
    const jpykrw = priceMap['JPYKRW=X']?.price || 9.5;
    
    let total = 0;
    const items = filtered.map(h => {
      const isCash = h.ticker.startsWith('CASH_');
      const isJpFund = h.country === 'JP' && (/^[0-9A-Z]{8}$/.test(h.ticker) || h.ticker === '9I312249');
      const priceInfo = priceMap[h.ticker];
      const currentPrice = priceInfo?.price || h.avg_price;
      const qty = isJpFund ? h.quantity / 10000 : h.quantity;
      const rate = h.currency === 'USD' ? usdkrw : (h.currency === 'JPY' ? jpykrw : 1);
      const effectiveRate = isCash ? 1 : rate;
      const valueKRW = qty * currentPrice * effectiveRate;
      total += valueKRW;
      return { name: h.name || h.ticker, ticker: h.ticker, value: Math.round(valueKRW) };
    }).filter(a => a.value > 0).sort((a, b) => b.value - a.value);
    
    setAllocationTotal(Math.round(total));
    return items.map(a => ({ ...a, percentage: total > 0 ? ((a.value / total) * 100).toFixed(1) : '0' }));
  }, [holdings, priceMap, selectedPortfolioId]);

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
          <Text style={{ fontSize: 32, fontWeight: '900', color: '#f4f4f5', letterSpacing: -1 }}>{formatCurrency(displayedLast)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
             <Text style={{ fontSize: 14, fontWeight: '800', color: periodChange >= 0 ? '#ef4444' : '#3b82f6' }}>{periodChange >= 0 ? '+' : ''}{formatCurrency(periodChange)} ({formatRate(periodRate)})</Text>
             <Text style={{ fontSize: 11, color: '#52525b' }}>{period === 'ALL' ? '전체 기간' : period}</Text>
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
          {['1W', '1M', '3M', 'ALL'].map(p => (
            <TouchableOpacity key={p} onPress={() => setPeriod(p as any)} style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: period === p ? '#22c55e' : '#18181b', borderWidth: 1, borderColor: period === p ? '#22c55e' : '#27272a', alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontWeight: '900', color: period === p ? '#052e16' : '#71717a' }}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 24, textAlign: 'center' }}>TAP A POINT ON CHART</Text>

        <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 12 }}>ALLOCATION</Text>
        {allocationData.length > 0 ? (
          <View style={{ backgroundColor: '#18181b', borderRadius: 20, borderWidth: 1, borderColor: '#27272a', padding: 20, alignItems: 'center' }}>
            <AllocationPie data={allocationData} total={allocationTotal} />
            <Text style={{ fontSize: 10, color: '#52525b', marginTop: 8 }}>Tap a slice to see detail</Text>
          </View>
        ) : (
          <View style={{ backgroundColor: '#18181b', borderRadius: 20, borderWidth: 1, borderColor: '#27272a', padding: 40, alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: '#52525b', fontSize: 13 }}>자산이 없습니다</Text>
          </View>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}
