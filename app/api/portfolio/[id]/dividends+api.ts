import { supabaseAdmin } from '@/src/lib/supabase-admin';

export async function GET(request: Request, { id }: { id: string }) {
  try {
    if (!supabaseAdmin) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Admin operations are unavailable.');
    }

    // 1. holdings 조회
    const { data: holdings, error: hError } = await supabaseAdmin
      .from('holdings')
      .select('ticker, quantity, portfolio_id')
      .eq('portfolio_id', id);

    if (hError) {
      console.error('Supabase Error:', hError);
      throw new Error(`Database error: ${hError.message}`);
    }
    
    console.log(`Holdings for ${id}:`, holdings?.length || 0, 'items found.');
    
    if (!holdings || holdings.length === 0) {
      return Response.json([]);
    }

    const rawTickers: string[] = Array.from(new Set(holdings.map((h: any) => h.ticker as string)));
    console.log('Raw tickers from DB:', rawTickers);
    
    // Normalize tickers: 
    // - 6-digit numeric -> append .KS (Samsung etc.)
    // - Others -> use as is
    const tickers: string[] = rawTickers.map((t: string) => {
      if (/^[0-9]{6}$/.test(t)) return `${t}.KS`;
      return t;
    });

    console.log('Normalized tickers for Yahoo:', tickers);
    
    // 2. 종목사별 배당 데이터 페칭 합계 (Yahoo Finance)
    const dividendPromises = tickers.map(async (ticker: string) => {
      try {
        // Japan stocks usually end with .T or are 4-digit numbers
        if (ticker.endsWith('.T') || /^[0-9]{4}$/.test(ticker)) {
          return await fetchJapanDividends(ticker);
        } else {
          return await fetchYahooDividends(ticker);
        }
      } catch (e: any) {
        console.error(`Error fetching for ${ticker}:`, e.message);
        // If it's the strict Japan scrape failed, we rethrow to hit the outer 502 handler
        if (e.message === 'JAPAN_SCRAPE_FAILED') throw e;
        return [];
      }
    });

    const allDividends = await Promise.all(dividendPromises);
    const flattened = allDividends.flat();
    console.log(`Total dividends found across all tickers: ${flattened.length}`);

    return Response.json(flattened);
  } catch (error: any) {
    console.error('API Error:', error.message);
    
    // Strict requirement: Japanese fund scraping failures throw 502 to preserve cache
    if (error.message === 'JAPAN_SCRAPE_FAILED') {
      return new Response(JSON.stringify({ 
        error: 'Japan fund scrape failed, preventing cache manipulation.',
        code: 'JAPAN_SCRAPE_FAILED'
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ 
      error: error.message || 'Internal Server Error',
      code: 'INTERNAL_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function fetchYahooDividends(ticker: string) {
  const start = Math.floor(Date.now() / 1000) - (60 * 60 * 24 * 365 * 2); // 2 years
  const end = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?symbol=${ticker}&period1=${start}&period2=${end}&interval=1mo&events=div`;
  
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yahoo API error (${res.status}): ${text.substring(0, 100)}`);
  }

  const json = await res.json();
  
  const dividends = json.chart?.result?.[0]?.events?.dividends || {};
  const currency = json.chart?.result?.[0]?.meta?.currency || 'USD';

  return Object.values(dividends).map((d: any) => ({
    ticker,
    amount: d.amount,
    date: new Date(d.date * 1000).toISOString().split('T')[0],
    currency
  }));
}

async function fetchJapanDividends(ticker: string) {
  try {
    const url = `https://finance.yahoo.co.jp/quote/${ticker}/history?timeframe=m`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    const html = await res.text();
    const match = html.match(/window\.__PRELOADED_STATE__\s*=\s*(.*?});/);
    
    const dividends: any[] = [];

    if (match) {
      try {
        const state = JSON.parse(match[1]);
        const historyData = state?.history?.indicators?.dividend || state?.quote?.history?.dividend || [];
        // Optional: Parse from state if needed. Currently relying on regex fallback.
      } catch (e) {
        console.warn(`Failed to parse PRELOADED_STATE for ${ticker}`);
      }
    }
    
    const dividendMatches = [...html.matchAll(/<tr[^>]*>.*?<td[^>]*>(\d{4}년\d{1,2}월\d{1,2}일|\d{4}\/\d{1,2}\/\d{1,2})<\/td>.*?<td[^>]*>([\d,.]+)<\/td>/g)];
    
    if (dividendMatches.length > 0) {
      dividendMatches.forEach(m => {
        let dateStr = m[1].replace(/년|월/g, '-').replace(/일/g, '').replace(/\//g, '-');
        const amount = parseFloat(m[2].replace(/,/g, ''));
        if (!isNaN(amount)) {
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            dividends.push({ ticker, amount, date: date.toISOString().split('T')[0], currency: 'JPY' });
          }
        }
      });
    }

    if (dividends.length === 0) {
       throw new Error('Could not extract data');
    }

    return dividends;
  } catch (error) {
    console.error(`Scraping failed for ${ticker}:`, error);
    throw new Error('JAPAN_SCRAPE_FAILED');
  }
}
