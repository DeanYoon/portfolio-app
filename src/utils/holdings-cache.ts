import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase';

const HOLDINGS_CACHE_KEY = 'cached_holdings_data';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedHoldings {
  data: any[];
  timestamp: number;
}

export const getHoldings = async (portfolioId?: string, forceRefresh = false): Promise<any[]> => {
  try {
    if (!forceRefresh) {
      const cached = await AsyncStorage.getItem(HOLDINGS_CACHE_KEY);
      if (cached) {
        const parsed: CachedHoldings = JSON.parse(cached);
        const now = Date.now();
        if (now - parsed.timestamp < CACHE_TTL) {
          console.log('[HoldingsCache] Using cached data');
          // portfolioId가 있으면 필터링해서 반환, 없으면 전체 반환
          return portfolioId 
            ? parsed.data.filter(h => h.portfolio_id === portfolioId)
            : parsed.data;
        }
      }
    }

    console.log('[HoldingsCache] Fetching from Supabase...');
    // 캐시가 없거나 만료되었거나 강제 새로고침인 경우
    // 효율성을 위해 현재 사용자의 전체 holdings를 한 번에 가져옴
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];

    // 사용자의 모든 포트폴리오 ID를 먼저 가져와서 전체 holdings 로드
    const { data: portfolios } = await supabase
      .from('portfolios')
      .select('id')
      .eq('user_id', session.user.id);
    
    if (!portfolios || portfolios.length === 0) return [];
    const pIds = portfolios.map(p => p.id);

    const { data: holdings, error } = await supabase
      .from('holdings')
      .select('id, ticker, name, avg_price, quantity, currency, country, portfolio_id')
      .in('portfolio_id', pIds);

    if (error) throw error;

    // 전체 데이터 캐싱
    await AsyncStorage.setItem(HOLDINGS_CACHE_KEY, JSON.stringify({
      data: holdings || [],
      timestamp: Date.now()
    }));

    return portfolioId 
      ? (holdings || []).filter(h => h.portfolio_id === portfolioId)
      : (holdings || []);
  } catch (e) {
    console.error('[HoldingsCache] Error:', e);
    return [];
  }
};

export const clearHoldingsCache = async () => {
  await AsyncStorage.removeItem(HOLDINGS_CACHE_KEY);
  console.log('[HoldingsCache] Cache cleared');
};
