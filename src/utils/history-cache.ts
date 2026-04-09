import AsyncStorage from '@react-native-async-storage/async-storage';

const STOCK_HISTORY_STORAGE_KEY = 'unified_stock_history_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CacheStructure {
  [ticker: string]: {
    data: any;
    timestamp: number;
    period: string; // 저장된 데이터의 원본 기간 (예: '1y')
  };
}

/**
 * 1년치 데이터를 기본으로 가져와서 캐싱하고, 필요한 기간만큼 잘라서 반환합니다.
 */
export const getStockHistory = async (
  ticker: string,
  period: string, // '1mo', '6mo', '1y'
  apiUrl: string,
  forceRefresh = false
): Promise<any> => {
  if (!ticker) return null;

  try {
    const cachedStr = await AsyncStorage.getItem(STOCK_HISTORY_STORAGE_KEY);
    let cache: CacheStructure = cachedStr ? JSON.parse(cachedStr) : {};
    const now = Date.now();

    // 1. 캐시 확인: 이미 1y 데이터가 있고 24시간 이내라면 활용
    if (!forceRefresh && cache[ticker]) {
      const item = cache[ticker];
      if (now - item.timestamp < CACHE_TTL) {
        console.log(`[HistoryCache] HIT for ${ticker} (returning subset of ${item.period})`);
        return item.data; // UI단에서 어차피 날짜 필터링을 하므로 전체 데이터 반환
      }
    }

    // 2. Fetch from API: 무조건 '1y'로 요청하여 넓은 범위를 확보
    const fetchPeriod = '1y';
    console.log(`[HistoryCache] MISS for ${ticker}. Fetching ${fetchPeriod} for wide coverage...`);
    const res = await fetch(`${apiUrl}/history?symbols=${ticker}&period=${fetchPeriod}`);
    if (!res.ok) throw new Error(`History API error: ${res.status}`);
    
    const fullData = await res.json();

    // 3. 데이터 경량화
    const optimized: any = {};
    if (fullData && fullData[ticker]) {
      optimized[ticker] = {};
      Object.entries(fullData[ticker]).forEach(([date, details]: [string, any]) => {
        if (details.close != null) {
          optimized[ticker][date] = { close: details.close };
        }
      });
    }

    // 4. 구조화된 캐시에 저장
    cache[ticker] = {
      data: optimized,
      timestamp: now,
      period: fetchPeriod
    };

    await AsyncStorage.setItem(STOCK_HISTORY_STORAGE_KEY, JSON.stringify(cache));

    return optimized;
  } catch (e) {
    console.error('[HistoryCache] Error:', e);
    return null;
  }
};
