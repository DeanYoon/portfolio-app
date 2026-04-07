export const runtime = 'edge';

const VERCEL_API = process.env.EXPO_PUBLIC_YAHOO_API || 'https://yahoo-finance-api-seven.vercel.app';

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');

  if (!ticker) {
    return Response.json({ error: 'Missing ticker parameter' }, { status: 400 });
  }

  const apiUrl = `${VERCEL_API}/history?symbols=${ticker}&period=1y`;
  console.log(`Fetching historical for ${ticker}: ${apiUrl}`);

  const res = await fetch(apiUrl);
  const json = await res.json();

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
}
