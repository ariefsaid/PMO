// Native ERPNext report validation and wire types: the strict contract for the
// `current`/`prior` report pair stored on snapshot rows and returned by read
// envelopes. Shared row/envelope primitives come from ./validation.
import type { Json } from '../supabase/database.types';
import {
  copyJson,
  hasExactKeys,
  hasExactKeysWithOptional,
  isAmount,
  isPlainRecord,
  isRealDate,
  isRealTimestamp,
  recordValues,
  sameJsonValue,
} from './validation';

export type FinancialStatementNativeScalar = string | number | boolean | null;

export interface FinancialStatementNativeReportPeriod {
  fromDate: string;
  toDate: string;
  fromFiscalYear: string;
  toFiscalYear: string;
  kind: 'month' | 'quarter' | 'year';
  columnLabel?: string;
}

export interface FinancialStatementNativeReport {
  reportName: 'Trial Balance' | 'Profit and Loss Statement' | 'Balance Sheet';
  company: string;
  side: 'current' | 'prior';
  period: FinancialStatementNativeReportPeriod;
  periodPair: { current: FinancialStatementNativeReportPeriod; prior: FinancialStatementNativeReportPeriod };
  project: { projectId: string; erpProjectName: string } | null;
  language: string;
  profile: { erpVersion: string; frappeVersion: string };
  columns: Array<{ fieldname: string; label: string; type: 'text' | 'currency'; width?: number; hidden?: boolean }>;
  rows: Array<Record<string, FinancialStatementNativeScalar>>;
  summary: Array<Record<string, FinancialStatementNativeScalar>> | null;
  provenance: {
    endpoint: '/api/method/frappe.desk.query_report.run';
    method: 'GET';
    ignorePreparedReport: 1;
    rawSha256: string;
    acquiredAt: string;
    filters: Record<string, Json>;
  };
}

export interface FinancialStatementNativePayload {
  current: FinancialStatementNativeReport;
  prior: FinancialStatementNativeReport;
}

export type FinancialStatementTotalsPayload = {
  current: { income: string; expense: string; net: string };
  prior: { income: string; expense: string; net: string };
};

function isNativeScalar(value: unknown): value is FinancialStatementNativeScalar {
  return value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
}

function isNativeScalarRecord(value: unknown, maxFields: number): value is Record<string, FinancialStatementNativeScalar> {
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= maxFields && entries.every(([key, cell]) => key.length > 0 && key.length <= 128 && isNativeScalar(cell));
}

function isNativeReportPeriod(value: unknown): value is FinancialStatementNativeReportPeriod {
  if (!isPlainRecord(value) || !hasExactKeysWithOptional(
    value, ['fromDate', 'toDate', 'fromFiscalYear', 'toFiscalYear', 'kind'], ['columnLabel'],
  )) return false;
  return isRealDate(value.fromDate) && isRealDate(value.toDate) && value.fromDate <= value.toDate &&
    typeof value.fromFiscalYear === 'string' && value.fromFiscalYear.trim() !== '' &&
    typeof value.toFiscalYear === 'string' && value.toFiscalYear.trim() !== '' &&
    ['month', 'quarter', 'year'].includes(String(value.kind)) &&
    (!Object.hasOwn(value, 'columnLabel') || (typeof value.columnLabel === 'string' && value.columnLabel.trim() !== ''));
}

function sameNativePeriod(left: FinancialStatementNativeReportPeriod, right: FinancialStatementNativeReportPeriod): boolean {
  return left.fromDate === right.fromDate && left.toDate === right.toDate &&
    left.fromFiscalYear === right.fromFiscalYear && left.toFiscalYear === right.toFiscalYear &&
    left.kind === right.kind && left.columnLabel === right.columnLabel;
}

export function nativeReportName(statement: string): string | null {
  if (statement === 'trial_balance') return 'Trial Balance';
  if (statement === 'profit_and_loss') return 'Profit and Loss Statement';
  if (statement === 'balance_sheet') return 'Balance Sheet';
  return null;
}

export interface NativeReadPeriod {
  kind: string;
  currentStart: string;
  currentEnd: string;
  priorStart: string;
  priorEnd: string;
}

function isNativeReport(
  value: unknown,
  side: 'current' | 'prior',
  statement: string,
  projectId: string | null,
  expectedPeriod?: NativeReadPeriod,
  expectedCompany?: string,
): value is FinancialStatementNativeReport {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'reportName', 'company', 'side', 'period', 'periodPair', 'project', 'language', 'profile',
    'columns', 'rows', 'summary', 'provenance',
  ])) return false;
  const reportName = nativeReportName(statement);
  if (reportName === null || value.reportName !== reportName || value.side !== side ||
      typeof value.company !== 'string' || value.company.trim() === '' ||
      (expectedCompany !== undefined && value.company !== expectedCompany)) return false;

  if (!isNativeReportPeriod(value.period) || !isPlainRecord(value.periodPair) ||
      !hasExactKeys(value.periodPair, ['current', 'prior']) ||
      !isNativeReportPeriod(value.periodPair.current) || !isNativeReportPeriod(value.periodPair.prior)) return false;
  const currentPeriod = value.periodPair.current;
  const priorPeriod = value.periodPair.prior;
  const expectedKind = expectedPeriod?.kind === 'fiscal_year' ? 'year' : expectedPeriod?.kind;
  if (expectedPeriod && (currentPeriod.kind !== expectedKind || priorPeriod.kind !== expectedKind)) return false;
  if (expectedPeriod && (currentPeriod.fromDate !== expectedPeriod.currentStart || currentPeriod.toDate !== expectedPeriod.currentEnd ||
      priorPeriod.fromDate !== expectedPeriod.priorStart || priorPeriod.toDate !== expectedPeriod.priorEnd)) return false;
  const selectedPeriod = side === 'current' ? currentPeriod : priorPeriod;
  if (!sameNativePeriod(value.period, selectedPeriod)) return false;

  if (projectId === null) {
    if (value.project !== null) return false;
  } else if (!isPlainRecord(value.project) || !hasExactKeys(value.project, ['projectId', 'erpProjectName']) ||
      value.project.projectId !== projectId || typeof value.project.erpProjectName !== 'string' || value.project.erpProjectName.trim() === '') {
    return false;
  }
  if (typeof value.language !== 'string' || !/^[A-Za-z]{1,8}(?:[-_][A-Za-z0-9]{1,8})*$/.test(value.language)) return false;
  if (!isPlainRecord(value.profile) || !hasExactKeys(value.profile, ['erpVersion', 'frappeVersion']) ||
      typeof value.profile.erpVersion !== 'string' || value.profile.erpVersion.trim() === '' ||
      typeof value.profile.frappeVersion !== 'string' || value.profile.frappeVersion.trim() === '') return false;

  if (!Array.isArray(value.columns) || value.columns.length === 0 || value.columns.length > 256) return false;
  const fieldnames = new Set<string>();
  for (const rawColumn of value.columns) {
    if (!isPlainRecord(rawColumn) || !hasExactKeysWithOptional(rawColumn, ['fieldname', 'label', 'type'], ['width', 'hidden']) ||
        typeof rawColumn.fieldname !== 'string' || rawColumn.fieldname.trim() === '' || fieldnames.has(rawColumn.fieldname) ||
        typeof rawColumn.label !== 'string' || rawColumn.label.trim() === '' ||
        (rawColumn.type !== 'text' && rawColumn.type !== 'currency') ||
        (Object.hasOwn(rawColumn, 'width') && (!Number.isInteger(rawColumn.width) || (rawColumn.width as number) < 1 || (rawColumn.width as number) > 2_000)) ||
        (Object.hasOwn(rawColumn, 'hidden') && typeof rawColumn.hidden !== 'boolean')) return false;
    fieldnames.add(rawColumn.fieldname);
  }
  if (!Array.isArray(value.rows) || value.rows.length > 50_000 ||
      !value.rows.every((row) => isNativeScalarRecord(row, 512))) return false;
  const currencyFields = new Set(value.columns.filter((column) => column.type === 'currency').map((column) => column.fieldname));
  for (const rawRow of value.rows) {
    for (const field of currencyFields) {
      if (Object.hasOwn(rawRow, field) && rawRow[field] !== null && !isAmount(rawRow[field])) return false;
    }
  }
  if (value.summary !== null && (!Array.isArray(value.summary) || value.summary.length > 100 ||
      !value.summary.every((item) => isNativeScalarRecord(item, 512)))) return false;

  if (!isPlainRecord(value.provenance) || !hasExactKeys(value.provenance, [
    'endpoint', 'method', 'ignorePreparedReport', 'rawSha256', 'acquiredAt', 'filters',
  ]) || value.provenance.endpoint !== '/api/method/frappe.desk.query_report.run' ||
      value.provenance.method !== 'GET' || value.provenance.ignorePreparedReport !== 1 ||
      typeof value.provenance.rawSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.provenance.rawSha256) ||
      !isRealTimestamp(value.provenance.acquiredAt) || !isPlainRecord(value.provenance.filters)) return false;
  copyJson(value.provenance.filters);
  return true;
}

export function isNativePayload(
  value: unknown,
  statement: string,
  projectId: string | null,
  expectedPeriod?: NativeReadPeriod,
  expectedCompany?: string,
): value is FinancialStatementNativePayload {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['current', 'prior'])) return false;
  if (!isNativeReport(value.current, 'current', statement, projectId, expectedPeriod, expectedCompany) ||
      !isNativeReport(value.prior, 'prior', statement, projectId, expectedPeriod, expectedCompany)) return false;
  return value.current.company === value.prior.company &&
    sameNativePeriod(value.current.periodPair.current, value.prior.periodPair.current) &&
    sameNativePeriod(value.current.periodPair.prior, value.prior.periodPair.prior) &&
    sameJsonValue(value.current.project, value.prior.project) &&
    sameJsonValue(value.current.profile, value.prior.profile) &&
    value.current.language === value.prior.language;
}

export function isTotalsPayload(value: unknown): boolean {
  const payload = recordValues(value);
  if (!hasExactKeys(payload, ['current', 'prior'])) return false;
  for (const columnName of ['current', 'prior'] as const) {
    const column = recordValues(payload[columnName]);
    if (!hasExactKeys(column, ['income', 'expense', 'net'])) return false;
    if (!['income', 'expense', 'net'].every((key) => isAmount(column[key]))) return false;
  }
  return true;
}

export function isNativeRawReports(value: unknown): boolean {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['current', 'prior'])) return false;
  return ['current', 'prior'].every((side) => typeof value[side] === 'string' &&
    new TextEncoder().encode(value[side] as string).byteLength <= 5 * 1024 * 1024);
}
