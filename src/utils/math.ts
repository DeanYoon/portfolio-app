/**
 * Calculates the estimated net proceeds after tax for US stocks.
 * Korean resident tax rule for overseas stocks: 
 * (Profit - 2,500,000 KRW) * 22% tax.
 * Note: Simplification used in the dashboard (22% on entire profit) for conservative estimate.
 * 
 * @param profitKRW Total profit in KRW
 * @param currency Currency of the stock ('USD', 'KRW', 'JPY')
 */
export const calculateTax = (profitKRW: number, currency: string): number => {
  if (currency !== 'USD' || profitKRW <= 0) return 0;
  // According to the Next.js dashboard logic: taxableProfit * 0.22
  // We'll follow the same logic for parity.
  return profitKRW * 0.22;
};

/**
 * Formats a number as a currency string.
 */
export const formatPrice = (value: number, currency: string = 'KRW'): string => {
  if (currency === 'KRW') {
    return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  }
  return value.toLocaleString('en-US', { 
    maximumFractionDigits: 2,
    minimumFractionDigits: 2 
  });
};
