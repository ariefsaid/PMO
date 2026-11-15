import { addDays, addMonths, daysInclusive, monthEnd, monthsBetween } from './months';
import type { ManagementPackFacts, PackFactsProgress, PackFactsProject } from '@/src/lib/db/managementPack';

/**
 * #765 — the monthly management pack, derived from server facts (ADR-0076, DD-MMP-1..5).
 * Every figure is NET of tax, in the row's own currency, in integer cents (NFR-MMP-002).
 */
export type Cents = number;
/** 'earned' = per-line earned value (projects with contract lines, #1279); 'progress' = percent complete x net contract. */
export type RecognitionBasis = 'progress' | 'earned' | 'invoiced';
export type PackRowKind = 'contract' | 'otherCurrency' | 'unassigned';

export interface PackMonth {
  month: string;
  /** null = the project has no usable start/end dates ("No schedule"), or the row has no contract. */
  planned: Cents | null;
  recognised: Cents;
  invoiced: Cents;
  /** Number of dated invoices issued in this month. */
  invoiceCount: number;
  recognisedToDate: Cents;
  invoicedToDate: Cents;
  /** Dated invoice count accumulated through this month. */
  invoiceCountToDate: number;
  /** recognisedToDate − invoicedToDate; negative = billed ahead (DD-MMP-3). */
  unbilled: Cents;
  /**
   * Remaining work: contractNet − recognisedToDate (DD-MMP-3), so it follows the recognition basis.
   * null for rows without a contract or awaiting reconciliation. Never clamped. Not Left to bill.
   */
  remainingWork: Cents | null;
  /**
   * Left to bill: contractNet − invoicedToDate, whatever the recognition basis. The one
   * derivation every surface reads. null for rows that hold no contract (`holdsContract` false) or,
   * on a held contract, while it awaits reconciliation (unknown).
   */
  leftToBill: Cents | null;
  basis: RecognitionBasis;
}

export interface PackProgress {
  month: string;
  pctComplete: number;
  enteredByName: string | null;
  enteredAt: string;
}

export interface PackRow {
  key: string;
  kind: PackRowKind;
  projectId: string | null;
  projectName: string | null;
  projectNumber: string | null;
  clientName: string | null;
  projectManagerId: string | null;
  projectStatus: string | null;
  currency: string;
  contractNet: Cents | null;
  /**
   * A contract we hold: on-hand status and not archived, the Contract on hand set. Only these rows
   * carry Left to bill; a closed or archived project in the pack because it was billed in the window does not.
   */
  holdsContract: boolean;
  /** Latest entry dated on or before the as-at month; null = billing basis throughout. */
  latestProgress: PackProgress | null;
  months: PackMonth[];
}

export interface PackTotalsMonth {
  month: string;
  planned: Cents | null;
  recognised: Cents;
  invoiced: Cents;
  invoiceCount: number;
  recognisedToDate: Cents;
  invoicedToDate: Cents;
  invoiceCountToDate: number;
  unbilled: Cents;
  /** Sum of contract rows' remaining work; unknown when any contract row's is. */
  remainingWork: Cents | null;
  /** `leftToBillAt` over all rows in this currency: 0 with no contract, unknown when any contract row's is. */
  leftToBill: Cents | null;
}

export interface PackCurrencyTotals {
  currency: string;
  months: PackTotalsMonth[];
}

export interface ManagementPack {
  from: string;
  to: string;
  timezone: string;
  months: string[];
  rows: PackRow[];
  totals: PackCurrencyTotals[];
  undatedInvoiceCount: number;
  /** Billed work before the range on projects without a row (closed or archived), per currency. */
  billedHistory?: Array<{ currency: string; net: Cents; invoiceCount: number }>;
  /** Dated work invoices with no amount yet, per currency and month (`YYYY-MM-01`). */
  unpricedInvoices?: Array<{ currency: string; month: string; invoiceCount: number }>;
  unpricedInvoiceCount?: number;
}

export interface BilledWorkTotal {
  currency: string;
  /** Currency units, matching the dashboard figure selectors; null = an invoice in the span has no amount yet. */
  amount: number | null;
}

const monthKey = (month: string): string => month.slice(0, 7);

/** True when a dated invoice in `currency` with no amount yet falls in the month span (`YYYY-MM`, inclusive; null = from the start). */
export function unpricedIn(pack: ManagementPack, currency: string, fromMonth: string | null, toMonth: string): boolean {
  return (pack.unpricedInvoices ?? []).some((u) => u.currency === currency && u.invoiceCount > 0
    && (fromMonth === null || monthKey(u.month) >= fromMonth) && monthKey(u.month) <= toMonth);
}

const historyCents = (pack: ManagementPack, currency: string): Cents =>
  (pack.billedHistory ?? []).filter((h) => h.currency === currency).reduce((sum, h) => sum + h.net, 0);

/** Every currency a billed-work total may report: a totals series, earlier billing on unlisted projects, or an unpriced
 * invoice. Totals-series currencies come first in their order, then any other currency in code order. */
function billedCurrencies(pack: ManagementPack, unpricedFrom: string | null, unpricedTo: string, withHistory: boolean): string[] {
  const listed = pack.totals.map((row) => row.currency);
  const extra = new Set<string>();
  if (withHistory) for (const h of pack.billedHistory ?? []) if (h.invoiceCount > 0) extra.add(h.currency);
  for (const u of pack.unpricedInvoices ?? []) if (unpricedIn(pack, u.currency, unpricedFrom, unpricedTo)) extra.add(u.currency);
  return [...listed, ...[...extra].filter((currency) => !listed.includes(currency)).sort((a, b) => a.localeCompare(b))];
}

/** Billed work dated inside the selected month range, in each currency. */
export function selectBilledWorkInPeriod(
  pack: ManagementPack | undefined,
  from: string | null,
  to: string | null,
): BilledWorkTotal[] | undefined {
  if (!pack || !from || !to) return undefined;
  const fromMonth = monthKey(from);
  const toMonth = monthKey(to);
  return billedCurrencies(pack, fromMonth, toMonth, false).map((currency) => {
    if (unpricedIn(pack, currency, fromMonth, toMonth)) return { currency, amount: null };
    const row = pack.totals.find((series) => series.currency === currency);
    return {
      currency,
      amount: (row?.months ?? [])
        .filter((month) => monthKey(month.month) >= fromMonth && monthKey(month.month) <= toMonth)
        .reduce((sum, month) => sum + month.invoiced, 0) / 100,
    };
  });
}

/** Billed work for each month in one currency; a missing period or currency is unknown. */
export function selectBilledWorkByMonth(
  pack: ManagementPack | undefined,
  from: string | null,
  to: string | null,
  currency: string,
): Array<{ month: string; amount: number }> | undefined {
  const series = pack?.totals.find((row) => row.currency === currency);
  if (!series || !from || !to) return undefined;
  const fromMonth = monthKey(from);
  const toMonth = monthKey(to);
  return series.months
    .filter((month) => monthKey(month.month) >= fromMonth && monthKey(month.month) <= toMonth)
    .map((month) => ({ month: monthKey(month.month), amount: month.invoiced / 100 }));
}

/**
 * The month entry of `currency`'s totals series; `null` when the currency has no series (billed only on unlisted
 * projects, or only unpriced) and the month is inside the pack; `undefined` when the month is not in the pack.
 */
function totalsMonthAt(pack: ManagementPack, currency: string, month: string): PackTotalsMonth | null | undefined {
  const series = pack.totals.find((row) => row.currency === currency);
  if (series) return series.months.find((entry) => monthKey(entry.month) === month);
  return (pack.months ?? []).some((m) => monthKey(m) === month) ? null : undefined;
}

/** All-history billed work through the as-at month, deliberately based on the cumulative reader. Earlier billing
 * on projects without a row counts too, and an unpriced invoice through the as-at month makes the currency unavailable. */
export function selectBilledWorkCumulative(
  pack: ManagementPack | undefined,
  asAt: string | null,
): BilledWorkTotal[] | undefined {
  if (!pack || !asAt) return undefined;
  const targetMonth = monthKey(asAt);
  return billedCurrencies(pack, null, targetMonth, true).flatMap((currency): BilledWorkTotal[] => {
    const month = totalsMonthAt(pack, currency, targetMonth);
    if (month === undefined) return [];
    if (unpricedIn(pack, currency, null, targetMonth)) return [{ currency, amount: null }];
    return [{ currency, amount: ((month?.invoicedToDate ?? 0) + historyCents(pack, currency)) / 100 }];
  });
}

/** All-history billed work before the selected period's first month, on every project; an unpriced invoice → unavailable. */
export function selectBilledWorkOpening(
  pack: ManagementPack | undefined,
  from: string | null,
): BilledWorkTotal[] | undefined {
  if (!pack || !from) return undefined;
  const startMonth = monthKey(from);
  const beforeStart = monthKey(addMonths(`${startMonth}-01`, -1));
  return billedCurrencies(pack, null, beforeStart, true).flatMap((currency): BilledWorkTotal[] => {
    const month = totalsMonthAt(pack, currency, startMonth);
    if (month === undefined) return [];
    if (unpricedIn(pack, currency, null, beforeStart)) return [{ currency, amount: null }];
    return [{ currency, amount: ((month ? month.invoicedToDate - month.invoiced : 0) + historyCents(pack, currency)) / 100 }];
  });
}

/**
 * Left to bill (contract value less invoiced value) summed over the signed contract rows in one currency
 * at one month, in cents. No contract rows = 0; any unknown contract row (or missing month) = unknown.
 * It sums each row's own `leftToBill`, so a subset of rows (a filtered table) and the pack totals agree.
 */
export function leftToBillAt(rows: readonly PackRow[], currency: string, month: string): Cents | null {
  const contracts = rows.filter((row) => row.holdsContract && row.currency === currency);
  let total = 0;
  for (const row of contracts) {
    const snapshot = row.months.find((entry) => entry.month === month);
    if (!snapshot || snapshot.leftToBill === null) return null;
    total += snapshot.leftToBill;
  }
  return total;
}

/** Latest-period Left to bill totals in currency units for dashboard formatters, retaining unknowns as null. */
export function selectLeftToBillTotals(pack: ManagementPack | undefined, emptyCurrency?: string): Array<{ currency: string; amount: number | null }> | undefined {
  if (!pack) return undefined;
  const month = pack.months[pack.months.length - 1];
  if (!month) return [];
  const currencies = [...new Set(pack.rows.filter((row) => row.holdsContract).map((row) => row.currency))];
  if (currencies.length === 0 && emptyCurrency) currencies.push(emptyCurrency);
  return currencies.map((currency) => {
    const cents = leftToBillAt(pack.rows, currency, month);
    return { currency, amount: cents === null ? null : cents / 100 };
  });
}

export const toCents = (amount: number): Cents => Math.round(amount * 100);
export const fromCents = (cents: Cents): number => cents / 100;

/** round_half_up(amount × num / den) for amount ≥ 0, num ≥ 0, den > 0. BigInt: amount × num can pass 2^53. */
export function mulDivRound(amount: Cents, num: number, den: number): Cents {
  const a = BigInt(amount);
  const n = BigInt(num);
  const d = BigInt(den);
  return Number((a * n * 2n + d) / (2n * d));
}

/** `pct` (0–100, at most 2 decimals) of a non-negative amount. */
export function pctOf(amount: Cents, pct: number): Cents {
  return mulDivRound(amount, Math.round(pct * 100), 10_000);
}

/** DD-MMP-2: straight-line by calendar day; null when there is no usable schedule. */
export function plannedForMonth(contractNet: Cents, start: string | null, end: string | null, month: string): Cents | null {
  if (!start || !end || end < start) return null;
  const total = daysInclusive(start, end);
  const cumulativeThrough = (day: string): Cents => {
    if (day < start) return 0;
    if (day >= end) return contractNet;
    return mulDivRound(contractNet, daysInclusive(start, day), total);
  };
  return cumulativeThrough(monthEnd(month)) - cumulativeThrough(addDays(month, -1));
}

const factKey = (projectId: string | null, currency: string): string => `${projectId ?? ''}|${currency}`;

function latestAtOrBefore(entries: PackFactsProgress[], month: string): PackFactsProgress | null {
  let found: PackFactsProgress | null = null;
  for (const e of entries) if (e.month <= month && (!found || e.month > found.month)) found = e;
  return found;
}

interface RowInput {
  kind: PackRowKind;
  project: PackFactsProject | null;
  currency: string;
  invoicedByMonth: Map<string, Cents>;
  invoiceCountByMonth: Map<string, number>;
  invoicedBefore: Cents;
  invoiceCountBefore: number;
  progress: PackFactsProgress[];
  /** month -> earned cents; set only for a project with contract lines. */
  earned: Map<string, Cents> | null;
  months: string[];
  from: string;
  to: string;
  /** false while an invoice in another currency awaits reconciliation (RF-036): contract balances are unknown. */
  reconciled: boolean;
}

/**
 * Held = the server's on_hand flag (on-hand status and not archived). Only the server knows archived, so a
 * project sent without the flag is not counted rather than guessed from its status.
 */
function holdsContract(project: PackFactsProject): boolean {
  return project.on_hand === true;
}

function buildRow(r: RowInput): PackRow {
  const contractNet = r.kind === 'contract' && r.project ? toCents(r.project.contract_net) : null;
  const held = contractNet !== null && r.project !== null && holdsContract(r.project);
  const recognisedToDateAt = (month: string, invoicedToDate: Cents): { value: Cents; basis: RecognitionBasis } => {
    if (contractNet !== null && r.earned) return { value: r.earned.get(month) ?? 0, basis: 'earned' };
    const entry = contractNet !== null ? latestAtOrBefore(r.progress, month) : null;
    return entry && contractNet !== null
      ? { value: pctOf(contractNet, entry.pct_complete), basis: 'progress' }
      : { value: invoicedToDate, basis: 'invoiced' };
  };

  let invoicedToDate = r.invoicedBefore;
  let invoiceCountToDate = r.invoiceCountBefore;
  let previous = recognisedToDateAt(addMonths(r.from, -1), invoicedToDate).value;
  const months = r.months.map((month): PackMonth => {
    const invoiced = r.invoicedByMonth.get(month) ?? 0;
    const invoiceCount = r.invoiceCountByMonth.get(month) ?? 0;
    invoicedToDate += invoiced;
    invoiceCountToDate += invoiceCount;
    const { value: recognisedToDate, basis } = recognisedToDateAt(month, invoicedToDate);
    const knownContract = r.reconciled ? contractNet : null;
    const out: PackMonth = {
      month,
      planned: contractNet !== null && r.project
        ? plannedForMonth(contractNet, r.project.start_date, r.project.end_date, month)
        : null,
      recognised: recognisedToDate - previous,
      invoiced,
      invoiceCount,
      recognisedToDate,
      invoicedToDate,
      invoiceCountToDate,
      unbilled: recognisedToDate - invoicedToDate,
      remainingWork: knownContract === null ? null : knownContract - recognisedToDate,
      leftToBill: knownContract === null || !held ? null : knownContract - invoicedToDate,
      basis,
    };
    previous = recognisedToDate;
    return out;
  });

  const latest = contractNet !== null ? latestAtOrBefore(r.progress, r.to) : null;
  return {
    key: `${factKey(r.project?.id ?? null, r.currency)}|${r.kind}`,
    kind: r.kind,
    projectId: r.project?.id ?? null,
    projectName: r.project?.name ?? null,
    projectNumber: r.project?.pmo_project_number ?? null,
    clientName: r.project?.client_name ?? null,
    projectManagerId: r.project?.project_manager_id ?? null,
    projectStatus: r.project?.status ?? null,
    currency: r.currency,
    contractNet,
    holdsContract: held,
    latestProgress: latest
      ? { month: latest.month, pctComplete: latest.pct_complete, enteredByName: latest.entered_by_name, enteredAt: latest.entered_at }
      : null,
    months,
  };
}

function totalsByCurrency(rows: PackRow[], months: string[], invoiceCurrencies: Set<string>): PackCurrencyTotals[] {
  const includedRows = rows.filter((row) => row.contractNet !== null || row.months.some((m) =>
    m.planned !== null && m.planned !== 0 || m.recognised !== 0 || m.invoiced !== 0 || m.invoiceCount > 0 ||
    m.recognisedToDate !== 0 || m.invoicedToDate !== 0 || m.invoiceCountToDate > 0 || m.unbilled !== 0 || m.remainingWork !== null && m.remainingWork !== 0,
  ));
  const byCurrency = new Map<string, PackTotalsMonth[]>();
  for (const row of includedRows) {
    const series = byCurrency.get(row.currency) ?? months.map((month) => ({
      month, planned: 0 as Cents | null, recognised: 0, invoiced: 0, invoiceCount: 0, recognisedToDate: 0, invoicedToDate: 0, invoiceCountToDate: 0, unbilled: 0, remainingWork: 0 as Cents | null, leftToBill: 0 as Cents | null,
    }));
    row.months.forEach((m, i) => {
      const t = series[i];
      if (row.kind === 'contract' && m.planned === null) t.planned = null;
      else if (t.planned !== null) t.planned += m.planned ?? 0;
      t.recognised += m.recognised;
      t.invoiced += m.invoiced;
      t.invoiceCount += m.invoiceCount;
      t.recognisedToDate += m.recognisedToDate;
      t.invoicedToDate += m.invoicedToDate;
      t.invoiceCountToDate += m.invoiceCountToDate;
      t.unbilled += m.unbilled;
      if (row.kind === 'contract' && m.remainingWork === null) t.remainingWork = null;
      else if (t.remainingWork !== null) t.remainingWork += m.remainingWork ?? 0;
    });
    byCurrency.set(row.currency, series);
  }
  for (const [currency, series] of byCurrency) {
    for (const t of series) t.leftToBill = leftToBillAt(rows, currency, t.month);
  }
  for (const currency of invoiceCurrencies) {
    if (!byCurrency.has(currency)) byCurrency.set(currency, months.map((month) => ({
      month, planned: 0, recognised: 0, invoiced: 0, invoiceCount: 0, recognisedToDate: 0, invoicedToDate: 0, invoiceCountToDate: 0, unbilled: 0, remainingWork: 0, leftToBill: 0,
    })));
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, series]) => ({ currency, months: series }));
}

export function buildManagementPack(facts: ManagementPackFacts): ManagementPack {
  const months = monthsBetween(facts.from, facts.to);

  const invoiced = new Map<string, Map<string, Cents>>();
  const invoiceCounts = new Map<string, Map<string, number>>();
  for (const f of facts.invoiced) {
    const k = factKey(f.project_id, f.currency);
    const byMonth = invoiced.get(k) ?? new Map<string, Cents>();
    byMonth.set(f.month, (byMonth.get(f.month) ?? 0) + toCents(f.net));
    invoiced.set(k, byMonth);
    const countsByMonth = invoiceCounts.get(k) ?? new Map<string, number>();
    countsByMonth.set(f.month, (countsByMonth.get(f.month) ?? 0) + f.invoice_count);
    invoiceCounts.set(k, countsByMonth);
  }
  const before = new Map<string, Cents>();
  const invoiceCountBefore = new Map<string, number>();
  for (const f of facts.invoiced_before) {
    const k = factKey(f.project_id, f.currency);
    before.set(k, (before.get(k) ?? 0) + toCents(f.net));
    invoiceCountBefore.set(k, (invoiceCountBefore.get(k) ?? 0) + f.invoice_count);
  }
  const progressByProject = new Map<string, PackFactsProgress[]>();
  const projectsById = new Map(facts.projects.map((p) => [p.id, p] as const));
  const invoiceCurrencies = new Set(facts.invoiced.filter((f) => f.invoice_count > 0).map((f) => f.currency));
  const foreignInvoiceProjects = new Set<string>();
  for (const f of facts.invoiced) {
    const project = f.project_id ? projectsById.get(f.project_id) : null;
    if (project && f.currency !== project.currency && f.invoice_count > 0) foreignInvoiceProjects.add(project.id);
  }
  for (const f of facts.invoiced_before) {
    const project = f.project_id ? projectsById.get(f.project_id) : null;
    if (project && f.currency !== project.currency && f.invoice_count > 0) foreignInvoiceProjects.add(project.id);
    if (f.invoice_count > 0) invoiceCurrencies.add(f.currency);
  }
  for (const p of facts.progress) {
    const list = progressByProject.get(p.project_id) ?? [];
    list.push(p);
    progressByProject.set(p.project_id, list);
  }

  const earnedByProject = new Map<string, Map<string, Cents>>();
  for (const e of facts.earned ?? []) {
    const byMonth = earnedByProject.get(e.project_id) ?? new Map<string, Cents>();
    byMonth.set(e.month, toCents(e.earned_value));
    earnedByProject.set(e.project_id, byMonth);
  }

  const unpricedInvoices = (facts.unpriced ?? []).map((u) => ({ currency: u.currency, month: u.month, invoiceCount: u.invoice_count }));
  const common = { months, from: facts.from, to: facts.to };
  const rows: PackRow[] = [];
  const covered = new Set<string>();

  for (const project of facts.projects) {
    const k = factKey(project.id, project.currency);
    covered.add(k);
    rows.push(buildRow({
      ...common, kind: 'contract', project, currency: project.currency,
      invoicedByMonth: invoiced.get(k) ?? new Map(), invoiceCountByMonth: invoiceCounts.get(k) ?? new Map(),
      invoicedBefore: before.get(k) ?? 0, invoiceCountBefore: invoiceCountBefore.get(k) ?? 0,
      progress: progressByProject.get(project.id) ?? [], earned: earnedByProject.get(project.id) ?? null, reconciled: !foreignInvoiceProjects.has(project.id),
    }));
  }

  // Other-currency rows sort with their project's id; Unassigned (empty id) goes last.
  const extraKeys = [...new Set([...invoiced.keys(), ...before.keys()])]
    .filter((k) => !covered.has(k))
    .sort((a, b) => Number(a.startsWith('|')) - Number(b.startsWith('|')) || a.localeCompare(b));
  for (const k of extraKeys) {
    const sep = k.lastIndexOf('|');
    const projectId = k.slice(0, sep) || null;
    rows.push(buildRow({
      ...common,
      kind: projectId ? 'otherCurrency' : 'unassigned',
      project: projectId ? projectsById.get(projectId) ?? null : null,
      currency: k.slice(sep + 1),
      invoicedByMonth: invoiced.get(k) ?? new Map(), invoiceCountByMonth: invoiceCounts.get(k) ?? new Map(),
      invoicedBefore: before.get(k) ?? 0, invoiceCountBefore: invoiceCountBefore.get(k) ?? 0,
      progress: [], earned: null, reconciled: false,
    }));
  }

  return {
    from: facts.from, to: facts.to, timezone: facts.timezone, months, rows,
    totals: totalsByCurrency(rows, months, invoiceCurrencies), undatedInvoiceCount: facts.undated_invoice_count,
    billedHistory: (facts.invoiced_history ?? []).map((h) => ({ currency: h.currency, net: toCents(h.net), invoiceCount: h.invoice_count })),
    unpricedInvoices,
    unpricedInvoiceCount: unpricedInvoices.reduce((sum, u) => sum + u.invoiceCount, 0),
  };
}
