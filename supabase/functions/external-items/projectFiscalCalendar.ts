import { erpnextRequest } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import type { ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { yearsInSpan, type FiscalYearSpan } from '../../../pmo-portal/src/lib/budget/budgetDistribution.ts';
import type { BudgetProjectDateBasis, BudgetProjectFiscalCalendar } from '../../../pmo-portal/src/lib/budget/budgetProjectFiscalCalendar.ts';

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_DETAILS = 1000;
const OPERATION_DEADLINE_MS = 15_000;

type StrictRecord = Record<string, unknown>;

class CalendarShapeError extends Error {}
class CalendarDeadlineError extends Error {}

function failShape(message: string): never {
  throw new CalendarShapeError(message);
}

function isRecord(value: unknown): value is StrictRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strictRecord(value: unknown, label: string): StrictRecord {
  if (!isRecord(value)) failShape(`Malformed ${label}`);
  return value;
}

function strictText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 140) failShape(`Invalid ${label}`);
  return value;
}

function strictList(body: unknown, label: string): unknown[] {
  const envelope = strictRecord(body, `${label} envelope`);
  if (!Object.prototype.hasOwnProperty.call(envelope, 'data') || !Array.isArray(envelope.data)) failShape(`Malformed ${label} envelope`);
  return envelope.data;
}

function strictDetail(body: unknown, label: string): StrictRecord {
  const envelope = strictRecord(body, `${label} envelope`);
  if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) failShape(`Malformed ${label} envelope`);
  return strictRecord(envelope.data, `${label} detail`);
}

function strictDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) failShape(`Invalid ${label}`);
  const [year, month, date] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) failShape(`Invalid ${label}`);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (date < 1 || date > days[month - 1]) failShape(`Invalid ${label}`);
  return value;
}

export function isValidProjectDateBasis(start: unknown, end: unknown): start is string {
  try {
    if (typeof start !== 'string') return false;
    strictDate(start, 'project start date');
    if (end !== null) {
      const strictEnd = strictDate(end, 'project end date');
      if (strictEnd < start) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function projectBasis(start: unknown, end: unknown): BudgetProjectDateBasis {
  return {
    start: typeof start === 'string' ? start : null,
    end: typeof end === 'string' ? end : null,
  };
}

function fiscalYearPath(name: string): string {
  return `/api/resource/Fiscal%20Year/${encodeURIComponent(name)}?fields=${encodeURIComponent(JSON.stringify([
    'name', 'disabled', 'year_start_date', 'year_end_date', 'companies',
  ]))}`;
}

function collectionPath(offset: number): string {
  const filters = [['disabled', '=', 0]];
  const fields = ['name'];
  return `/api/resource/Fiscal%20Year?filters=${encodeURIComponent(JSON.stringify(filters))}` +
    `&fields=${encodeURIComponent(JSON.stringify(fields))}` +
    `&order_by=${encodeURIComponent('name asc')}&limit_page_length=${PAGE_SIZE}&limit_start=${offset}`;
}

async function readCompleteCalendar(client: ErpClientDeps, company: string): Promise<FiscalYearSpan[]> {
  const deadlineAt = Date.now() + OPERATION_DEADLINE_MS;
  const read = async (path: string): Promise<unknown> => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new CalendarDeadlineError('Fiscal calendar deadline elapsed');
    return await erpnextRequest({ ...client, maxRetries: 0, timeoutMs: remaining }, { method: 'GET', path });
  };

  const names: string[] = [];
  const seen = new Set<string>();
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = strictList(await read(collectionPath(page * PAGE_SIZE)), 'Fiscal Year collection');
    if (rows.length > PAGE_SIZE) failShape('Fiscal Year page exceeded its bound');
    for (const row of rows) {
      const name = strictText(strictRecord(row, 'Fiscal Year collection row').name, 'Fiscal Year name');
      if (seen.has(name)) failShape('Duplicate Fiscal Year collection identity');
      seen.add(name);
      names.push(name);
    }
    if (rows.length < PAGE_SIZE) {
      complete = true;
      break;
    }
  }
  if (!complete || names.length > MAX_DETAILS) failShape('Fiscal Year collection is incomplete');

  const applicable: FiscalYearSpan[] = [];
  for (const name of names) {
    const detail = strictDetail(await read(fiscalYearPath(name)), 'Fiscal Year');
    if (detail.name !== name) failShape('Fiscal Year identity changed while reading');
    if (detail.disabled !== 0 && detail.disabled !== '0') failShape('Fiscal Year is no longer enabled');
    const start = strictDate(detail.year_start_date, 'Fiscal Year start');
    const end = strictDate(detail.year_end_date, 'Fiscal Year end');
    if (end < start) failShape('Fiscal Year end precedes its start');
    if (!Array.isArray(detail.companies)) failShape('Malformed Fiscal Year company links');
    const linkedCompanies = new Set<string>();
    for (const childValue of detail.companies) {
      const child = strictRecord(childValue, 'Fiscal Year company link');
      const childCompany = strictText(child.company, 'Fiscal Year linked company');
      if (linkedCompanies.has(childCompany)) failShape('Duplicate Fiscal Year company link');
      linkedCompanies.add(childCompany);
      if (Object.prototype.hasOwnProperty.call(child, 'doctype') && child.doctype !== 'Fiscal Year Company') failShape('Fiscal Year child doctype mismatch');
      if (Object.prototype.hasOwnProperty.call(child, 'parent') && child.parent !== name) failShape('Fiscal Year child parent mismatch');
      if (Object.prototype.hasOwnProperty.call(child, 'parenttype') && child.parenttype !== 'Fiscal Year') failShape('Fiscal Year child parent type mismatch');
      if (Object.prototype.hasOwnProperty.call(child, 'parentfield') && child.parentfield !== 'companies') failShape('Fiscal Year child parent field mismatch');
    }
    if (linkedCompanies.size === 0 || linkedCompanies.has(company)) applicable.push({ name, start, end });
  }

  applicable.sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end));
  for (let index = 1; index < applicable.length; index += 1) {
    if (applicable[index].start <= applicable[index - 1].end) failShape('Overlapping applicable Fiscal Year spans');
  }
  return applicable;
}

/** Reads a complete, bounded company calendar and returns only years covering this server-read project span. */
export async function readProjectFiscalCalendar(
  client: ErpClientDeps,
  company: string,
  start: unknown,
  end: unknown,
): Promise<BudgetProjectFiscalCalendar> {
  const project = projectBasis(start, end);
  if (!isValidProjectDateBasis(start, end)) return { status: 'bad-project-dates', project };

  try {
    const calendar = await readCompleteCalendar(client, company);
    let years: FiscalYearSpan[];
    try {
      years = yearsInSpan(start, end as string | null, calendar);
    } catch {
      throw new CalendarShapeError('Project dates are not covered by the Fiscal Year calendar');
    }
    return { status: 'resolved', project: { start, end: end as string | null }, years };
  } catch (error) {
    if (error instanceof CalendarShapeError) {
      return { status: 'unresolved', project };
    }
    if (error instanceof CalendarDeadlineError) return { status: 'unavailable', project };
    return { status: 'unavailable', project };
  }
}
