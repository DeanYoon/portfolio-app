export async function GET(request: Request) {
  try {
    const urlParams = new URLSearchParams(request.url.split('?')[1]);
    const ticker = urlParams.get('ticker');
    const start = urlParams.get('period1'); // timestamp
    const end = urlParams.get('period2');   // timestamp

    if (!ticker || !start || !end) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400 });
    }

    const vercelApi = process.env.EXPO_PUBLIC_YAHOO_API || 'https://yahoo-finance-api-seven.vercel.app';
    // yahoo-finance-api /history returns data keyed by symbol
    const url = `${vercelApi}/history?symbols=${ticker}&period=1y`;
    console.log(`Fetching historical for ${ticker}: ${url}`);
    
    const res = await fetch(url);
    const json = await res.json();
    
    // Response format: { "AAPL": { prices: [{date, open, high, low, close, volume}, ...] } }
    const tickerData = json?.[ticker];
    const historicalData: Record<string, number> = {};
    
    if (tickerData?.prices && Array.isArray(tickerData.prices)) {
      tickerData.prices.forEach((bar: any) => {
        if (bar.date && bar.close != null) {
          historicalData[bar.date] = bar.close;
        }
      });
    }

    return Response.json(historicalData);
  } catch (error: any) {
    console.error('Historical Prices Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
