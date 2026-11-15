/**
 * fiscal-year.ensure on ERPNext (#1599 ECX-5): keep the bound company one fiscal year ahead.
 *
 * Bed rules (`__fixtures__/fiscalYear.json`, v15): a year with no `companies` rows covers every company, and the child-table
 * company filter never returns such a year, so years are looked up by DATE RANGE alone and each one's company rows are read.
 * A create always sends the bound company's row. ERPNext names the year by `year` and names are unique across companies and
 * disabled years, so when the plain name ("2027") is already held the year is named for the company ("2027 - <company>").
 * Whether a year already covers the company is decided only from the date-range lookup, never from a refusal. Creating
 * needs the System Manager role: a 403 (on the create or on the lookup) is reported as an Operator task; any other refusal,
 * or an ERP answer PMO does not decide on, is reported as refused in plain words. Only an unreachable ERP throws.
 * Relative imports only (Deno-importable).
 */
import { createDoc, ErpError, type ErpClientDeps, getDoc, listDocsByFilters } from './client.ts';
import {
  companyFiscalYearName, containsDate, coversCompany, daysBetween, erpFullYearEnd, FISCAL_YEAR_LEAD_DAYS,
  type FiscalYearEnsureOutcome, fiscalYearName, type FiscalYearSpan, nextYearSpan,
} from '../fiscalYearEnsure.ts';

const DOCTYPE = 'Fiscal Year';
/** More years than this intersecting one span is not a shape PMO decides on: it fails closed. */
const SPAN_READ_LIMIT = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An ERP answer PMO does not decide on (too many years, a malformed row). Reported as refused, in plain words. */
export class FiscalYearUndecidable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalYearUndecidable';
  }
}

function isoDate(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) throw new FiscalYearUndecidable(`a fiscal year's ${what} is not a date`);
  return value;
}

/** Every year whose dates intersect [from, to], with its company rows read from the year itself. */
export async function readYearsIntersecting(client: ErpClientDeps, from: string, to: string): Promise<FiscalYearSpan[]> {
  const rows = await listDocsByFilters(
    client, DOCTYPE, [['year_start_date', '<=', to], ['year_end_date', '>=', from]],
    ['name', 'year_start_date', 'year_end_date', 'disabled'], SPAN_READ_LIMIT, 'year_start_date asc',
  );
  if (rows.length >= SPAN_READ_LIMIT) throw new FiscalYearUndecidable('too many years intersect one date range for PMO to decide');
  const years: FiscalYearSpan[] = [];
  for (const row of rows) {
    if (typeof row.name !== 'string' || !row.name) throw new FiscalYearUndecidable('a listed fiscal year has no name');
    const doc = await getDoc(client, DOCTYPE, row.name) as Record<string, unknown>;
    if (doc.name !== row.name) throw new FiscalYearUndecidable('a fiscal year read back under another name');
    if (doc.companies !== undefined && !Array.isArray(doc.companies)) throw new FiscalYearUndecidable("a fiscal year's company rows are not a list");
    const companies = ((doc.companies ?? []) as unknown[]).map((child) => {
      const company = (child as { company?: unknown } | null)?.company;
      if (typeof company !== 'string' || !company) throw new FiscalYearUndecidable("a fiscal year's company row names no company");
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

/** Whether a year of this exact name exists (any company, enabled or not): ERPNext names are unique. */
async function nameTaken(client: ErpClientDeps, name: string): Promise<boolean> {
  return (await listDocsByFilters(client, DOCTYPE, [['name', '=', name]], ['name'], 1)).length > 0;
}

/**
 * Make sure a fiscal year serving `company` exists for the day after the current one ends, once the current one ends within
 * the lead time. Lookup first, create only on absence, then read back; the outcome reports only what the read-back shows.
 * Only a transport failure with nothing read back throws (the sweep retries on a later tick); every ERP refusal and every
 * answer PMO does not decide on is an outcome, so the sweep can store it for the checklist.
 */
export async function ensureNextFiscalYear(
  client: ErpClientDeps, company: string, today: string, leadDays: number = FISCAL_YEAR_LEAD_DAYS,
): Promise<FiscalYearEnsureOutcome> {
  if (!company) throw new Error('ERPNext Fiscal Year: no company is bound');
  if (!ISO_DATE.test(today)) throw new Error('ERPNext Fiscal Year: today is not a date');
  try {
    return await ensureNext(client, company, today, leadDays);
  } catch (err) {
    if (err instanceof FiscalYearUndecidable) return { state: 'refused', message: err.message };
    if (!(err instanceof ErpError) || err.code === 'external-unreachable') throw err;
    if (err.status === 403) return { state: 'needs-operator', reason: 'missing-role' };
    return { state: 'refused', message: err.message };
  }
}

async function ensureNext(client: ErpClientDeps, company: string, today: string, leadDays: number): Promise<FiscalYearEnsureOutcome> {
  const current = await yearServing(client, company, today);
  if (!current) return { state: 'needs-operator', reason: 'no-current-year' };
  if (daysBetween(today, current.end) > leadDays) return { state: 'not-due', current: current.name };

  const span = nextYearSpan(current.end);
  const existing = await yearServing(client, company, span.start);
  if (existing) return { state: 'ready', current: current.name, next: existing.name, created: false };

  // The plain name may be held by another company's year or a disabled one; the lookup above says none serves this company.
  const plain = fiscalYearName(span);
  const year = (await nameTaken(client, plain)) ? companyFiscalYearName(span, company) : plain;
  let refusal: ErpError | null = null;
  try {
    await createDoc(client, DOCTYPE, {
      year, year_start_date: span.start, year_end_date: span.end, companies: [{ company }],
      ...(erpFullYearEnd(span.start) === span.end ? {} : { is_short_year: 1 }),
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
