export async function POST(request: Request) {
  try {
    const { tickers = [] } = await request.json();

    // Supabase Admin import
    const { supabaseAdmin } = await import('@/src/lib/supabase-admin');
    
    // 일본 펀드 캐시 미리 가져오기
    let jpFunds: any[] = [];
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin.from('japan_funds').select('*');
        jpFunds = data || [];
      } catch (e) {
        console.error('[RefreshPrices] JP cache fetch failed:', e);
      }
    }

    // 일본 펀드 필터링
    const isJpFund = (t: string) => /^[0-9A-Z]{8}$/.test(t) || t === '9I312249';
    const jpTickers = tickers.filter(isJpFund);
    const otherTickers = tickers.filter(t => !isJpFund(t) && !t.startsWith('CASH_'));

    // 일본 펀드는 캐시에서, 나머지는 Yahoo API에서
    const priceMap: Record<string, number> = {};

    for (const t of jpTickers) {
      const cached = jpFunds.find((f: any) => f.fcode === t);
      if (cached?.price_data) {
        priceMap[t] = cached.price_data.price;
      }
    }

    const exchangeTickers = [...new Set([...otherTickers, 'USDKRW=X', 'JPYKRW=X'])];
    if (exchangeTickers.length > (otherTickers.length > 0 ? 1 : 0)) {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${exchangeTickers.join(',')}`;
      const res = await fetch(url);
      const json = await res.json();
      const results = json.quoteResponse?.result || [];
      results.forEach((q: any) => {
        priceMap[q.symbol] = q.regularMarketPrice;
      });
    }

    const exchangeRates = {
      usdkrw: priceMap['USDKRW=X'] || 1400,
      jpykrw: (priceMap['JPYKRW=X'] || 9.5) * 100,
    };

    return Response.json({
      prices: priceMap,
      exchangeRates
    });
  } catch (error: any) {
    console.error('Refresh Prices Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
