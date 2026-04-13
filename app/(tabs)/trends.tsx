import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Dimensions, Pressable, AppState, AppStateStatus, Modal, Animated, Easing } from 'react-native';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCurrency, formatRate } from '@/src/utils/format';
import { getSelectedPortfolioId, setSelectedPortfolioId } from '@/src/utils/portfolio-state';
import { getHoldings } from '@/src/utils/holdings-cache';
import { Wallet, ArrowUpRight, ArrowDownRight, ChevronDown } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Stop, Line, Path, Circle, Text as SvgText, G, Rect } from 'react-native-svg';
import { ErrorBoundary } from '@/src/components/error-boundary';

const { width } = Dimensions.get('window');
const CHART_H = 200;
const PAD_LEFT = 65;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

const PIE_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

// ─── Skeleton Component ───
const Skeleton = ({ width, height, borderRadius = 8, marginBottom = 0, style = {} }: any) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          backgroundColor: '#27272a',
          borderRadius,
          marginBottom,
          opacity,
        },
        style,
      ]}
    />
  );
};

const TrendsSkeleton = ({ insets }: { insets: any }) => (
  <View style={{ flex: 1, backgroundColor: '#09090b', paddingHorizontal: 16, paddingTop: insets.top + 12 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
      <Skeleton width={120} height={40} borderRadius={10} />
      <Skeleton width={150} height={40} borderRadius={10} />
    </View>
    
    <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 16, borderWidth: 1, borderColor: '#27272a', marginBottom: 24 }}>
      <Skeleton width={80} height={10} marginBottom={12} />
      <Skeleton width={200} height={32} marginBottom={20} />
      <Skeleton width=\"100%\" height={200} borderRadius={12} />
    </View>

    <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#27272a' }}>
      <Skeleton width={120} height={16} marginBottom={20} />
      <View style={{ alignItems: 'center' }}>
        <Skeleton width={220} height={220} borderRadius={110} />
      </View>
    </View>
  </View>
);

function AllocationPie({ data, total }: { data: any[], total: number }) {
  const radius = 100; const innerRadius = 75; const centerX = 150; const centerY = 150;
  let cumulativeAngle = 0;
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: 300, height: 300, justifyContent: 'center', alignItems: 'center' }}>
        <Svg width={300} height={300} viewBox="0 0 300 300">
          <G transform="translate(0, 0)">
            {data.map((item, index) => {
              const sliceAngle = (Number(item.percentage) / 100) * 360;
              const startAngle = cumulativeAngle; const endAngle = cumulativeAngle + sliceAngle; cumulativeAngle += sliceAngle;
              const x1 = centerX + radius * Math.cos((Math.PI * (startAngle - 90)) / 180);
              const y1 = centerY + radius * Math.sin((Math.PI * (startAngle - 90)) / 180);
              const x2 = centerX + radius * Math.cos((Math.PI * (endAngle - 90)) / 180);
              const y2 = centerY + radius * Math.sin((Math.PI * (endAngle - 90)) / 180);
              const ix1 = centerX + innerRadius * Math.cos((Math.PI * (startAngle - 90)) / 180);
              const iy1 = centerY + innerRadius * Math.sin((Math.PI * (startAngle - 90)) / 180);
              const ix2 = centerX + innerRadius * Math.cos((Math.PI * (endAngle - 90)) / 180);
              const iy2 = centerY + innerRadius * Math.sin((Math.PI * (endAngle - 90)) / 180);
              const largeArcFlag = sliceAngle > 180 ? 1 : 0;
              const d = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${ix1} ${iy1} Z`;
              return <Path key={item.ticker} d={d} fill={PIE_COLORS[index % PIE_COLORS.length]} opacity={0.8} />;
            })}
          </G>
        </Svg>
        <View style={{ position: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 2, marginBottom: 2, textTransform: 'uppercase' }}>Total Value</Text>
          <Text style={{ fontSize: 16, fontWeight: '900', color: '#f4f4f5' }}>₩{Math.round(total).toLocaleString()}</Text>
        </View>
      </View>
      <View style={{ width: '100%', marginTop: 8, maxHeight: 200 }}>
        <ScrollView nestedScrollEnabled>
          {data.map((item: any, index: number) => (
            <View key={item.ticker} style={{ paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(63,63,70,0.3)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                <View><Text style={{ fontSize: 13, fontWeight: '800', color: '#d4d4d8' }} numberOfLines={1}>{item.fullName || item.name}</Text><Text style={{ fontSize: 9, fontWeight: '900', color: '#52525b', letterSpacing: 1 }}>{item.ticker}</Text></View>
              </View>
              <View style={{ alignItems: 'flex-end', flexShrink: 0 }}><Text style={{ fontSize: 13, fontWeight: '900', color: '#f4f4f5' }}>{item.percentage}%</Text><Text style={{ fontSize: 9, fontWeight: '700', color: '#52525b' }}>₩{Math.round(item.value).toLocaleString()}</Text></View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function MiniChart({ data, yDomain, containerW, activeIndices, onHit, onRelease }: { data: any[], yDomain: [number, number], containerW: number, activeIndices: number[], onHit: (i: number) => void, onRelease: () => void }) {
  const innerW = containerW - PAD_LEFT - PAD_RIGHT; const innerH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const sx = (i: number) => (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW + PAD_LEFT);
  const sy = (v: number) => (yDomain[1] === yDomain[0] ? PAD_TOP + innerH / 2 : PAD_TOP + innerH - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerH);
  const lineD = data.length > 1 ? data.map((d, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(d.y).toFixed(1)}`).join(' ') : '';
  const areaD = data.length > 1 ? lineD + ` L${sx(data.length - 1).toFixed(1)},${PAD_TOP + innerH} L${sx(0).toFixed(1)},${PAD_TOP + innerH} Z` : '';
  const colorPositive = data.length > 1 && data[data.length - 1].y >= data[0].y ? '#22c55e' : '#3b82f6';
  const gridLines: any[] = [];
  for (let i = 0; i <= 3; i++) {
    const yVal = yDomain[0] + ((yDomain[1] - yDomain[0]) * i) / 3; const yPos = sy(yVal);
    gridLines.push(<Line key={`g-${i}`} x1={PAD_LEFT} x2={PAD_LEFT + innerW} y1={yPos} y2={yPos} stroke="#27272a" strokeWidth={1} />, <SvgText key={`y-${i}`} x={PAD_LEFT - 6} y={yPos + 4} fontSize={9} fill="#52525b" textAnchor="end">{yVal >= 1e6 ? `${(yVal / 1e6).toFixed(0)}M` : yVal >= 1e3 ? `${(yVal / 1e3).toFixed(0)}K` : Math.round(yVal)}</SvgText>);
  }
  const tooltipInfo = useMemo(() => {
    if (activeIndices.length === 0 || data.length === 0) return null;
    const shortDate = (ds: string) => ds.split('T')[0].slice(2).replace(/-/g, '.');
    if (activeIndices.length === 1) {
      const d = data[activeIndices[0]]; return { x: sx(activeIndices[0]), y: sy(d.y), lines: [shortDate(d.datum.snapshot_date), formatCurrency(d.y)], highlight: null, crosshairX: sx(activeIndices[0]) };
    }
    const idxS = Math.min(...activeIndices); const idxE = Math.max(...activeIndices); const s = data[idxS]; const e = data[idxE];
    const diff = e.y - s.y; const roi = s.y > 0 ? (diff / s.y) * 100 : 0;
    return { x: (sx(idxS) + sx(idxE)) / 2, y: Math.min(sy(s.y), sy(e.y)), lines: [`${shortDate(s.datum.snapshot_date)} ~ ${shortDate(e.datum.snapshot_date)}`, `${diff >= 0 ? '+' : ''}${formatCurrency(diff)} (${roi.toFixed(2)}%)`], highlight: { x1: sx(idxS), x2: sx(idxE) }, crosshairX: null };
  }, [activeIndices, data]);

  return (
    <View style={{ position: 'relative' }} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderMove={(e) => { const locX = e.nativeEvent.locationX; const ratio = (locX - PAD_LEFT) / innerW; const idx = Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))); if (!isNaN(idx)) onHit(idx); }} onResponderRelease={onRelease} onResponderTerminate={onRelease}>
      <Svg width={containerW} height={CHART_H}>
        <Defs><LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor={colorPositive} stopOpacity="0.25" /><Stop offset="100%" stopColor={colorPositive} stopOpacity="0.02" /></LinearGradient></Defs>
        {gridLines}
        {areaD ? <Path d={areaD} fill="url(#areaGrad)" /> : null}
        {lineD ? <Path d={lineD} fill="none" stroke={colorPositive} strokeWidth={2.5} strokeLinejoin="round" /> : null}
        {data.length > 0 && [0, data.length - 1].map(i => <SvgText key={`x-${i}`} x={sx(i)} y={CHART_H - 4} fontSize={9} fill="#52525b" textAnchor={i === 0 ? "start" : "end"}>{data[i].datum.snapshot_date.split('T')[0].slice(2)}</SvgText>)}
        {tooltipInfo?.highlight && <Path d={`M${tooltipInfo.highlight.x1},${PAD_TOP} L${tooltipInfo.highlight.x1},${PAD_TOP + innerH} L${tooltipInfo.highlight.x2},${PAD_TOP + innerH} L${tooltipInfo.highlight.x2},${PAD_TOP} Z`} fill={colorPositive} opacity={0.08} />}
        {tooltipInfo?.crosshairX != null && <Line x1={tooltipInfo.crosshairX} x2={tooltipInfo.crosshairX} y1={PAD_TOP} y2={PAD_TOP + innerH} stroke="#a1a1aa" strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />}
        {activeIndices.map(idx => <Circle key={`a-${idx}`} cx={sx(idx)} cy={sy(data[idx].y)} r={5} fill="#fff" stroke={colorPositive} strokeWidth={2} />)}
        {tooltipInfo && <G>{(() => { const tipY = Math.max(PAD_TOP, tooltipInfo.y - 45); const tipW = 160; const tipH = 40; let tipX = tooltipInfo.x - tipW / 2; if (tipX < PAD_LEFT) tipX = PAD_LEFT; if (tipX + tipW > PAD_LEFT + innerW) tipX = PAD_LEFT + innerW - tipW; const tipColor = tooltipInfo.lines[1].includes('(') ? (tooltipInfo.lines[1].startsWith('+') ? '#ef4444' : '#3b82f6') : '#f4f4f5'; return (<><Rect x={tipX} y={tipY} width={tipW} height={tipH} rx={8} ry={8} fill="#27272a" stroke="#3f3f46" strokeWidth={1} /><SvgText x={tipX + tipW / 2} y={tipY + 15} fontSize={9} fill="#a1a1aa" textAnchor="middle" fontWeight="600">{tooltipInfo.lines[0]}</SvgText><SvgText x={tipX + tipW / 2} y={tipY + 30} fontSize={11} fill={tipColor} textAnchor="middle" fontWeight="800">{tooltipInfo.lines[1]}</SvgText></>); })()}</G>}
      </Svg>
    </View>
  );
}

export default function TrendsScreen() {
  const insets = useSafeAreaInsets();
  const { session, loading: authLoading } = useAuth();
  const [portfolios, setPortfolios] = useState<any[]>([]);
  const [selectedId, setSelectedIdLocal] = useState<string>('');
  const [dataLoading, setDataLoading] = useState(true);
  const [rawSnapshots, setRawSnapshots] = useState<any[]>([]);
  const [period, setPeriod] = useState<'1W' | '1M' | '3M' | 'ALL'>('1M');
  const [holdings, setHoldings] = useState<any[]>([]);
  const [priceMap, setPriceMap] = useState<Record<string, any>>({});
  const [activeIndices, setActiveIndices] = useState<number[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const isFetchingRef = useRef(false);

  const setSelectedId = async (id: string) => {
    setSelectedIdLocal(id); await setSelectedPortfolioId(id); setShowPicker(false);
  };

  const loadTrends = useCallback(async (forceRefresh = false) => {
    if (!session || isFetchingRef.current) return;
    isFetchingRef.current = true; setDataLoading(true);
    try {
      const cachedHoldings = await getHoldings(undefined, forceRefresh);
      let quotePromise = Promise.resolve({});
      if (cachedHoldings.length > 0) {
        const tickers = Array.from(new Set([...cachedHoldings.map((h: any) => h.ticker), '^VIX', 'USDKRW=X', 'JPYKRW=X']));
        quotePromise = fetch(`https://yahoo-finance-api-seven.vercel.app/quote?symbols=${tickers.join(',')}`).then(r => r.json());
      }
      const [pRes, sRes] = await Promise.all([supabase.from('portfolios').select('id, name').eq('user_id', session.user.id), supabase.from('portfolio_snapshots').select('snapshot_date, total_value_krw, portfolio_id').order('snapshot_date', { ascending: true })]);
      if (!pRes.data) { isFetchingRef.current = false; setDataLoading(false); return; }
      const pIds = pRes.data.map(p => p.id);
      const jpTickers = cachedHoldings.filter(h => h.country === 'JP').map(h => h.ticker);
      const [priceRes, jpRes] = await Promise.all([quotePromise, jpTickers.length > 0 ? supabase.from('japan_funds').select('fcode, price_data').in('fcode', jpTickers) : Promise.resolve({ data: [] })]);
      const fmtPrices: Record<string, any> = {};
      if (priceRes) Object.entries(priceRes).forEach(([tk, i]: any) => { if (i.price) fmtPrices[tk] = { price: i.price, name: i.symbol || tk, change_amount: i.change || 0, change_percent: i.changePercent || 0 }; });
      if (jpRes.data) jpRes.data.forEach((f: any) => { if (f.price_data) fmtPrices[f.fcode] = { price: f.price_data.price, change_amount: f.price_data.change_amount || 0, change_percent: f.price_data.change_percent || 0 }; });
      cachedHoldings.filter(h => h.ticker.startsWith('CASH_')).forEach(h => { fmtPrices[h.ticker] = { price: h.ticker.split('_')[1] === 'KRW' ? 1 : 0 }; });
      setRawSnapshots(sRes.data?.filter(s => pIds.includes(s.portfolio_id)) || []);
      setHoldings(cachedHoldings); setPortfolios(pRes.data); setPriceMap(fmtPrices);
    } catch (e) { console.error(e); }
    finally { setDataLoading(false); isFetchingRef.current = false; }
  }, [session]);

  const allocationData = useMemo(() => {
    const filtered = !selectedId ? holdings : holdings.filter(h => String(h.portfolio_id) === String(selectedId));
    const usdkrw = priceMap['USDKRW=X']?.price || 1400; const jpykrw = priceMap['JPYKRW=X']?.price || 9.5;
    const items = filtered.map(h => {
      const mi = priceMap[h.ticker]; const cp = mi?.price || h.avg_price;
      const rate = h.currency === 'USD' ? usdkrw : (h.currency === 'JPY' ? jpykrw : 1);
      const qty = h.country === 'JP' && /^[0-9A-Z]{8}$/.test(h.ticker) ? h.quantity/10000 : h.quantity;
      const val = Math.round(qty * cp * rate);
      return { name: h.name || h.ticker, fullName: mi?.name || h.name || h.ticker, ticker: h.ticker, value: val };
    }).filter(i => i.value > 0).sort((a,b) => b.value - a.value);
    const total = items.reduce((s, i) => s + i.value, 0);
    return { items: items.map(i => ({ ...i, percentage: total > 0 ? (i.value/total*100).toFixed(1) : "0" })), total };
  }, [holdings, priceMap, selectedId]);

  const allHistory = useMemo(() => {
    const filtered = !selectedId ? rawSnapshots : rawSnapshots.filter(s => String(s.portfolio_id) === String(selectedId));
    const grouped = filtered.reduce((acc: any, curr) => {
      const d = new Date(curr.snapshot_date); if (curr.snapshot_date.includes('T00:00:00')) d.setMinutes(d.getMinutes()-1);
      const date = d.toISOString().split('T')[0]; acc[date] = (acc[date] || 0) + Number(curr.total_value_krw); return acc;
    }, {});
    const todayStr = new Date().toISOString().split('T')[0]; delete grouped[todayStr];
    const fmt = Object.entries(grouped).map(([date, val]) => ({ snapshot_date: date, total_value_krw: val as number })).sort((a,b) => a.snapshot_date.localeCompare(b.snapshot_date));
    if (allocationData.total > 0) fmt.push({ snapshot_date: todayStr, total_value_krw: allocationData.total });
    return fmt;
  }, [rawSnapshots, selectedId, allocationData.total]);

  const chartData = useMemo(() => {
    const cutoff = new Date(); if (period === '1W') cutoff.setDate(cutoff.getDate()-7); else if (period === '1M') cutoff.setMonth(cutoff.getMonth()-1); else if (period === '3M') cutoff.setMonth(cutoff.getMonth()-3);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const filtered = period === 'ALL' ? allHistory : allHistory.filter(s => s.snapshot_date >= cutoffStr);
    return filtered.map(s => ({ x: new Date(s.snapshot_date), y: s.total_value_krw, datum: s }));
  }, [allHistory, period]);
  
  useFocusEffect(useCallback(() => { getSelectedPortfolioId().then(s => { if (s) setSelectedIdLocal(s); loadTrends(); }); }, [loadTrends]));

  if (authLoading || (dataLoading && holdings.length === 0)) return <TrendsSkeleton insets={insets} />;
  const yDomain: [number, number] = chartData.length ? (() => { const vals = chartData.map(d => d.y); const min = Math.min(...vals); const max = Math.max(...vals); const pad = (max-min)*0.1 || min*0.1; return [Math.max(0, min-pad), max+pad]; })() : [0, 100];
  const lastVal = chartData[chartData.length-1]?.y || 0; const firstVal = chartData[0]?.y || 0; const diff = lastVal - firstVal;
  
  return (
    <View style={{ flex: 1, backgroundColor: '#09090b' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: insets.top + 12, paddingBottom: 8 }}>
        <TouchableOpacity onPress={() => setShowPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: '#e4e4e7' }}>{portfolios.find(p => p.id === selectedId)?.name?.substring(0,10) || '계좌 선택'}</Text>
          <ChevronDown size={16} color="#71717a" />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', backgroundColor: '#18181b', borderRadius: 8, padding: 4 }}>
          {['1W', '1M', '3M', 'ALL'].map((p: any) => (
            <TouchableOpacity key={p} onPress={() => setPeriod(p)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: period === p ? '#27272a' : 'transparent' }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: period === p ? '#f4f4f5' : '#71717a' }}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <ErrorBoundary name="Trends Main Chart">
          <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 16, borderWidth: 1, borderColor: '#27272a', marginBottom: 24 }}>
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 2 }}>PERFORMANCE</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8, marginBottom: 20 }}>
              <Text style={{ fontSize: 28, fontWeight: '900', color: '#f4f4f5' }}>{formatCurrency(lastVal)}</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: diff >= 0 ? '#22c55e' : '#3b82f6', marginBottom: 4 }}>{formatRate(firstVal > 0 ? (diff/firstVal)*100 : 0)}</Text>
            </View>
            <View style={{ height: CHART_H, marginLeft: -16 }}><MiniChart data={chartData} yDomain={yDomain} containerW={width - 32} activeIndices={activeIndices} onHit={i => setActiveIndices([i])} onRelease={() => setActiveIndices([])} /></View>
          </View>
        </ErrorBoundary>

        <ErrorBoundary name="Trends Allocation Pie">
          <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#27272a', marginBottom: 100 }}>
            <Text style={{ fontSize: 14, fontWeight: '900', color: '#f4f4f5', marginBottom: 20 }}>Asset Allocation</Text>
            {allocationData.items.length > 0 ? <AllocationPie data={allocationData.items} total={allocationData.total} /> : <ActivityIndicator color="#22c55e" />}
          </View>
        </ErrorBoundary>
      </ScrollView>
      {/* Portfolio Selector Modal */}
      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <TouchableOpacity 
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} 
          activeOpacity={1} 
          onPress={() => setShowPicker(false)}
        >
          <TouchableOpacity 
            activeOpacity={1}
            style={{ backgroundColor: '#18181b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: 400 }}
          >
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#f4f4f5', marginBottom: 12 }}>계좌 선택</Text>
            <ScrollView>
              {portfolios.map(p => (
                <TouchableOpacity key={p.id} onPress={() => setSelectedId(p.id)} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#27272a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: p.id === selectedId ? '#22c55e' : '#e4e4e7' }}>{p.name}</Text>
                  {p.id === selectedId && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setShowPicker(false)} style={{ paddingVertical: 16, alignItems: 'center' }}><Text style={{ fontSize: 14, fontWeight: '700', color: '#52525b' }}>닫기</Text></TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
