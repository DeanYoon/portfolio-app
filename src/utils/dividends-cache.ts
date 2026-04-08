import AsyncStorage from '@react-native-async-storage/async-storage';

const DIVIDENDS_CACHE_PREFIX = 'cached_dividends_';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedDividends {
  data: Record<string, any>;
  timestamp: number;
}

/**
 * 배당 데이터를 캐시에서 가져오거나 API를 호출하여 반환합니다.
 * @param tickers 조회할 티커 배열
 * @param apiUrl API 베이스 URL
 * @param forceRefresh 강제 새로고침 여부
 */
export const getDividends = async (
  tickers: string[],
  apiUrl: string,
  forceRefresh = false
): Promise<Record<string, any>> => {
  if (tickers.length === 0) return {};

  // 티커 리스트를 정렬하여 일관된 캐시 키 생성 (포트폴리오마다 구성이 다를 수 있으므로)
  const cacheKey = `${DIVIDENDS_CACHE_PREFIX}${tickers.sort().join(',')}`;

  try {
    if (!forceRefresh) {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const parsed: CachedDividends = JSON.parse(cached);
        const now = Date.now();
        if (now - parsed.timestamp < CACHE_TTL) {
          console.log('[DividendsCache] Using cached data for', tickers.length, 'tickers');
          return parsed.data;
        }
      }
    }

    console.log('[DividendsCache] Cache expired or missing. Fetching from API...');
    const url = `${apiUrl}/dividends?symbols=${tickers.join(',')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    
    const data = await res.json();

    // 결과 저장
    await AsyncStorage.setItem(cacheKey, JSON.stringify({
      data,
      timestamp: Date.now()
    }));

    return data;
  } catch (e) {
    console.error('[DividendsCache] Error:', e);
    return {};
  }
};

/**
 * 모든 배당 캐시 데이터를 삭제합니다. (종목 수정 시 호출 권장)
 */
export const clearDividendsCache = async () => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const dividendKeys = keys.filter(key => key.startsWith(DIVIDENDS_CACHE_PREFIX));
    if (dividendKeys.length > 0) {
      await AsyncStorage.multiRemove(dividendKeys);
      console.log('[DividendsCache] All dividend caches cleared');
    }
  } catch (e) {
    console.error('[DividendsCache] Clear error:', e);
  }
};
