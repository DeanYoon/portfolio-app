import AsyncStorage from '@react-native-async-storage/async-storage';

const QUOTE_CACHE_STORAGE_KEY = 'unified_ticker_quote_cache';
const QUOTE_TTL = 5 * 60 * 1000; // 5 minutes

interface QuoteCacheStructure {
  [ticker: string]: {
    data: any;
    timestamp: number;
  };
}

/**
 * 실시간 주가(Quote) 데이터를 5분간 캐싱합니다.
 */
export const getTickerQuote = async (
  ticker: string,
  apiUrl: string,
  forceRefresh = false
): Promise<any> => {
  try {
    const cachedStr = await AsyncStorage.getItem(QUOTE_CACHE_STORAGE_KEY);
    let cache: QuoteCacheStructure = cachedStr ? JSON.parse(cachedStr) : {};
    const now = Date.now();

    if (!forceRefresh && cache[ticker]) {
      const item = cache[ticker];
      if (now - item.timestamp < QUOTE_TTL) {
        console.log(`[QuoteCache] HIT: ${ticker}`);
        return item.data;
      }
    }

    console.log(`[QuoteCache] MISS: ${ticker}. Fetching...`);
    const res = await fetch(`${apiUrl}/quote?symbols=${ticker}`);
    const json = await res.json();
    const data = json?.[ticker];

    if (data) {
      cache[ticker] = { data, timestamp: now };
      await AsyncStorage.setItem(QUOTE_CACHE_STORAGE_KEY, JSON.stringify(cache));
    }

    return data;
  } catch (e) {
    console.error('[QuoteCache] Error:', e);
    return null;
  }
};
