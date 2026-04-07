import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_SECRET_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const VERCEL_API = process.env.EXPO_PUBLIC_YAHOO_API || 'https://yahoo-finance-api-seven.vercel.app';

const supabaseAdmin = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null as any;

export default async function handler(request: Request, ctx: { params: { id: string } }) {
  if (!supabaseAdmin) {
    return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is missing' }, { status: 500 });
  }

  const pid = ctx?.params?.id;
  if (!pid) {
    return Response.json({ error: 'Missing portfolio ID' }, { status: 400 });
  }

  try {
    // 1. holdings 조회
    const { data: holdings, error } = await supabaseAdmin
      .from('holdings')
      .select('ticker, name, quantity, currency, country, portfolio_id')
      .eq('portfolio_id', pid);

    if (error) return Response.json({ error: `Database error: ${error.message}` }, { status: 500 });
    if (!holdings || holdings.length === 0) return Response.json([]);

    const rawTickers = Array.from(new Set(holdings.map((h: any) => h.ticker as string)));

    const dividendPromises = rawTickers.map(async (rawTicker: string) => {
      let ticker = rawTicker;
      if (/^[0-9]{6}$/.test(ticker)) ticker = `${ticker}.KS`;
      if (/^[0-9]{4}$/.test(ticker)) ticker = `${ticker}.T`;

      const holding = holdings.find((h: any) => h.ticker === rawTicker);
      const isJpFund = holding?.country === 'JP' && (/^[0-9A-Z]{8}$/.test(rawTicker) || rawTicker === '9I312249');
      const quantity = holding?.quantity || 0;
      const effectiveQty = isJpFund ? quantity / 10000 : quantity;

      let dividends: any[] = [];
      let fetchedCurrency = holding?.currency || 'USD';

      try {
        if (isJpFund) {
          const { data } = await supabaseAdmin
            .from('japan_funds')
            .select('*')
            .eq('fcode', rawTicker)
            .single();

          if (data?.dividend_data && Array.isArray(data.dividend_data)) {
            dividends = data.dividend_data.map((d: any) => ({ date: d.date, amount: d.amount }));
          }
          fetchedCurrency = 'JPY';
        } else {
          const apiRes = await fetch(`${VERCEL_API}/dividends?symbols=${ticker}&years=5`);
          if (apiRes.ok) {
            const json = await apiRes.json();
            const tData = json?.[ticker];
            if (tData?.dividends) {
              dividends = tData.dividends
                .map((d: any) => ({ date: d.date, amount: d.amount }))
                .filter((d: any) => d.date && d.amount != null)
                .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
              fetchedCurrency = tData.currency || holding?.currency || 'USD';
            }
          }
        }
      } catch (e: any) {
        console.error(`Error fetching dividends for ${ticker}:`, e.message);
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

    return Response.json(final);
  } catch (error: any) {
    console.error('API Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
