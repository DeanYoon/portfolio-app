export async function POST(request: Request) {
  try {
    const { tickers = [] } = await request.json();
    const allSymbols = [...new Set([...tickers, 'USDKRW=X', 'JPYKRW=X', 'KRW=X'])];
    
    // Yahoo Finance Multi-Quote API
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${allSymbols.join(',')}`;
    const res = await fetch(url);
    const json = await res.json();
    
    const results = json.quoteResponse?.result || [];
    const priceMap: Record<string, number> = {};
    
    results.forEach((q: any) => {
      priceMap[q.symbol] = q.regularMarketPrice;
    });

    const exchangeRates = {
      usdkrw: priceMap['USDKRW=X'] || 1400,
      jpykrw: (priceMap['JPYKRW=X'] || 9.5) * 100, // typically JPY:KRW is around 9~10
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
