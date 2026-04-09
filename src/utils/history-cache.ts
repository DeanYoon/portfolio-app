import AsyncStorage from '@react-native-async-storage/async-storage';

const STOCK_HISTORY_STORAGE_KEY = 'unified_stock_history_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CacheStructure {
  [ticker: string]: {
    [period: string]: {
      data: any;
      timestamp: number;
    };
  };
}

/**
 * 하나의 키값(unified_stock_history_cache) 아래에 모든 티커와 기간 데이터를 구조화하여 저장합니다.
 */
export const getStockHistory = async (
  ticker: string,
  period: string,
  apiUrl: string,
  forceRefresh = false
): Promise<any> => {
  if (!ticker) return null;

  try {
    const cachedStr = await AsyncStorage.getItem(STOCK_HISTORY_STORAGE_KEY);
    let cache: CacheStructure = cachedStr ? JSON.parse(cachedStr) : {};
    const now = Date.now();

    // 1. 캐시 확인
    if (!forceRefresh && cache[ticker]?.[period]) {
      const item = cache[ticker][period];
      if (now - item.timestamp < CACHE_TTL) {
        console.log(`[HistoryCache] Unified cache HIT for ${ticker} (${period})`);
        return item.data;
      }
    }

    // 2. Fetch from API
    console.log(`[HistoryCache] Unified cache MISS for ${ticker} (${period}). Fetching...`);
    const res = await fetch(`${apiUrl}/history?symbols=${ticker}&period=${period}`);
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

    // 4. 구조화된 캐시에 병합 및 저장
    if (!cache[ticker]) cache[ticker] = {};
    cache[ticker][period] = {
      data: optimized,
      timestamp: now
    };

    await AsyncStorage.setItem(STOCK_HISTORY_STORAGE_KEY, JSON.stringify(cache));

    return optimized;
  } catch (e) {
    console.error('[HistoryCache] Unified Error:', e);
    return null;
  }
};
