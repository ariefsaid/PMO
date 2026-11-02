import { formatExactCents, parseExactCents } from '../exactDecimal.ts';

export interface FiscalYearSpan {
  name: string;
  start: string;
  end: string;
}

export interface YearAmount {
  year: string;
  amount: string;
}

export type DistributionError = {
  year?: string;
  code: 'invalid' | 'negative' | 'missing' | 'out-of-range' | 'sum-mismatch';
};

export type DistributionResult =
  | { ok: true; rows: YearAmount[] }
  | { ok: false; errors: DistributionError[] };

const DAY_MS = 86_400_000;
const PERCENT_SCALE = 10_000n;
const FULL_PERCENT = 100n * PERCENT_SCALE;

type DatedFiscalYear = {
  span: FiscalYearSpan;
  startDay: number;
  endDay: number;
};

/** Parse an ISO civil date without using the machine's local timezone. */
function day(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Invalid civil date: ${iso}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || date < 1 || date > 31) {
    throw new Error(`Invalid civil date: ${iso}`);
  }

  const timestamp = Date.UTC(year, month - 1, date);
  const parsed = new Date(timestamp);
  // Date.UTC treats 0–99 as 1900–1999; restore the literal four-digit year.
  if (year < 100) parsed.setUTCFullYear(year);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== date
  ) {
    throw new Error(`Invalid civil date: ${iso}`);
  }
  return parsed.getTime() / DAY_MS;
}

function validateCalendar(calendar: readonly FiscalYearSpan[]): DatedFiscalYear[] {
  const names = new Set<string>();
  return calendar.map((span) => {
    if (!span.name.trim() || names.has(span.name)) {
      throw new Error('Fiscal years must have unique, non-empty names');
    }
    names.add(span.name);
    const startDay = day(span.start);
    const endDay = day(span.end);
    if (startDay > endDay) throw new Error(`Invalid fiscal year span: ${span.name}`);
    return { span, startDay, endDay };
  });
}

function orderedYears(years: readonly FiscalYearSpan[]): DatedFiscalYear[] {
  const sorted = validateCalendar(years).sort(
    (a, b) => a.startDay - b.startDay || a.endDay - b.endDay,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.startDay <= previous.endDay) {
      throw new Error(`Overlapping fiscal years: ${previous.span.name}, ${current.span.name}`);
    }
    if (current.startDay !== previous.endDay + 1) {
      throw new Error(`Missing fiscal-year coverage between ${previous.span.name} and ${current.span.name}`);
    }
  }
  return sorted;
}

function resultError(code: DistributionError['code'], year?: string): DistributionError {
  return year === undefined ? { code } : { year, code };
}

function parseTotal(total: string): { cents: bigint } | { error: DistributionError } {
  const cents = parseExactCents(total);
  if (cents === null) return { error: resultError('invalid') };
  if (cents < 0n) return { error: resultError('negative') };
  return { cents };
}

function rowsFor(years: readonly FiscalYearSpan[], cents: readonly bigint[]): YearAmount[] {
  return years.map((year, index) => ({ year: year.name, amount: formatExactCents(cents[index]) }));
}

function validateDistributionYears(years: readonly FiscalYearSpan[]): DistributionError[] {
  try {
    const ordered = orderedYears(years);
    if (years.length === 0) return [resultError('out-of-range')];
    if (ordered.some((year, index) => year.span.name !== years[index].name)) {
      return [resultError('out-of-range')];
    }
    return [];
  } catch {
    return [resultError('out-of-range')];
  }
}

/** Largest-remainder allocation. Ties go to the lower index; zero weights remain zero. */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n) throw new Error('allocate: total must be non-negative');
  if (weights.length === 0) throw new Error('allocate: weights are required');
  if (weights.some((weight) => weight < 0n)) throw new Error('allocate: weights must be non-negative');

  const sum = weights.reduce((accumulator, weight) => accumulator + weight, 0n);
  if (sum === 0n) throw new Error('allocate: weights sum to zero');

  const out = weights.map((weight) => (total * weight) / sum);
  const remainders = weights.map((weight) => (total * weight) % sum);
  let left = Number(total - out.reduce((accumulator, value) => accumulator + value, 0n));
  const order = weights
    .map((_, index) => index)
    .filter((index) => weights[index] > 0n)
    .sort((a, b) => (remainders[a] === remainders[b] ? a - b : remainders[a] > remainders[b] ? -1 : 1));

  for (let index = 0; left > 0; index += 1, left -= 1) out[order[index]] += 1n;
  return out;
}

/** Return every fiscal year intersecting the inclusive project span in date order. */
export function yearsInSpan(
  start: string,
  end: string | null,
  calendar: readonly FiscalYearSpan[],
): FiscalYearSpan[] {
  const startDay = day(start);
  const sorted = validateCalendar(calendar).sort(
    (a, b) => a.startDay - b.startDay || a.endDay - b.endDay,
  );

  if (end === null) {
    const containing = sorted.filter((year) => year.startDay <= startDay && startDay <= year.endDay);
    if (containing.length !== 1) throw new Error('Project start must belong to exactly one fiscal year');
    return [containing[0].span];
  }

  const endDay = day(end);
  if (endDay < startDay) throw new Error('Project end precedes project start');

  const selected = sorted.filter((year) => year.startDay <= endDay && year.endDay >= startDay);
  if (selected.length === 0 || selected[0].startDay > startDay || selected.at(-1)!.endDay < endDay) {
    throw new Error('Fiscal-year calendar does not cover the project span');
  }

  for (let index = 1; index < selected.length; index += 1) {
    const previous = selected[index - 1];
    const current = selected[index];
    if (current.startDay <= previous.endDay) {
      throw new Error(`Overlapping fiscal years: ${previous.span.name}, ${current.span.name}`);
    }
    if (current.startDay !== previous.endDay + 1) {
      throw new Error(`Missing fiscal-year coverage between ${previous.span.name} and ${current.span.name}`);
    }
  }

  const names = new Set<string>();
  for (const year of selected) {
    if (names.has(year.span.name)) throw new Error(`Duplicate fiscal year name: ${year.span.name}`);
    names.add(year.span.name);
  }
  return selected.map((year) => year.span);
}

/** Allocate a total by the inclusive civil days in each fiscal year. */
export function byDays(
  total: string,
  start: string,
  end: string | null,
  years: readonly FiscalYearSpan[],
): YearAmount[] {
  const parsedTotal = parseExactCents(total);
  if (parsedTotal === null || parsedTotal < 0n) throw new Error('byDays: invalid total');

  const expected = yearsInSpan(start, end, years);
  const expectedEnd = end ?? expected[0].end;
  const startDay = day(start);
  const endDay = day(expectedEnd);
  const weights = expected.map((year) => {
    const overlapStart = Math.max(day(year.start), startDay);
    const overlapEnd = Math.min(day(year.end), endDay);
    return BigInt(Math.max(0, overlapEnd - overlapStart + 1));
  });
  return rowsFor(expected, allocate(parsedTotal, weights));
}

function parsePercent(value: string, year: string): { units: bigint } | { error: DistributionError } {
  if (value.trim() === '') return { error: resultError('missing', year) };
  if (/^-[\d.]+$/.test(value)) return { error: resultError('negative', year) };
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) return { error: resultError('invalid', year) };

  const units = BigInt(match[1]) * PERCENT_SCALE + BigInt((match[2] ?? '').padEnd(4, '0'));
  if (units > FULL_PERCENT) return { error: resultError('out-of-range', year) };
  return { units };
}

/** Distribute by exact percentages with up to four decimal places of percentage precision. */
export function fromPercents(
  total: string,
  inputs: readonly string[],
  years: readonly FiscalYearSpan[],
): DistributionResult {
  const totalResult = parseTotal(total);
  if ('error' in totalResult) return { ok: false, errors: [totalResult.error] };
  const yearErrors = validateDistributionYears(years);
  if (yearErrors.length > 0) return { ok: false, errors: yearErrors };
  if (inputs.length !== years.length) return { ok: false, errors: [resultError('out-of-range')] };

  const parsed = inputs.map((input, index) => parsePercent(input, years[index].name));
  const errors = parsed.flatMap((value) => ('error' in value ? [value.error] : []));
  if (errors.length > 0) return { ok: false, errors };

  const weights = parsed.map((value) => ('units' in value ? value.units : 0n));
  if (weights.reduce((sum, value) => sum + value, 0n) !== FULL_PERCENT) {
    return { ok: false, errors: [resultError('sum-mismatch')] };
  }
  return { ok: true, rows: rowsFor(years, allocate(totalResult.cents, weights)) };
}

/** Allocate explicit yearly amounts, or use them as weights when proportional is true. */
export function fromAmounts(
  total: string,
  inputs: readonly string[],
  years: readonly FiscalYearSpan[],
  options: { proportional?: boolean } = {},
): DistributionResult {
  const totalResult = parseTotal(total);
  if ('error' in totalResult) return { ok: false, errors: [totalResult.error] };
  const yearErrors = validateDistributionYears(years);
  if (yearErrors.length > 0) return { ok: false, errors: yearErrors };
  if (inputs.length !== years.length) return { ok: false, errors: [resultError('out-of-range')] };

  const parsed: ({ ok: true; cents: bigint } | { ok: false; error: DistributionError })[] = inputs.map(
    (input, index) => {
      const year = years[index]?.name;
      if (year === undefined || input === undefined) {
        return { ok: false, error: resultError('out-of-range') };
      }
      if (input.trim() === '') return { ok: false, error: resultError('missing', year) };
      const cents = parseExactCents(input);
      if (cents === null) return { ok: false, error: resultError('invalid', year) };
      if (cents < 0n) return { ok: false, error: resultError('negative', year) };
      return { ok: true, cents };
    },
  );
  const errors = parsed.flatMap((value) => (value.ok ? [] : [value.error]));
  if (errors.length > 0) return { ok: false, errors };

  const amounts = parsed.map((value) => (value.ok ? value.cents : 0n));
  const sum = amounts.reduce((accumulator, amount) => accumulator + amount, 0n);
  if (options.proportional) {
    if (sum === 0n) return { ok: false, errors: [resultError('sum-mismatch')] };
    return { ok: true, rows: rowsFor(years, allocate(totalResult.cents, amounts)) };
  }
  if (sum !== totalResult.cents) return { ok: false, errors: [resultError('sum-mismatch')] };
  return { ok: true, rows: rowsFor(years, amounts) };
}
