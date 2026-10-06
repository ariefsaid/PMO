import { addDays, addMonths, daysInclusive, monthEnd, monthsBetween } from './months';
import type { ManagementPackFacts, PackFactsProgress, PackFactsProject } from '@/src/lib/db/managementPack';

/**
 * #765 — the monthly management pack, derived from server facts (ADR-0076, DD-MMP-1..5).
 * Every figure is NET of tax, in the row's own currency, in integer cents (NFR-MMP-002).
 */
export type Cents = number;
export type RecognitionBasis = 'progress' | 'invoiced';
export type PackRowKind = 'contract' | 'otherCurrency' | 'unassigned';

export interface PackMonth {
  month: string;
  /** null = the project has no usable start/end dates ("No schedule"), or the row has no contract. */
  planned: Cents | null;
  recognised: Cents;
  invoiced: Cents;
  recognisedToDate: Cents;
  invoicedToDate: Cents;
  /** recognisedToDate − invoicedToDate; negative = billed ahead (DD-MMP-3). */
  unbilled: Cents;
  /** contractNet − recognisedToDate; null for rows without a contract. Never clamped. */
  backlog: Cents | null;
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
  currency: string;
  contractNet: Cents | null;
  /** Latest entry dated on or before the as-at month; null = billing basis throughout. */
  latestProgress: PackProgress | null;
  months: PackMonth[];
}

export interface PackTotalsMonth {
  month: string;
  planned: Cents;
  recognised: Cents;
  invoiced: Cents;
  recognisedToDate: Cents;
  invoicedToDate: Cents;
  unbilled: Cents;
  backlog: Cents;
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
  invoicedBefore: Cents;
  progress: PackFactsProgress[];
  months: string[];
  from: string;
  to: string;
}

function buildRow(r: RowInput): PackRow {
  const contractNet = r.kind === 'contract' && r.project ? toCents(r.project.contract_net) : null;
  const recognisedToDateAt = (month: string, invoicedToDate: Cents): { value: Cents; basis: RecognitionBasis } => {
    const entry = contractNet !== null ? latestAtOrBefore(r.progress, month) : null;
    return entry && contractNet !== null
      ? { value: pctOf(contractNet, entry.pct_complete), basis: 'progress' }
      : { value: invoicedToDate, basis: 'invoiced' };
  };

  let invoicedToDate = r.invoicedBefore;
  let previous = recognisedToDateAt(addMonths(r.from, -1), invoicedToDate).value;
  const months = r.months.map((month): PackMonth => {
    const invoiced = r.invoicedByMonth.get(month) ?? 0;
    invoicedToDate += invoiced;
    const { value: recognisedToDate, basis } = recognisedToDateAt(month, invoicedToDate);
    const out: PackMonth = {
      month,
      planned: contractNet !== null && r.project
        ? plannedForMonth(contractNet, r.project.start_date, r.project.end_date, month)
        : null,
      recognised: recognisedToDate - previous,
      invoiced,
      recognisedToDate,
      invoicedToDate,
      unbilled: recognisedToDate - invoicedToDate,
      backlog: contractNet === null ? null : contractNet - recognisedToDate,
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
    currency: r.currency,
    contractNet,
    latestProgress: latest
      ? { month: latest.month, pctComplete: latest.pct_complete, enteredByName: latest.entered_by_name, enteredAt: latest.entered_at }
      : null,
    months,
  };
}

function totalsByCurrency(rows: PackRow[], months: string[]): PackCurrencyTotals[] {
  const byCurrency = new Map<string, PackTotalsMonth[]>();
  for (const row of rows) {
    const series = byCurrency.get(row.currency) ?? months.map((month) => ({
      month, planned: 0, recognised: 0, invoiced: 0, recognisedToDate: 0, invoicedToDate: 0, unbilled: 0, backlog: 0,
    }));
    row.months.forEach((m, i) => {
      const t = series[i];
      t.planned += m.planned ?? 0;
      t.recognised += m.recognised;
      t.invoiced += m.invoiced;
      t.recognisedToDate += m.recognisedToDate;
      t.invoicedToDate += m.invoicedToDate;
      t.unbilled += m.unbilled;
      t.backlog += m.backlog ?? 0;
    });
    byCurrency.set(row.currency, series);
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, series]) => ({ currency, months: series }));
}

export function buildManagementPack(facts: ManagementPackFacts): ManagementPack {
  const months = monthsBetween(facts.from, facts.to);

  const invoiced = new Map<string, Map<string, Cents>>();
  for (const f of facts.invoiced) {
    const k = factKey(f.project_id, f.currency);
    const byMonth = invoiced.get(k) ?? new Map<string, Cents>();
    byMonth.set(f.month, (byMonth.get(f.month) ?? 0) + toCents(f.net));
    invoiced.set(k, byMonth);
  }
  const before = new Map<string, Cents>();
  for (const f of facts.invoiced_before) {
    const k = factKey(f.project_id, f.currency);
    before.set(k, (before.get(k) ?? 0) + toCents(f.net));
  }
  const progressByProject = new Map<string, PackFactsProgress[]>();
  for (const p of facts.progress) {
    const list = progressByProject.get(p.project_id) ?? [];
    list.push(p);
    progressByProject.set(p.project_id, list);
  }

  const common = { months, from: facts.from, to: facts.to };
  const rows: PackRow[] = [];
  const covered = new Set<string>();
  const projectsById = new Map(facts.projects.map((p) => [p.id, p] as const));

  for (const project of facts.projects) {
    const k = factKey(project.id, project.currency);
    covered.add(k);
    rows.push(buildRow({
      ...common, kind: 'contract', project, currency: project.currency,
      invoicedByMonth: invoiced.get(k) ?? new Map(), invoicedBefore: before.get(k) ?? 0,
      progress: progressByProject.get(project.id) ?? [],
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
      invoicedByMonth: invoiced.get(k) ?? new Map(), invoicedBefore: before.get(k) ?? 0,
      progress: [],
    }));
  }

  return {
    from: facts.from, to: facts.to, timezone: facts.timezone, months, rows,
    totals: totalsByCurrency(rows, months), undatedInvoiceCount: facts.undated_invoice_count,
  };
}
