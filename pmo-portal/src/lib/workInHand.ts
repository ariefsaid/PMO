import { parseExactCents } from '@/src/lib/exactDecimal';

/**
 * Work in hand: Left to bill and months of backlog per contract and work order (#2575, spec work-in-hand-backlog.spec.md).
 *
 * The database (get_work_in_hand, migration 1060) returns the inputs; this file is the ONE implementation of the arithmetic.
 * Money is exact integer cents (bigint) and is rounded only for display; there is no float anywhere in this file.
 *
 *  - Left to bill  = value - billed to date, never below 0 (a row billed over value is marked, not negative).
 *  - Billing window = the last WINDOW_MONTHS complete calendar months before the as-of month (OD-WIH-2).
 *  - Months counted M = months from max(window start, first billing month) through the last complete month, gaps included;
 *    0 when billing began in the current partial month.
 *  - Current billing rate = billed inside the window / M; undefined when M = 0 or the sum is 0 (OD-WIH-3).
 *  - Months of backlog = Left to bill / rate, half up to one decimal; 0.0 when Left to bill is 0.
 */
export const WINDOW_MONTHS = 6;
/** 60 is divisible by every M in 1..6, so a sum of per-row rates stays exact over a common denominator. */
const RATE_DENOMINATOR = 60n;

export type WipOrder = 'leftToBill' | 'backlog';

export interface WipWindowMonth { month: string; billed: string }

/** One contract or Issued work order as the database returns it (money as scale-two text). */
export interface WipInputRow {
  kind: 'contract' | 'workOrder';
  id: string;
  /** For a work order, the id of its contract (project); null for a contract. */
  parentId: string | null;
  name: string;
  /** Contract code / project number, or the work-order number. */
  code: string | null;
  status: string;
  currency: string;
  /** Net value excluding tax; null or not above 0 means no value. */
  value: string | null;
  incomplete: boolean;
  foreignCurrencyInvoiceCount: number;
  unpricedInvoiceCount: number;
  billedToDate: string | null;
  /** First of the month, ISO date; null when nothing counted was ever billed. */
  firstBillingMonth: string | null;
  /** The window's billed work per calendar month (first of month, ISO date). Months with no billing are absent. */
  windowMonths: WipWindowMonth[];
}

export type WipRate =
  | { state: 'rate'; perMonthCents: bigint; monthsCounted: number; windowSumCents: bigint }
  | { state: 'none'; cause: 'nothing-billed' | 'began-this-month' };

export interface WipMonthCents { month: string; billedCents: bigint }

export interface WipRow extends WipInputRow {
  state: 'figures' | 'incomplete' | 'no-value';
  valueCents: bigint | null;
  billedCents: bigint | null;
  /** Never negative. */
  leftToBillCents: bigint | null;
  overBilled: boolean;
  rate: WipRate | null;
  /** Months of backlog in tenths (86n = 8.6 months); null when there is no rate. */
  backlogTenths: bigint | null;
  /** All WINDOW_MONTHS months of the window, oldest first, zeros included ('YYYY-MM'). */
  months: WipMonthCents[];
}

function cents(text: string | null, field: string): bigint {
  const v = text === null ? null : parseExactCents(text);
  if (v === null) throw new Error(`Work in hand: ${field} is missing or not an exact amount`);
  return v;
}

function monthIndex(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})/.exec(isoDate);
  if (!match) throw new Error(`Work in hand: ${isoDate} is not a date`);
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}
function monthKey(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Half-up integer division for non-negative operands. */
function divHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (2n * d);
}

export function formatBacklogTenths(tenths: bigint): string {
  return `${tenths / 10n}.${tenths % 10n}`;
}

function deriveOne(row: WipInputRow, asOf: string): WipRow {
  const asOfIndex = monthIndex(asOf);
  const windowStart = asOfIndex - WINDOW_MONTHS;
  const lastComplete = asOfIndex - 1;
  const empty = { valueCents: null, billedCents: null, leftToBillCents: null, overBilled: false, rate: null, backlogTenths: null, months: [] as WipMonthCents[] };

  if (row.incomplete) return { ...row, ...empty, state: 'incomplete' };
  const valueCents = row.value === null ? null : cents(row.value, 'value');
  if (valueCents === null || valueCents <= 0n) return { ...row, ...empty, state: 'no-value' };

  const billedCents = cents(row.billedToDate, 'billed to date');
  const byMonth = new Map<number, bigint>();
  for (const m of row.windowMonths) {
    const idx = monthIndex(m.month);
    if (idx < windowStart || idx > lastComplete) continue;
    byMonth.set(idx, (byMonth.get(idx) ?? 0n) + cents(m.billed, 'window month'));
  }
  const months: WipMonthCents[] = [];
  let windowSum = 0n;
  for (let i = windowStart; i <= lastComplete; i += 1) {
    const billed = byMonth.get(i) ?? 0n;
    windowSum += billed;
    months.push({ month: monthKey(i), billedCents: billed });
  }

  const overBilled = billedCents > valueCents;
  const leftToBillCents = overBilled ? 0n : valueCents - billedCents;

  let rate: WipRate;
  const firstIndex = row.firstBillingMonth === null ? null : monthIndex(row.firstBillingMonth);
  if (firstIndex === null) {
    rate = { state: 'none', cause: 'nothing-billed' };
  } else if (firstIndex > lastComplete) {
    rate = { state: 'none', cause: 'began-this-month' };
  } else {
    const monthsCounted = lastComplete - Math.max(windowStart, firstIndex) + 1;
    rate = windowSum > 0n
      ? { state: 'rate', perMonthCents: divHalfUp(windowSum, BigInt(monthsCounted)), monthsCounted, windowSumCents: windowSum }
      : { state: 'none', cause: 'nothing-billed' };
  }

  let backlogTenths: bigint | null = null;
  if (leftToBillCents === 0n) backlogTenths = 0n;
  else if (rate.state === 'rate') backlogTenths = divHalfUp(leftToBillCents * BigInt(rate.monthsCounted) * 10n, rate.windowSumCents);

  return { ...row, state: 'figures', valueCents, billedCents, leftToBillCents, overBilled, rate, backlogTenths, months };
}

/** Derive Left to bill, the billing rate and months of backlog for every row. `asOf` is the organisation's calendar date. */
export function deriveWorkInHand(rows: WipInputRow[], asOf: string): WipRow[] {
  return rows.map((row) => deriveOne(row, asOf));
}

export interface WipTotals {
  rowCount: number;
  leftToBillCents: bigint;
  /** Left to bill of the rows that have a rate (the numerator of the total backlog). */
  ratedLeftToBillCents: bigint;
  ratePerMonthCents: bigint;
  backlogTenths: bigint | null;
  /** Ranked rows with Left to bill above 0 and no rate: they are in the Left to bill total but not in the backlog total. */
  leftOutCount: number;
}
export interface WipContractGroup { contract: WipRow; workOrders: WipRow[] }
export interface WipCurrencyGroup {
  currency: string;
  contracts: WipContractGroup[];
  /** Work orders whose contract is not ranked here (no value, incomplete, another currency). Ranked the same way. */
  unparentedWorkOrders: WipRow[];
  totals: WipTotals;
  workOrderTotals: WipTotals;
}

/** Tenths of work months from the organisation-currency backlog and monthly capacity, or null until capacity is set. */
export function monthsOfWorkAvailable(groups: WipCurrencyGroup[], orgCurrency: string, capacityCents: bigint | null): bigint | null {
  if (capacityCents === null || capacityCents <= 0n) return null;
  const backlog = groups.find((group) => group.currency === orgCurrency)?.totals.leftToBillCents ?? 0n;
  return divHalfUp(backlog * 10n, capacityCents);
}

export interface WorkInHandCurrencyAmount {
  currency: string;
  leftToBillCents: bigint;
}

export interface WorkInHandSummary {
  orgCurrency: string;
  orgLeftToBillCents: bigint;
  otherCurrencies: WorkInHandCurrencyAmount[];
  capacityCents: bigint | null;
  monthsTenths: bigint | null;
}

/**
 * M8 summary: value of work in hand in the organisation's currency, other currencies separately (never converted or
 * included in months), and months of work in hand = org-currency work in hand ÷ monthly capacity.
 */
export function workInHandSummary(rows: WipRow[], orgCurrency: string, monthlyCapacity: string | null | undefined): WorkInHandSummary {
  const groups = rankWorkInHand(rows, 'leftToBill', orgCurrency);
  const parsedCapacity = monthlyCapacity === null || monthlyCapacity === undefined ? null : parseExactCents(monthlyCapacity);
  const capacityCents = parsedCapacity !== null && parsedCapacity > 0n ? parsedCapacity : null;
  const orgGroup = groups.find((group) => group.currency === orgCurrency);
  const otherCurrencies = groups
    .filter((group) => group.currency !== orgCurrency)
    .map((group) => ({ currency: group.currency, leftToBillCents: group.totals.leftToBillCents }));
  return {
    orgCurrency,
    orgLeftToBillCents: orgGroup?.totals.leftToBillCents ?? 0n,
    otherCurrencies,
    capacityCents,
    monthsTenths: monthsOfWorkAvailable(groups, orgCurrency, capacityCents),
  };
}

const cmp = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/** 0 = open work with a rate, 1 = nothing left to bill, 2 = no billing rate. */
function tier(row: WipRow): number {
  if (row.leftToBillCents === 0n) return 1;
  return row.rate?.state === 'rate' ? 0 : 2;
}

function comparator(order: WipOrder) {
  return (a: WipRow, b: WipRow): number => {
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    const left = cmp(b.leftToBillCents ?? 0n, a.leftToBillCents ?? 0n);
    const backlog = cmp(b.backlogTenths ?? -1n, a.backlogTenths ?? -1n);
    const first = order === 'leftToBill' ? left : backlog;
    const second = order === 'leftToBill' ? backlog : left;
    return first || second || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  };
}

function totalsOf(rows: WipRow[]): WipTotals {
  let leftToBillCents = 0n;
  let ratedLeft = 0n;
  let rateScaled = 0n;
  let leftOutCount = 0;
  for (const r of rows) {
    const left = r.leftToBillCents ?? 0n;
    leftToBillCents += left;
    if (r.rate?.state === 'rate') {
      ratedLeft += left;
      rateScaled += r.rate.windowSumCents * (RATE_DENOMINATOR / BigInt(r.rate.monthsCounted));
    } else if (left > 0n) {
      leftOutCount += 1;
    }
  }
  return {
    rowCount: rows.length,
    leftToBillCents,
    ratedLeftToBillCents: ratedLeft,
    ratePerMonthCents: divHalfUp(rateScaled, RATE_DENOMINATOR),
    backlogTenths: rateScaled > 0n ? divHalfUp(ratedLeft * 10n * RATE_DENOMINATOR, rateScaled) : null,
    leftOutCount,
  };
}

/**
 * Rank per currency (never across currencies); the organisation's currency first, the rest alphabetically. Only rows with
 * figures enter a ranking or a total. Work orders sit beneath their contract and are never added to the contract totals.
 */
export function rankWorkInHand(rows: WipRow[], order: WipOrder, orgCurrency: string): WipCurrencyGroup[] {
  const sort = comparator(order);
  const ranked = rows.filter((r) => r.state === 'figures');
  const currencies = [...new Set(ranked.map((r) => r.currency))]
    .sort((a, b) => (a === orgCurrency ? -1 : b === orgCurrency ? 1 : a.localeCompare(b)));

  return currencies.map((currency) => {
    const inCurrency = ranked.filter((r) => r.currency === currency);
    const contracts = inCurrency.filter((r) => r.kind === 'contract').sort(sort);
    const workOrders = inCurrency.filter((r) => r.kind === 'workOrder');
    const contractIds = new Set(contracts.map((c) => c.id));
    return {
      currency,
      contracts: contracts.map((contract) => ({
        contract,
        workOrders: workOrders.filter((w) => w.parentId === contract.id).sort(sort),
      })),
      unparentedWorkOrders: workOrders.filter((w) => w.parentId === null || !contractIds.has(w.parentId)).sort(sort),
      totals: totalsOf(contracts),
      workOrderTotals: totalsOf(workOrders),
    };
  });
}

export interface HiddenFigures {
  noValue: number;
  noRate: number;
  incomplete: number;
  foreignCurrencyInvoices: number;
  unpricedInvoices: number;
  undatedInvoices: number;
  truncated: boolean;
}

/** The one hidden-figures line (NFR-WIH-004): everything the screen could not show, with its cause. */
export function hiddenFigures(
  rows: WipRow[],
  extra: { noValueContractCount: number; undatedInvoiceCount: number; truncated: boolean },
): HiddenFigures {
  return {
    noValue: extra.noValueContractCount + rows.filter((r) => r.state === 'no-value').length,
    noRate: rows.filter((r) => r.state === 'figures' && r.rate?.state === 'none' && (r.leftToBillCents ?? 0n) > 0n).length,
    incomplete: rows.filter((r) => r.state === 'incomplete').length,
    foreignCurrencyInvoices: rows.reduce((n, r) => n + (r.state === 'incomplete' ? r.foreignCurrencyInvoiceCount : 0), 0),
    unpricedInvoices: rows.reduce((n, r) => n + (r.state === 'incomplete' ? r.unpricedInvoiceCount : 0), 0),
    undatedInvoices: extra.undatedInvoiceCount,
    truncated: extra.truncated,
  };
}

