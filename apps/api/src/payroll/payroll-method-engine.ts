export type PayrollTaxMethod = 'GROSS' | 'GROSS_UP' | 'NET';

export type EffectiveRange = {
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type DateProration = {
  factor: number;
  activeDays: number;
  periodDays: number;
  activeFrom: Date;
  activeTo: Date;
};

export type PayrollTaxMethodResult = {
  method: PayrollTaxMethod;
  taxPayable: number;
  employeeTaxDeduction: number;
  employerBorneTax: number;
  grossAdjustment: number;
  taxableAdjustment: number;
  netAfterTax: number;
  grossEquivalentAdjustment: number;
  iterations: number;
};

const DAY_MS = 86_400_000;

export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function utcDayStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function inclusiveUtcDays(start: Date, end: Date): number {
  const from = utcDayStart(start).getTime();
  const to = utcDayStart(end).getTime();
  if (to < from) return 0;
  return Math.floor((to - from) / DAY_MS) + 1;
}

export function dateProration(periodStart: Date, periodEnd: Date, range: EffectiveRange): DateProration | null {
  const start = utcDayStart(periodStart);
  const end = utcDayStart(periodEnd);
  const effectiveStart = utcDayStart(range.effectiveFrom);
  const effectiveEnd = range.effectiveTo ? utcDayStart(range.effectiveTo) : end;
  const activeFrom = effectiveStart > start ? effectiveStart : start;
  const activeTo = effectiveEnd < end ? effectiveEnd : end;
  const periodDays = inclusiveUtcDays(start, end);
  const activeDays = inclusiveUtcDays(activeFrom, activeTo);
  if (!periodDays || !activeDays) return null;
  return { factor: activeDays / periodDays, activeDays, periodDays, activeFrom, activeTo };
}

export function solveGrossUp(taxableIncome: number, taxCalculator: (taxableIncome: number) => number): { allowance: number; tax: number; iterations: number } {
  if (taxableIncome <= 0) return { allowance: 0, tax: 0, iterations: 0 };
  let allowance = money(Math.max(0, taxCalculator(taxableIncome)));
  for (let iteration = 1; iteration <= 100; iteration += 1) {
    const tax = money(Math.max(0, taxCalculator(taxableIncome + allowance)));
    if (Math.abs(tax - allowance) < 0.005) return { allowance: tax, tax, iterations: iteration };
    allowance = tax;
  }
  throw new Error('gross-up-does-not-converge');
}

export function applyPayrollTaxMethod(input: {
  method: string;
  taxableIncome: number;
  netBeforeTax: number;
  taxCalculator: (taxableIncome: number) => number;
}): PayrollTaxMethodResult {
  const method = input.method as PayrollTaxMethod;
  if (!['GROSS', 'GROSS_UP', 'NET'].includes(method)) throw new Error(`unsupported-tax-method:${input.method}`);
  const taxableIncome = Math.max(0, input.taxableIncome);
  const netBeforeTax = input.netBeforeTax;

  if (method === 'GROSS_UP') {
    const solved = solveGrossUp(taxableIncome, input.taxCalculator);
    return {
      method,
      taxPayable: solved.tax,
      employeeTaxDeduction: solved.tax,
      employerBorneTax: 0,
      grossAdjustment: solved.allowance,
      taxableAdjustment: solved.allowance,
      netAfterTax: money(netBeforeTax + solved.allowance - solved.tax),
      grossEquivalentAdjustment: solved.allowance,
      iterations: solved.iterations,
    };
  }

  const tax = money(Math.max(0, input.taxCalculator(taxableIncome)));
  if (method === 'NET') {
    return {
      method,
      taxPayable: tax,
      employeeTaxDeduction: 0,
      employerBorneTax: tax,
      grossAdjustment: 0,
      taxableAdjustment: 0,
      netAfterTax: money(netBeforeTax),
      grossEquivalentAdjustment: tax,
      iterations: 1,
    };
  }

  return {
    method,
    taxPayable: tax,
    employeeTaxDeduction: tax,
    employerBorneTax: 0,
    grossAdjustment: 0,
    taxableAdjustment: 0,
    netAfterTax: money(netBeforeTax - tax),
    grossEquivalentAdjustment: 0,
    iterations: 1,
  };
}
