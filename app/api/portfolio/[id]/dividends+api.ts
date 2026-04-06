import { supabaseAdmin } from '@/src/lib/supabase-admin';

export async function GET(request: Request, { id }: { id: string }) {
  try {
    if (!supabaseAdmin) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Admin operations are unavailable.');
    }

    // 1. holdings 조회 (quantity, name, currency, country 포함)
    const { data: holdings, error: hError } = await supabaseAdmin
      .from('holdings')
      .select('ticker, name, quantity, currency, country, portfolio_id')
      .eq('portfolio_id', id);

    if (hError) {
      console.error('Supabase Error:', hError);
      throw new Error(`Database error: ${hError.message}`);
    }
    
    console.log(`Holdings for ${id}:`, holdings?.length || 0, 'items found.');
    
    if (!holdings || holdings.length === 0) {
      return Response.json([]);
    }

    // Normalize tickers
    const rawTickers: string[] = Array.from(new Set(holdings.map((h: any) => h.ticker as string)));
    console.log('Raw tickers from DB:', rawTickers);
    
    const tickers: string[] = rawTickers.map((t: string) => {
      // Korean stocks: 6 digits -> .KS
      if (/^[0-9]{6}$/.test(t)) return `${t}.KS`;
      // Japanese stocks: 4 digits -> .T
      if (/^[0-9]{4}$/.test(t)) return `${t}.T`;
      // Japanese funds: 8 alphanumeric -> as-is
      return t;
    });

    console.log('Normalized tickers for Yahoo:', tickers);
    
    // 2. 종목별 배당 fetch (Promise.allSettled — 하나 실패해도 계속)
    const dividendPromises = tickers.map(async (ticker: string, idx: number) => {
      const rawTicker = rawTickers[idx];
      const holding = holdings.find((h: any) => {
        let normalized = h.ticker;
        if (/^[0-9]{6}$/.test(normalized)) normalized = `${normalized}.KS`;
        if (/^[0-9]{4}$/.test(normalized)) normalized = `${normalized}.T`;
        return normalized === ticker;
      });
      
      const isJpFund = holding?.country === 'JP' && (/^[0-9A-Z]{8}$/.test(rawTicker) || rawTicker === '9I312249');
      const quantity = holding?.quantity || 0;
      const effectiveQty = isJpFund ? quantity / 10000 : quantity;

      let dividends: any[] = [];
      let fetchedCurrency = holding?.currency || 'USD';

      try {
        if (isJpFund) {
          // 일본 펀드 → Yahoo Japan scrape
          const divRes = await fetch(`https://finance.yahoo.co.jp/quote/${rawTicker}/dividendinfo`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          });
          if (!divRes.ok) throw new Error(`HTTP ${divRes.status}`);
          const html = await divRes.text();
          
          // PRELOADED_STATE 파싱
          const stateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*(.*?});/);
          if (stateMatch) {
            try {
              const state = JSON.parse(stateMatch[1]);
              const histories = state?.mainFundDividendInfo?.histories;
              if (histories && histories.length > 0) {
                dividends = histories.map((h: any) => {
                  const dateStr = h.date.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
                  const d = new Date(dateStr);
                  return {
                    date: !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : dateStr,
                    amount: parseFloat(h.price),
                  };
                });
              }
            } catch {}
          }
          // HTML 테이블 폴백
          if (dividends.length === 0) {
            const rows = html.split('<tr');
            for (const row of rows) {
              const dateMatch = row.match(/class="date[^>]*>([^<]+)</);
              const priceMatch = row.match(/class="number[^>]*>([\d,.]+)</);
              if (dateMatch && priceMatch) {
                const ds = dateMatch[1].trim().replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
                const d = new Date(ds);
                const amt = parseFloat(priceMatch[1].replace(/,/g, ''));
                if (!isNaN(d.getTime()) && !isNaN(amt)) {
                  dividends.push({ date: d.toISOString().split('T')[0], amount: amt });
                }
              }
            }
          }
          fetchedCurrency = 'JPY';
        } else {
          // US/KR → Yahoo Finance API
          const start = Math.floor(Date.now() / 1000) - (60 * 60 * 24 * 365 * 2);
          const end = Math.floor(Date.now() / 1000);
          const apiRes = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5y&events=div`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } }
          );
          if (apiRes.ok) {
            const json = await apiRes.json();
            const result = json?.chart?.result?.[0];
            if (result?.events?.dividends) {
              const divs = Object.entries(result.events.dividends).map(([ts, div]: [string, any]) => ({
                date: new Date(parseInt(ts) * 1000).toISOString().split('T')[0],
                amount: div.amount,
              }));
              // 이미 날짜 기준 정렬됨 (과거→최신), 최신순으로 뒤집기
              divs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
              dividends = divs;
              fetchedCurrency = result.meta?.currency || holding?.currency || 'USD';
            }
          }
        }
      } catch (e: any) {
        console.error(`Error fetching dividends for ${ticker}:`, e.message);
        // 실패해도 다른 종목은 계속
      }

      if (dividends.length === 0) return null;

      return {
        ticker: rawTicker,
        name: holding?.name || rawTicker,
        quantity: effectiveQty,
        dividends: dividends.map((d: any) => ({
          date: d.date,
          amount: d.amount,
          totalForHolding: d.amount * effectiveQty,
          currency: fetchedCurrency,
        })),
        totalDividends: dividends.reduce((s, d) => s + d.amount, 0),
        totalValueForHolding: dividends.reduce((s, d) => s + d.amount * effectiveQty, 0),
        currency: fetchedCurrency,
        country: holding?.country || (rawTicker.endsWith('.KS') ? 'KR' : rawTicker.endsWith('.T') ? 'JP' : 'US'),
      };
    });

    const results = await Promise.allSettled(dividendPromises);
    const final = results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => (r as PromiseFulfilledResult<any>).value);

    console.log(`Total stocks with dividends: ${final.length}`);
    return Response.json(final);
  } catch (error: any) {
    console.error('API Error:', error.message);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
