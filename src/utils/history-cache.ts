import AsyncStorage from '@react-native-async-storage/async-storage';

const STOCK_HISTORY_CACHE_PREFIX = 'cached_stock_history_';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedHistory {
  data: any;
  timestamp: number;
}

/**
 * 주식 과거 이력 데이터를 캐시에서 가져오거나 API를 호출하여 반환합니다.
 */
export const getStockHistory = async (
  ticker: string,
  period: string,
  apiUrl: string,
  forceRefresh = false
): Promise<any> => {
  if (!ticker) return null;
  
  const cacheKey = `${STOCK_HISTORY_CACHE_PREFIX}${ticker}_${period}`;

  try {
    if (!forceRefresh) {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const parsed: CachedHistory = JSON.parse(cached);
        const now = Date.now();
        if (now - parsed.timestamp < CACHE_TTL) {
          console.log(`[HistoryCache] Using cached history for ${ticker} (${period})`);
          return parsed.data;
        }
      }
    }

    console.log(`[HistoryCache] Cache expired or missing for ${ticker}. Fetching...`);
    const res = await fetch(`${apiUrl}/history?symbols=${ticker}&period=${period}`);
    if (!res.ok) throw new Error(`History API error: ${res.status}`);
    
    const data = await res.json();

    // 결과 저장
    await AsyncStorage.setItem(cacheKey, JSON.stringify({
      data,
      timestamp: Date.now()
    }));

    return data;
  } catch (e) {
    console.error('[HistoryCache] Error:', e);
    return null;
  }
};
