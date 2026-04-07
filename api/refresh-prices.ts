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

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let tickers: string[] = [];
  try {
    const body = await request.json();
    tickers = body.tickers || [];
  } catch { /* empty body */ }

  // 일본 펀드 캐시
  let jpFunds: any[] = [];
  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin.from('japan_funds').select('*');
      jpFunds = data || [];
    } catch (e) {
      console.error('[RefreshPrices] JP cache fetch failed:', e);
    }
  }

  const isJpFund = (t: string) => /^[0-9A-Z]{8}$/.test(t) || t === '9I312249';
  const jpTickers = tickers.filter(isJpFund);
  const otherTickers = tickers.filter(t => !isJpFund(t) && !t.startsWith('CASH_'));

  const priceMap: Record<string, number> = {};

  for (const t of jpTickers) {
    const cached = jpFunds.find((f: any) => f.fcode === t);
    if (cached?.price_data) {
      priceMap[t] = cached.price_data.price;
    }
  }

  if (otherTickers.length > 0) {
    const exchangeTickers = [...new Set([...otherTickers, 'USDKRW=X', 'JPYKRW=X'])];
    const url = `${VERCEL_API}/quote?symbols=${exchangeTickers.join(',')}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json) {
      for (const [sym, val] of Object.entries(json)) {
        const v = val as any;
        if (v.price) priceMap[sym] = v.price;
      }
    }
  }

  return Response.json({
    prices: priceMap,
    exchangeRates: {
      usdkrw: priceMap['USDKRW=X'] || 1400,
      jpykrw: priceMap['JPYKRW=X'] || 9.5,
    },
  });
}
