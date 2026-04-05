export async function GET(request: Request) {
  try {
    const urlParams = new URLSearchParams(request.url.split('?')[1]);
    const ticker = urlParams.get('ticker');
    const start = urlParams.get('period1'); // timestamp
    const end = urlParams.get('period2');   // timestamp

    if (!ticker || !start || !end) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400 });
    }

    const apiUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?symbol=${ticker}&period1=${start}&period2=${end}&interval=1d`;
    console.log(`Fetching historical for ${ticker}: ${apiUrl}`);
    
    const res = await fetch(apiUrl);
    const json = await res.json();
    
    const result = json.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const adjClose = result?.indicators?.adjclose?.[0]?.adjclose || [];
    
    const historicalData: Record<string, number> = {};
    timestamps.forEach((t: number, i: number) => {
      const date = new Date(t * 1000).toISOString().split('T')[0];
      historicalData[date] = adjClose[i];
    });

    return Response.json(historicalData);
  } catch (error: any) {
    console.error('Historical Prices Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
