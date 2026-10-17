import { erpnextRequest } from './client.ts';
import type { ErpClientDeps } from './client.ts';
import { AppError } from '../../appError.ts';

export interface StatementFiscalYear { name: string; start: string; end: string }
export interface StatementMetadata {
  currency: 'IDR';
  defaultFinanceBook: string | null;
  calendar: StatementFiscalYear[];
  precision: number;
  floatPrecision: number;
  roundingMethod: "Banker's Rounding" | "Banker's Rounding (legacy)" | 'Commercial Rounding';
  zeroCutoff: string;
  ignoreOpeningCheck: boolean;
  ignoreAccountClosingBalance: boolean;
}

function objectData(body: unknown, label: string): Record<string, unknown> {
  const data = (body as { data?: unknown } | null)?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError(`Malformed ${label} metadata`, 'commit-rejected');
  return data as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new AppError(`Missing ${label} metadata`, 'commit-rejected');
  return value;
}
function integer(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9) throw new AppError(`Invalid ${label} metadata`, 'commit-rejected');
  return parsed;
}
function bool(value: unknown, label: string): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new AppError(`Invalid ${label} metadata`, 'commit-rejected');
}
function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new AppError(`Invalid ${label} metadata`, 'commit-rejected');
  return value;
}

async function getResource(client: ErpClientDeps, doctype: string, name: string, fields: string[]): Promise<Record<string, unknown>> {
  const path = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}?fields=${encodeURIComponent(JSON.stringify(fields))}`;
  return objectData(await erpnextRequest(client, { method: 'GET', path }), doctype);
}

/** Reads and validates the ERP-owned company/calendar/report settings required by statement source. */
export async function fetchStatementMetadata(client: ErpClientDeps, opts: { company: string }): Promise<StatementMetadata> {
  const company = await getResource(client, 'Company', opts.company, ['name', 'default_currency', 'default_finance_book']);
  const currency = text(company.default_currency, 'Company currency');
  if (currency !== 'IDR') throw new AppError('Financial statements require IDR company currency', 'config-rejected');
  const fiscalPath = `/api/resource/Fiscal%20Year?filters=${encodeURIComponent(JSON.stringify([['disabled', '=', 0]]))}&fields=${encodeURIComponent(JSON.stringify(['name', 'year_start_date', 'year_end_date']))}&limit_page_length=500&order_by=${encodeURIComponent('year_start_date asc, name asc')}`;
  const fiscalBody = await erpnextRequest(client, { method: 'GET', path: fiscalPath });
  const fiscalRows = (fiscalBody as { data?: unknown } | null)?.data;
  if (!Array.isArray(fiscalRows) || fiscalRows.length === 0) throw new AppError('Missing applicable Fiscal Year metadata', 'commit-rejected');
  const calendar = fiscalRows.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('Malformed Fiscal Year metadata', 'commit-rejected');
    const row = raw as Record<string, unknown>;
    const start = date(row.year_start_date, 'Fiscal Year start'); const end = date(row.year_end_date, 'Fiscal Year end');
    if (start > end) throw new AppError('Invalid Fiscal Year date range', 'commit-rejected');
    return { name: text(row.name, 'Fiscal Year name'), start, end };
  });
  for (let i = 1; i < calendar.length; i += 1) if (calendar[i - 1].end >= calendar[i].start) throw new AppError('Overlapping Fiscal Year calendar', 'commit-rejected');
  const [accounts, system, currencyDoc] = await Promise.all([
    getResource(client, 'Accounts Settings', 'Accounts Settings', ['ignore_is_opening_check', 'ignore_account_closing_balance']),
    getResource(client, 'System Settings', 'System Settings', ['currency_precision', 'float_precision', 'rounding_method']),
    getResource(client, 'Currency', currency, ['name', 'smallest_currency_fraction_value']),
  ]);
  // Frappe v16's System Settings defaults: currency_precision=2, float_precision=3,
  // rounding_method=Banker's Rounding. Blank ERPNext fields mean these defaults, not bad metadata.
  // Source: https://github.com/frappe/frappe/blob/version-16/frappe/core/doctype/system_settings/system_settings.json
  const precision = system.currency_precision == null || system.currency_precision === '' ? 2 : integer(system.currency_precision, 'currency precision');
  const floatPrecision = system.float_precision == null || system.float_precision === '' ? 3 : integer(system.float_precision, 'float precision');
  const roundingMethod = system.rounding_method == null || system.rounding_method === '' ? "Banker's Rounding" : text(system.rounding_method, 'rounding method');
  if (!['Banker\'s Rounding', "Banker's Rounding (legacy)", 'Commercial Rounding'].includes(roundingMethod)) throw new AppError('Unsupported rounding method', 'config-rejected');
  const fractionValue = currencyDoc.smallest_currency_fraction_value;
  if (typeof fractionValue !== 'number' && typeof fractionValue !== 'string') throw new AppError('Missing currency precision/cutoff metadata', 'commit-rejected');
  const fractionUnits = Number(fractionValue);
  if (!Number.isFinite(fractionUnits) || fractionUnits <= 0) throw new AppError('Invalid currency precision/cutoff metadata', 'commit-rejected');
  const cutoff = 0.5 / fractionUnits;
  return {
    currency: 'IDR', defaultFinanceBook: typeof company.default_finance_book === 'string' && company.default_finance_book ? company.default_finance_book : null,
    calendar, precision, floatPrecision, roundingMethod: roundingMethod as StatementMetadata['roundingMethod'],
    zeroCutoff: cutoff.toFixed(Math.max(precision + 1, 1)),
    ignoreOpeningCheck: bool(accounts.ignore_is_opening_check, 'ignore opening check'),
    ignoreAccountClosingBalance: bool(accounts.ignore_account_closing_balance, 'ignore account closing balance'),
  };
}
