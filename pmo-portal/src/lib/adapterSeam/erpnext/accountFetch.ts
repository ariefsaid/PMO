import { erpnextRequest, type ErpClientDeps } from './client.ts';
import { AppError } from '../../appError.ts';

export interface StatementAccountSourceRow extends Record<string, unknown> {
  name: string;
  company: string;
  account_name: string;
  root_type: string;
  report_type: string;
  is_group: boolean;
  disabled: boolean;
  lft: number;
  rgt: number;
}

export interface AccountFetchOptions {
  company: string;
  pageSize?: number;
  maxPages?: number;
}

const ACCOUNT_FIELDS = [
  'name', 'company', 'account_name', 'root_type', 'report_type', 'parent_account', 'is_group',
  'account_number', 'account_currency', 'lft', 'rgt', 'account_type', 'include_in_gross', 'disabled', 'modified',
] as const;
const PAGE_SIZE = 500;
const MAX_PAGES = 1000;

function requiredText(row: Record<string, unknown>, field: string, index: number): string {
  const value = row[field];
  if (typeof value !== 'string' || !value.trim()) throw new AppError(`Malformed Account row ${index}: ${field} is required`, 'commit-rejected');
  return value;
}

function flag(value: unknown, field: string, index: number): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new AppError(`Malformed Account row ${index}: ${field} is invalid`, 'commit-rejected');
}

/** Fetch the entire current chart for one company. No modified cursor is used: moves and renames
 * must restate the complete hierarchy before the mirror is reconciled. */
export async function fetchStatementAccounts(client: ErpClientDeps, opts: AccountFetchOptions): Promise<StatementAccountSourceRow[]> {
  if (typeof opts.company !== 'string' || !opts.company.trim()) throw new AppError('ERPNext company is required for Account scan', 'config-rejected');
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  if (!Number.isInteger(pageSize) || pageSize < 1 || !Number.isInteger(maxPages) || maxPages < 1) {
    throw new AppError('Invalid Account scan page budget', 'config-rejected');
  }
  const rows: Record<string, unknown>[] = [];
  const filters = encodeURIComponent(JSON.stringify([['company', '=', opts.company]]));
  const fields = encodeURIComponent(JSON.stringify(ACCOUNT_FIELDS));
  for (let page = 0; page < maxPages; page += 1) {
    const path = `/api/resource/Account?filters=${filters}&fields=${fields}&limit_page_length=${pageSize}&limit_start=${page * pageSize}&order_by=${encodeURIComponent('lft asc, name asc')}`;
    const body = await erpnextRequest(client, { method: 'GET', path });
    const data = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) throw new AppError('Malformed Account page response', 'commit-rejected');
    if (data.length === 0) return normalizeRows(rows, opts.company);
    if (data.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new AppError('Malformed Account row', 'commit-rejected');
    rows.push(...data as Record<string, unknown>[]);
    if (data.length < pageSize) return normalizeRows(rows, opts.company);
  }
  throw new AppError(`Account scan exceeded ${maxPages} pages; chart is incomplete`, 'external-unreachable');
}

function normalizeRows(rows: Record<string, unknown>[], company: string): StatementAccountSourceRow[] {
  return rows.map((row, index) => {
    const name = requiredText(row, 'name', index);
    if (row.company !== company) throw new AppError(`Account ${name} is outside the requested company`, 'commit-rejected');
    const lft = Number(row.lft); const rgt = Number(row.rgt);
    if (!Number.isInteger(lft) || !Number.isInteger(rgt)) throw new AppError(`Malformed Account ${name}: nested-set bounds are invalid`, 'commit-rejected');
    return { ...row, name, company, account_name: requiredText(row, 'account_name', index), root_type: requiredText(row, 'root_type', index), report_type: requiredText(row, 'report_type', index), is_group: flag(row.is_group, 'is_group', index), disabled: flag(row.disabled, 'disabled', index), lft, rgt } as StatementAccountSourceRow;
  });
}
