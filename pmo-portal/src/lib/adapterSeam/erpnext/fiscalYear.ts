/**
 * fiscal-year.ensure on ERPNext (#1599 ECX-5): keep the bound company one fiscal year ahead.
 *
 * Bed rules (`__fixtures__/fiscalYear.json`, v15): a year with no `companies` rows covers every company, and the child-table
 * company filter never returns such a year, so years are looked up by DATE RANGE alone and each one's company rows are read.
 * A create always sends the bound company's row; ERPNext names the year by `year`, so a second create of the same span is
 * refused as a duplicate and the read-back settles it. Creating needs the System Manager role: a 403 is reported as an
 * Operator task. Relative imports only (Deno-importable).
 */
import { createDoc, ErpError, type ErpClientDeps, getDoc, listDocsByFilters } from './client.ts';
import {
  containsDate, coversCompany, daysBetween, FISCAL_YEAR_LEAD_DAYS, type FiscalYearEnsureOutcome, fiscalYearName,
  type FiscalYearSpan, nextYearSpan,
} from '../fiscalYearEnsure.ts';

const DOCTYPE = 'Fiscal Year';
/** More years than this intersecting one span is not a shape PMO decides on: it fails closed. */
const SPAN_READ_LIMIT = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) throw new Error(`ERPNext Fiscal Year: ${what} is not a date`);
  return value;
}

/** Every year whose dates intersect [from, to], with its company rows read from the year itself. */
export async function readYearsIntersecting(client: ErpClientDeps, from: string, to: string): Promise<FiscalYearSpan[]> {
  const rows = await listDocsByFilters(
    client, DOCTYPE, [['year_start_date', '<=', to], ['year_end_date', '>=', from]],
    ['name', 'year_start_date', 'year_end_date', 'disabled'], SPAN_READ_LIMIT, 'year_start_date asc',
  );
  if (rows.length >= SPAN_READ_LIMIT) throw new Error('ERPNext Fiscal Year: too many years intersect one span to decide');
  const years: FiscalYearSpan[] = [];
  for (const row of rows) {
    if (typeof row.name !== 'string' || !row.name) throw new Error('ERPNext Fiscal Year: a listed year has no name');
    const doc = await getDoc(client, DOCTYPE, row.name) as Record<string, unknown>;
    if (doc.name !== row.name) throw new Error('ERPNext Fiscal Year: the year read back under another name');
    if (doc.companies !== undefined && !Array.isArray(doc.companies)) throw new Error('ERPNext Fiscal Year: company rows are not a list');
    const companies = ((doc.companies ?? []) as unknown[]).map((child) => {
      const company = (child as { company?: unknown } | null)?.company;
      if (typeof company !== 'string' || !company) throw new Error('ERPNext Fiscal Year: a company row names no company');
      return company;
    });
    years.push({
      name: row.name,
      start: isoDate(doc.year_start_date, 'start'),
      end: isoDate(doc.year_end_date, 'end'),
      companies,
      disabled: doc.disabled === 1 || doc.disabled === true,
    });
  }
  return years;
}

/** The enabled year serving `company` on `date`; when two do, the one reaching furthest ahead. */
async function yearServing(client: ErpClientDeps, company: string, date: string): Promise<FiscalYearSpan | null> {
  const serving = (await readYearsIntersecting(client, date, date))
    .filter((y) => coversCompany(y, company) && containsDate(y, date))
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
  return serving[0] ?? null;
}

/**
 * Make sure a fiscal year serving `company` exists for the day after the current one ends, once the current one ends within
 * the lead time. Lookup first, create only on absence, then read back; the outcome reports only what the read-back shows.
 * A transport failure with nothing read back throws (the sweep retries on a later tick).
 */
export async function ensureNextFiscalYear(
  client: ErpClientDeps, company: string, today: string, leadDays: number = FISCAL_YEAR_LEAD_DAYS,
): Promise<FiscalYearEnsureOutcome> {
  if (!company) throw new Error('ERPNext Fiscal Year: no company is bound');
  isoDate(today, 'today');
  const current = await yearServing(client, company, today);
  if (!current) return { state: 'needs-operator', reason: 'no-current-year' };
  if (daysBetween(today, current.end) > leadDays) return { state: 'not-due', current: current.name };

  const span = nextYearSpan(current.end);
  const existing = await yearServing(client, company, span.start);
  if (existing) return { state: 'ready', current: current.name, next: existing.name, created: false };

  let refusal: ErpError | null = null;
  try {
    await createDoc(client, DOCTYPE, {
      year: fiscalYearName(span), year_start_date: span.start, year_end_date: span.end, companies: [{ company }],
    });
  } catch (err) {
    if (!(err instanceof ErpError)) throw err;
    if (err.status === 403) return { state: 'needs-operator', reason: 'missing-role' };
    refusal = err;
  }

  const readBack = await yearServing(client, company, span.start);
  if (readBack) {
    // A refused create that still reads back means another writer made the year first; otherwise PMO made it.
    const created = refusal === null || refusal.code === 'external-unreachable';
    return { state: 'ready', current: current.name, next: readBack.name, created };
  }
  if (refusal && refusal.code === 'external-unreachable') throw refusal;
  return { state: 'refused', message: refusal ? refusal.message : null };
}
