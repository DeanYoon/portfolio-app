import { differenceInMonths, parseISO, isSameMonth } from 'date-fns';

export interface StockDividend {
  ticker: string;
  amount: number;
  date: string;
  close?: number;  // dividend API close price
  currency: string;
}

export interface DividendAnalysis {
  annualDividendPerShare: number;
  currentPrice: number;
  yieldPercent: number;
  singleYieldPercent: number;
  paymentsPerYear: number;
  isMonthly: boolean;
}

export interface TrendEstimate {
  amount: number;
  growthRate: number;
  lastYearAmount: number;
  lastYearSameMonthDividend: number;
  lastYearSameMonthPrice: number;
  lastYearSameMonthYield: number;
  calculationMethod: 'actual' | 'price_trend' | 'dividend_trend' | 'fallback_2026' | 'none';
  calculationFormula: string;
  isTrendApplied: boolean;
  isDataRecovered: boolean;
  paymentCount: number;
}

/**
 * 6.4 세금 계산
 */
export const getTaxRate = (country: string, isAfterTax: boolean) => {
  if (!isAfterTax) return 1;
  if (country === 'US') return 0.85; // 15% 원천징수
  if (country === 'JP') return 1.0;  // NISA 면세 (spec 기준)
  if (country === 'KR') return 1.0;  // 과세이연/면세 (spec 기준)
  return 0.85; // Default 15%
};

/**
 * 6.5 배당수익률 계산
 */
export const calculateDividendYield = (
  dividends: StockDividend[],
  currentPrice: number,
  ticker: string
): DividendAnalysis => {
  if (dividends.length === 0) {
    return {
      annualDividendPerShare: 0,
      currentPrice,
      yieldPercent: 0,
      singleYieldPercent: 0,
      paymentsPerYear: 0,
      isMonthly: false,
    };
  }

  // 지급 주기 자동 감지
  const sortedDivs = [...dividends].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const gaps: number[] = [];
  for (let i = 0; i < sortedDivs.length - 1; i++) {
    const d1 = parseISO(sortedDivs[i].date);
    const d2 = parseISO(sortedDivs[i+1].date);
    gaps.push(Math.abs(differenceInMonths(d1, d2)));
  }
  
  const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 12;
  const isMonthly = avgGap <= 1.5;
  
  // 최근 1회 배당액
  const latestAmount = sortedDivs[0].amount;
  
  // 지급 횟수 결정
  let paymentsPerYear = 0;
  if (isMonthly) {
    paymentsPerYear = 12;
  } else {
    // 최근 1년 빈도 체크
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    paymentsPerYear = dividends.filter(d => parseISO(d.date) >= oneYearAgo).length || 4; // 최소 분기
  }

  const annualDividendPerShare = latestAmount * paymentsPerYear;
  const yieldPercent = currentPrice > 0 ? (annualDividendPerShare / currentPrice) * 100 : 0;
  const singleYieldPercent = currentPrice > 0 ? (latestAmount / currentPrice) * 100 : 0;

  return {
    annualDividendPerShare,
    currentPrice,
    yieldPercent,
    singleYieldPercent,
    paymentsPerYear,
    isMonthly
  };
};

/**
 * 6.6 트렌드 예측 모델
 * dividends.close → API에 포함된 배당일 종가 (history API 불필요)
 */
export const calculateLatestTrendEstimate = (
  dividends: StockDividend[],
  _historicalPrices: null,  // unused — dividends.close 사용
  currentPrice: number,
  targetMonth: number,
  currentYear: number,
  ticker: string,
  _isKrwMode: boolean,
  _exchangeRate: number
): TrendEstimate => {
  const targetDate = new Date(currentYear, targetMonth, 15);
  
  // 1위: 실제 데이터 존재
  const actualMatch = dividends.find(d => {
    const dDate = parseISO(d.date);
    return isSameMonth(dDate, targetDate) && dDate.getFullYear() === currentYear;
  });

  if (actualMatch) {
    return {
      amount: actualMatch.amount,
      growthRate: 0,
      lastYearAmount: 0,
      lastYearSameMonthDividend: 0,
      lastYearSameMonthPrice: actualMatch.close || 0,
      lastYearSameMonthYield: actualMatch.close ? (actualMatch.amount / actualMatch.close) * 100 : 0,
      calculationMethod: 'actual',
      calculationFormula: '실제 지급 데이터',
      isTrendApplied: false,
      isDataRecovered: false,
      paymentCount: 1
    };
  }

  // 월배당이 아닌 경우 지급월 패턴 체크 (간단히)
  const analysis = calculateDividendYield(dividends, currentPrice, ticker);
  if (!analysis.isMonthly) {
    const historicalMonths = new Set(dividends.map(d => parseISO(d.date).getMonth()));
    if (!historicalMonths.has(targetMonth)) {
      return {
        amount: 0,
        growthRate: 0,
        lastYearAmount: 0,
        lastYearSameMonthDividend: 0,
        lastYearSameMonthPrice: 0,
        lastYearSameMonthYield: 0,
        calculationMethod: 'none',
        calculationFormula: '비지급월 (분기/연간)',
        isTrendApplied: false,
        isDataRecovered: false,
        paymentCount: 0
      };
    }
  }

  // 2위: 평균 배당수익률 기반 예측 (dividends.close 사용)
  const divsWithClose = dividends.filter(d => d.close != null && d.close > 0);
  
  if (divsWithClose.length > 0 && currentPrice > 0) {
    const yields = divsWithClose.map(d => d.amount / (d.close as number));
    const avgYield = yields.reduce((a, b) => a + b, 0) / yields.length;
    const predictedAmount = currentPrice * avgYield;

    // 작년 동월 배당 찾기
    const lastYearDiv = dividends.find(d => {
      const dDate = parseISO(d.date);
      return isSameMonth(dDate, new Date(currentYear - 1, targetMonth, 15));
    });

    return {
      amount: predictedAmount,
      growthRate: 0,
      lastYearAmount: lastYearDiv?.amount || 0,
      lastYearSameMonthDividend: lastYearDiv?.amount || 0,
      lastYearSameMonthPrice: lastYearDiv?.close || 0,
      lastYearSameMonthYield: lastYearDiv?.close ? (lastYearDiv.amount / lastYearDiv.close) * 100 : 0,
      calculationMethod: 'price_trend',
      calculationFormula: `평균 배당수익률 ${(avgYield * 100).toFixed(2)}% × $${currentPrice.toFixed(2)}`,
      isTrendApplied: true,
      isDataRecovered: false,
      paymentCount: 1
    };
  }

  // 3위: 올해 최신 실제 배당 폴백
  const thisYearDivs = dividends.filter(d => parseISO(d.date).getFullYear() === currentYear);
  if (thisYearDivs.length > 0) {
    const latest = [...thisYearDivs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    return {
      amount: latest.amount,
      growthRate: 0,
      lastYearAmount: 0,
      lastYearSameMonthDividend: 0,
      lastYearSameMonthPrice: 0,
      lastYearSameMonthYield: 0,
      calculationMethod: 'fallback_2026',
      calculationFormula: '2026년 최신 배당 데이터 폴백',
      isTrendApplied: false,
      isDataRecovered: true,
      paymentCount: 1
    };
  }

  // 4위: 작년 동월 배당 폴백
  const lastYearMatch = dividends.find(d => {
    const dDate = parseISO(d.date);
    return isSameMonth(dDate, new Date(currentYear - 1, targetMonth, 15));
  });

  if (lastYearMatch) {
    return {
      amount: lastYearMatch.amount,
      growthRate: 0,
      lastYearAmount: lastYearMatch.amount,
      lastYearSameMonthDividend: lastYearMatch.amount,
      lastYearSameMonthPrice: lastYearMatch.close || 0,
      lastYearSameMonthYield: lastYearMatch.close ? (lastYearMatch.amount / lastYearMatch.close) * 100 : 0,
      calculationMethod: 'dividend_trend',
      calculationFormula: '작년 동월 배당 데이터 폴백',
      isTrendApplied: false,
      isDataRecovered: true,
      paymentCount: 1
    };
  }

  return {
    amount: 0,
    growthRate: 0,
    lastYearAmount: 0,
    lastYearSameMonthDividend: 0,
    lastYearSameMonthPrice: 0,
    lastYearSameMonthYield: 0,
    calculationMethod: 'none',
    calculationFormula: '데이터 없음',
    isTrendApplied: false,
    isDataRecovered: false,
    paymentCount: 0
  };
};
