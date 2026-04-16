import AsyncStorage from '@react-native-async-storage/async-storage';

const STOCK_HISTORY_STORAGE_KEY = 'unified_stock_history_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CacheStructure {
  [ticker: string]: {
    data: any[];
    timestamp: number;
    period: string;
  };
}

/**
 * 1년치 데이터를 기본으로 가져와서 캐싱하고, 배열 형태로 반환합니다.
 */
export const getStockHistory = async (
  ticker: string,
  period: string, // '1mo', '6mo', '1y'
  apiUrl: string,
  forceRefresh = false
): Promise<any[]> => {
  if (!ticker) return [];

  try {
    const cachedStr = await AsyncStorage.getItem(STOCK_HISTORY_STORAGE_KEY);
    let cache: CacheStructure = cachedStr ? JSON.parse(cachedStr) : {};
    const now = Date.now();

    // 1. 캐시 확인
    if (!forceRefresh && cache[ticker]) {
      const item = cache[ticker];
      if (now - item.timestamp < CACHE_TTL) {
        console.log(`[HistoryCache] HIT for ${ticker}`);
        return item.data;
      }
    }

    // 2. Fetch from API
    const fetchPeriod = '1y';
    console.log(`[HistoryCache] MISS for ${ticker}. Fetching ${fetchPeriod}...`);
    const res = await fetch(`${apiUrl}/history?symbols=${ticker}&period=${fetchPeriod}`);
    if (!res.ok) throw new Error(`History API error: ${res.status}`);
    
    const fullData = await res.json();
    const tickerData = fullData[ticker] || [];

    // 3. 캐시에 저장 (배열 형식 그대로 유지)
    cache[ticker] = {
      data: tickerData,
      timestamp: now,
      period: fetchPeriod
    };

    await AsyncStorage.setItem(STOCK_HISTORY_STORAGE_KEY, JSON.stringify(cache));

    return tickerData;
  } catch (e) {
    console.error('[HistoryCache] Error:', e);
    return [];
  }
};
