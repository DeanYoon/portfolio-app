/** 숫자 포맷팅 유틸 */

export function formatCurrency(value: number, currency: string = 'KRW'): string {
  if (currency === 'KRW') return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  if (currency === 'USD') return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (currency === 'JPY') return `¥${value.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
  return `${currency} ${value.toLocaleString()}`;
}

export function formatRate(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatPrice(value: number, digits: number = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function getFlag(country: string): string {
  switch (country) {
    case 'KR': return '🇰🇷';
    case 'JP': return '🇯🇵';
    case 'US': return '🇺🇸';
    default: return '🏳️';
  }
}

export function getCountry(ticker: string): string {
  if (ticker.endsWith('.KS') || ticker.endsWith('.KQ')) return 'KR';
  if (ticker.endsWith('.T')) return 'JP';
  // 일본 펀드 (8자리 알파벳+숫자 코드)
  if (/^[0-9A-Z]{8}$/.test(ticker) || ticker === '9I312249') return 'JP';
  // 현금은 기본 US
  if (ticker.startsWith('CASH_')) return 'US';
  return 'US';
}

export function getCurrency(country: string): string {
  switch (country) {
    case 'KR': return 'KRW';
    case 'JP': return 'JPY';
    default: return 'USD';
  }
}
