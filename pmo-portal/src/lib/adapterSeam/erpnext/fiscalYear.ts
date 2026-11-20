/**
 * fiscal-year.ensure discovery (#1599 ECX-5, AC-ECX-040) — Read-only discovery for ERPNext fiscal years.
 * Looks up years by date range alone and reads each one's company rows.
 * No create or POST in this file.
 */
import { ErpError, type ErpClientDeps, getDoc, listDocsByFilters } from './client.ts';
import { erpReason } from './erpReason.ts';
import {
  companyFiscalYearName,
  containsDate,
  coversCompany,
  daysBetween,
  erpFullYearEnd,
  FISCAL_YEAR_LEAD_DAYS,
  type FiscalYearDiscovery,
  fiscalYearName,
  type FiscalYearSpan,
  nextYearSpan,
} from '../fiscalYearEnsure.ts';

const DOCTYPE = 'Fiscal Year';
const SPAN_READ_LIMIT = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class FiscalYearUndecidable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalYearUndecidable';
  }
}

function isoDate(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new FiscalYearUndecidable(`a fiscal year's ${what} is not a date`);
  }
  return value;
}

export async function readYearsIntersecting(client: ErpClientDeps, from: string, to: string): Promise<FiscalYearSpan[]> {
  const rows = await listDocsByFilters(
    client,
    DOCTYPE,
    [['year_start_date', '<=', to], ['year_end_date', '>=', from]],
    ['name', 'year_start_date', 'year_end_date', 'disabled'],
    SPAN_READ_LIMIT,
    'year_start_date asc',
  );
  if (rows.length >= SPAN_READ_LIMIT) {
    throw new FiscalYearUndecidable('too many years intersect one date range for PMO to decide');
  }
  const years: FiscalYearSpan[] = [];
  for (const row of rows) {
    if (typeof row.name !== 'string' || !row.name) {
      throw new FiscalYearUndecidable('a listed fiscal year has no name');
    }
    const doc = (await getDoc(client, DOCTYPE, row.name)) as Record<string, unknown>;
    if (doc.name !== row.name) {
      throw new FiscalYearUndecidable('a fiscal year read back under another name');
    }
    if (doc.companies !== undefined && !Array.isArray(doc.companies)) {
      throw new FiscalYearUndecidable("a fiscal year's company rows are not a list");
    }
    const companies = ((doc.companies ?? []) as unknown[]).map((child) => {
      const company = (child as { company?: unknown } | null)?.company;
      if (typeof company !== 'string' || !company) {
        throw new FiscalYearUndecidable("a fiscal year's company row names no company");
      }
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

async function yearServing(client: ErpClientDeps, company: string, date: string): Promise<FiscalYearSpan[]> {
  const years = (await readYearsIntersecting(client, date, date))
    .filter((y) => coversCompany(y, company) && containsDate(y, date))
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
  const companyScoped = years.filter((y) => y.companies.includes(company));
  return companyScoped.length > 0 ? companyScoped : years;
}

async function nameTaken(client: ErpClientDeps, name: string): Promise<boolean> {
  return (await listDocsByFilters(client, DOCTYPE, [['name', '=', name]], ['name'], 1)).length > 0;
}

export async function discoverFiscalYear(
  client: ErpClientDeps,
  company: string,
  today: string,
  leadDays: number = FISCAL_YEAR_LEAD_DAYS,
): Promise<FiscalYearDiscovery> {
  if (!company) throw new Error('ERPNext Fiscal Year: no company is bound');
  if (!ISO_DATE.test(today)) throw new Error('ERPNext Fiscal Year: today is not a date');

  try {
    const currentYears = await yearServing(client, company, today);
    if (currentYears.length > 1) {
      return { state: 'operator', reason: 'ambiguous-overlap' };
    }
    if (currentYears.length === 0) {
      return { state: 'operator', reason: 'no-current-year' };
    }
    const current = currentYears[0];
    const isCurrentCompanyScoped = current.companies.includes(company);
    if (daysBetween(today, current.end) > leadDays) {
      return { state: 'not-due', current: current.name };
    }

    const span = nextYearSpan(current.end);
    const intersecting = await readYearsIntersecting(client, span.start, span.end);

    const candidates = intersecting.filter(
      (y) =>
        coversCompany(y, company) &&
        y.name !== current.name &&
        (!isCurrentCompanyScoped || y.companies.includes(company) || (y.start === span.start && y.end === span.end)),
    );

    const servingNextStart = candidates.filter((y) => containsDate(y, span.start));
    if (servingNextStart.length > 1) {
      return { state: 'operator', reason: 'ambiguous-overlap' };
    }
    if (servingNextStart.length === 1) {
      if (candidates.length > 1) {
        return { state: 'operator', reason: 'ambiguous-overlap' };
      }
      return { state: 'ready', current: current.name, next: servingNextStart[0].name };
    }

    const disabledExact = intersecting.find(
      (y) => y.disabled && y.start === span.start && y.end === span.end && coversCompany({ ...y, disabled: false }, company),
    );
    if (disabledExact) {
      return { state: 'operator', reason: 'disabled-year', year: disabledExact.name };
    }

    const plain = fiscalYearName(span);
    const taken = await nameTaken(client, plain);
    const yearName = taken ? companyFiscalYearName(span, company) : plain;

    return {
      state: 'create',
      current: current.name,
      start: span.start,
      end: span.end,
      yearName,
      isShortYear: erpFullYearEnd(span.start) !== span.end,
    };
  } catch (err) {
    if (err instanceof FiscalYearUndecidable) {
      return { state: 'operator', reason: 'ambiguous-overlap', message: erpReason(err) ?? err.message };
    }
    if (!(err instanceof ErpError) || err.code === 'external-unreachable') {
      throw err;
    }
    if (err.status === 403) {
      return { state: 'operator', reason: 'missing-role' };
    }
    return { state: 'operator', reason: 'ambiguous-overlap', message: erpReason(err) ?? undefined };
  }
}
