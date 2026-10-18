import type { Database, Json } from './supabase/database.types';

export type FinancialStatementPeriodKind = 'month' | 'quarter' | 'fiscal_year';
export type FinancialStatementKind = 'trial_balance' | 'profit_and_loss' | 'balance_sheet';
export type FinancialStatementRoundingMode = "Banker's Rounding" | "Banker's Rounding (legacy)" | 'Commercial Rounding';
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

type GeneratedFinancialStatementRow = Database['public']['Tables']['erp_financial_statement_snapshot']['Row'];
export type FinancialStatementTotalsPayload = {
  current: { income: string; expense: string; net: string };
  prior: { income: string; expense: string; net: string };
};
export type FinancialStatementRow = Omit<GeneratedFinancialStatementRow, 'payload' | 'raw_reports' | 'capture_started_at' | 'capture_completed_at'> & {
  payload: FinancialStatementNativePayload | FinancialStatementTotalsPayload;
  raw_reports: { current: string; prior: string } | null;
  capture_started_at: string;
  capture_completed_at: string;
};

const INVALID_ROW_MESSAGE = 'Invalid financial statement row.';
const ROW_KEYS = [
  'id',
  'org_id',
  'company',
  'snapshot_id',
  'source_generation',
  'statement',
  'scope_kind',
  'project_id',
  'view_kind',
  'period_kind',
  'current_start',
  'current_end',
  'prior_start',
  'prior_end',
  'currency',
  'as_of',
  'source_report',
  'report_version',
  'filters',
  'settings',
  'payload',
  'raw_reports',
  'capture_started_at',
  'capture_completed_at',
  'has_activity',
  'display_precision',
  'display_rounding_method',
] as const;
const AMOUNT_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;
const ROUNDING_METHODS = [
  "Banker's Rounding",
  "Banker's Rounding (legacy)",
  'Commercial Rounding',
] as const;
const STATEMENTS = ['trial_balance', 'profit_and_loss', 'balance_sheet'] as const;
const PERIOD_KINDS = ['month', 'quarter', 'fiscal_year'] as const;
const SCOPE_KINDS = ['company', 'project'] as const;
const VIEW_KINDS = ['account_breakdown', 'project_totals'] as const;

function reject(): never {
  throw new TypeError(INVALID_ROW_MESSAGE);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function recordValues(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return reject();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return reject();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return reject();
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value);
}

function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

function isRealTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match || !isRealDate(`${match[1]}-${match[2]}-${match[3]}`)) return false;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[8] !== 'Z') {
    const offsetHour = Number(match[10]);
    const offsetMinute = Number(match[11]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function addMonthsClamped(value: string, months: number): string {
  const match = DATE_PATTERN.exec(value);
  if (!match) return reject();
  const year = Number(match[1]);
  const month = Number(match[2]) - 1 + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(Number(match[3]), new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate());
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isFiscalPeriodRange(start: string, end: string, expectedMonths: number): boolean {
  if (!isRealDate(start) || !isRealDate(end) || start > end) return false;
  const nextStart = addMonthsClamped(start, expectedMonths);
  const endDate = new Date(`${nextStart}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return endDate.toISOString().slice(0, 10) === end;
}

function validPeriodPair(row: Record<string, unknown>): boolean {
  const currentStart = row.current_start;
  const currentEnd = row.current_end;
  const priorStart = row.prior_start;
  const priorEnd = row.prior_end;
  if (
    !isRealDate(currentStart) || !isRealDate(currentEnd) ||
    !isRealDate(priorStart) || !isRealDate(priorEnd) ||
    currentStart > currentEnd || priorStart > priorEnd
  ) return false;

  const monthCount = row.period_kind === 'month' ? 1 : row.period_kind === 'quarter' ? 3 : 12;
  const previousDay = new Date(`${currentStart}T00:00:00.000Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  return isFiscalPeriodRange(currentStart, currentEnd, monthCount) &&
    isFiscalPeriodRange(priorStart, priorEnd, monthCount) &&
    previousDay.toISOString().slice(0, 10) === priorEnd;
}

function copyJson(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : reject();
  if (typeof value !== 'object') return reject();
  if (ancestors.has(value)) return reject();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return reject();
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes('length')) return reject();
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return reject();
        copy.push(copyJson(descriptor.value, ancestors));
      }
      return copy;
    }

    if (!isPlainRecord(value)) return reject();
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return reject();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return reject();
      Object.defineProperty(copy, key, {
        value: copyJson(descriptor.value, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => sameJsonValue(item, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]));
}

function hasExactKeysWithOptional(
  value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

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

function nativeReportName(statement: string): string | null {
  if (statement === 'trial_balance') return 'Trial Balance';
  if (statement === 'profit_and_loss') return 'Profit and Loss Statement';
  if (statement === 'balance_sheet') return 'Balance Sheet';
  return null;
}

interface NativeReadPeriod {
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

function isNativePayload(
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

function isTotalsPayload(value: unknown): boolean {
  const payload = recordValues(value);
  if (!hasExactKeys(payload, ['current', 'prior'])) return false;
  for (const columnName of ['current', 'prior'] as const) {
    const column = recordValues(payload[columnName]);
    if (!hasExactKeys(column, ['income', 'expense', 'net'])) return false;
    if (!['income', 'expense', 'net'].every((key) => isAmount(column[key]))) return false;
  }
  return true;
}

function isNativeRawReports(value: unknown): boolean {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['current', 'prior'])) return false;
  return ['current', 'prior'].every((side) => typeof value[side] === 'string' &&
    new TextEncoder().encode(value[side] as string).byteLength <= 5 * 1024 * 1024);
}

function parseRow(value: unknown): FinancialStatementRow {
  const source = recordValues(value);
  if (!hasExactKeys(source, ROW_KEYS)) return reject();

  for (const key of ['id', 'org_id', 'snapshot_id', 'source_generation'] as const) {
    if (!isUuid(source[key])) return reject();
  }
  if (typeof source.company !== 'string' || source.company.trim() === '') return reject();
  if (source.project_id !== null && !isUuid(source.project_id)) return reject();
  if (typeof source.statement !== 'string' || !(STATEMENTS as readonly string[]).includes(source.statement)) return reject();
  if (typeof source.period_kind !== 'string' || !(PERIOD_KINDS as readonly string[]).includes(source.period_kind)) return reject();
  if (typeof source.scope_kind !== 'string' || !(SCOPE_KINDS as readonly string[]).includes(source.scope_kind)) return reject();
  if (typeof source.view_kind !== 'string' || !(VIEW_KINDS as readonly string[]).includes(source.view_kind)) return reject();
  if (source.currency !== 'IDR' || typeof source.has_activity !== 'boolean') return reject();
  if (typeof source.as_of !== 'string' || !isRealTimestamp(source.as_of) ||
      typeof source.capture_started_at !== 'string' || !isRealTimestamp(source.capture_started_at) ||
      typeof source.capture_completed_at !== 'string' || !isRealTimestamp(source.capture_completed_at) ||
      source.as_of !== source.capture_completed_at || Date.parse(source.capture_started_at) > Date.parse(source.capture_completed_at)) return reject();
  if (source.source_report !== null && typeof source.source_report !== 'string') return reject();
  if (source.report_version !== null && typeof source.report_version !== 'string') return reject();
  if (source.filters !== null) copyJson(source.filters);
  if (source.settings !== null) copyJson(source.settings);
  if (!Number.isInteger(source.display_precision) || (source.display_precision as number) < 0 || (source.display_precision as number) > 9) return reject();
  if (typeof source.display_rounding_method !== 'string' || !(ROUNDING_METHODS as readonly string[]).includes(source.display_rounding_method)) return reject();
  if (!validPeriodPair(source)) return reject();

  const isProject = source.scope_kind === 'project';
  if (isProject !== (source.project_id !== null)) return reject();
  if (source.scope_kind === 'company' && source.view_kind !== 'account_breakdown') return reject();
  if (source.scope_kind === 'project' && !(source.statement === 'profit_and_loss' && (source.view_kind === 'account_breakdown' || source.view_kind === 'project_totals'))) return reject();

  const copiedPayload = copyJson(source.payload);
  if (source.view_kind === 'project_totals') {
    if (
      source.source_report !== null || source.report_version !== null || source.filters !== null ||
      source.settings !== null || source.raw_reports !== null || !isTotalsPayload(copiedPayload)
    ) return reject();
  } else {
    const expectedPeriod: NativeReadPeriod = {
      kind: source.period_kind as string,
      currentStart: source.current_start as string,
      currentEnd: source.current_end as string,
      priorStart: source.prior_start as string,
      priorEnd: source.prior_end as string,
    };
    if (!isNativeRawReports(source.raw_reports) ||
        !isNativePayload(copiedPayload, source.statement, source.project_id as string | null, expectedPeriod, source.company) ||
        Date.parse(copiedPayload.current.provenance.acquiredAt) < Date.parse(source.capture_started_at as string) ||
        Date.parse(copiedPayload.current.provenance.acquiredAt) > Date.parse(source.capture_completed_at as string) ||
        Date.parse(copiedPayload.prior.provenance.acquiredAt) < Date.parse(source.capture_started_at as string) ||
        Date.parse(copiedPayload.prior.provenance.acquiredAt) > Date.parse(source.capture_completed_at as string) ||
        source.source_report !== nativeReportName(source.statement) ||
        source.report_version !== copiedPayload.current.profile.erpVersion ||
        !sameJsonValue(source.filters, {
          current: copiedPayload.current.provenance.filters,
          prior: copiedPayload.prior.provenance.filters,
        })) return reject();
  }

  const copiedFilters = source.filters === null ? null : copyJson(source.filters);
  const copiedSettings = source.settings === null ? null : copyJson(source.settings);
  return {
    id: source.id as string,
    org_id: source.org_id as string,
    company: source.company,
    snapshot_id: source.snapshot_id as string,
    source_generation: source.source_generation as string,
    statement: source.statement as string,
    scope_kind: source.scope_kind as string,
    project_id: source.project_id as string | null,
    view_kind: source.view_kind as string,
    period_kind: source.period_kind as string,
    current_start: source.current_start as string,
    current_end: source.current_end as string,
    prior_start: source.prior_start as string,
    prior_end: source.prior_end as string,
    currency: source.currency,
    as_of: source.as_of,
    source_report: source.source_report as string | null,
    report_version: source.report_version as string | null,
    filters: copiedFilters as FinancialStatementRow['filters'],
    settings: copiedSettings as FinancialStatementRow['settings'],
    payload: copiedPayload as FinancialStatementRow['payload'],
    raw_reports: source.raw_reports === null ? null : copyJson(source.raw_reports) as FinancialStatementRow['raw_reports'],
    capture_started_at: source.capture_started_at as string,
    capture_completed_at: source.capture_completed_at as string,
    has_activity: source.has_activity,
    display_precision: source.display_precision as number,
    display_rounding_method: source.display_rounding_method as string,
  };
}

export function parseFinancialStatementRow(value: unknown): FinancialStatementRow {
  try {
    return parseRow(value);
  } catch {
    throw new TypeError(INVALID_ROW_MESSAGE);
  }
}

export type FinancialStatementViewKind = 'account_breakdown' | 'project_totals';
export type FinancialStatementScopeKind = 'company' | 'project';

export interface StatementPresentation {
  precision: number;
  roundingMethod: FinancialStatementRoundingMode;
}

export interface FinancialStatementPair {
  kind: FinancialStatementPeriodKind;
  currentStart: string;
  currentEnd: string;
  priorStart: string;
  priorEnd: string;
}

export interface FinancialStatementScope {
  scopeKind: FinancialStatementScopeKind;
  projectId: string | null;
  statements: FinancialStatementKind[];
  viewKinds: FinancialStatementViewKind[];
}

export interface FinancialStatementGeneration {
  snapshotId: string;
  sourceGeneration: string;
  asOf: string;
  captureStartedAt: string;
  captureCompletedAt: string;
  currency: 'IDR';
  presentation: StatementPresentation;
  delayed: boolean;
}

export interface FinancialStatementCatalogue {
  state: 'unavailable' | 'complete';
  companyLabel: string | null;
  generation: FinancialStatementGeneration | null;
  periods: FinancialStatementPair[];
  scopes: FinancialStatementScope[];
}

export interface FinancialStatementSelection {
  periodKind: FinancialStatementPeriodKind;
  periodStart: string;
  statement: FinancialStatementKind;
  scopeKind: FinancialStatementScopeKind;
  projectId: string | null;
  viewKind: FinancialStatementViewKind;
}

export interface FinancialStatementDetailResult {
  viewKind: 'account_breakdown';
  period: FinancialStatementPair;
  hasActivity: boolean;
  payload: FinancialStatementNativePayload;
  provenance: {
    sourceReport: string | null;
    reportVersion: string | null;
    filters: Json | null;
    settings: Json | null;
  };
}

export interface FinancialStatementTotalsResult {
  viewKind: 'project_totals';
  period: FinancialStatementPair;
  hasActivity: boolean;
  payload: { current: { income: string; expense: string; net: string }; prior: { income: string; expense: string; net: string } };
}

export type FinancialStatementResult = FinancialStatementDetailResult | FinancialStatementTotalsResult;

export interface FinancialStatementRead {
  state: 'unavailable' | 'complete';
  companyLabel: string | null;
  generation: FinancialStatementGeneration | null;
  selection: FinancialStatementSelection;
  result: FinancialStatementResult | null;
}

const INVALID_ENVELOPE_MESSAGE = 'Invalid financial statement response.';
const STATEMENT_ORDER: readonly FinancialStatementKind[] = ['trial_balance', 'profit_and_loss', 'balance_sheet'];
const VIEW_ORDER: readonly FinancialStatementViewKind[] = ['account_breakdown', 'project_totals'];
const SCOPE_ORDER: readonly FinancialStatementScopeKind[] = ['company', 'project'];

function envelopeRecord(value: unknown): Record<string, unknown> {
  return recordValues(value);
}

function requireKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (!hasExactKeys(value, expected)) reject();
}

function isStatementKind(value: unknown): value is FinancialStatementKind {
  return typeof value === 'string' && (STATEMENTS as readonly string[]).includes(value);
}

function isPeriodKind(value: unknown): value is FinancialStatementPeriodKind {
  return typeof value === 'string' && (PERIOD_KINDS as readonly string[]).includes(value);
}

function isScopeKind(value: unknown): value is FinancialStatementScopeKind {
  return typeof value === 'string' && (SCOPE_KINDS as readonly string[]).includes(value);
}

function isViewKind(value: unknown): value is FinancialStatementViewKind {
  return typeof value === 'string' && (VIEW_KINDS as readonly string[]).includes(value);
}

function parsePresentation(value: unknown): StatementPresentation {
  const presentation = envelopeRecord(value);
  requireKeys(presentation, ['precision', 'roundingMethod']);
  if (!Number.isInteger(presentation.precision) || (presentation.precision as number) < 0 || (presentation.precision as number) > 9) reject();
  if (typeof presentation.roundingMethod !== 'string' || !(ROUNDING_METHODS as readonly string[]).includes(presentation.roundingMethod)) reject();
  return { precision: presentation.precision as number, roundingMethod: presentation.roundingMethod as FinancialStatementRoundingMode };
}

function parseGeneration(value: unknown): FinancialStatementGeneration {
  const generation = envelopeRecord(value);
  requireKeys(generation, ['snapshotId', 'sourceGeneration', 'asOf', 'captureStartedAt', 'captureCompletedAt', 'currency', 'presentation', 'delayed']);
  if (!isUuid(generation.snapshotId) || !isUuid(generation.sourceGeneration) ||
      !isRealTimestamp(generation.asOf) || !isRealTimestamp(generation.captureStartedAt) ||
      !isRealTimestamp(generation.captureCompletedAt) || generation.asOf !== generation.captureCompletedAt ||
      Date.parse(generation.captureStartedAt) > Date.parse(generation.captureCompletedAt) ||
      generation.currency !== 'IDR' || typeof generation.delayed !== 'boolean') reject();
  return {
    snapshotId: generation.snapshotId,
    sourceGeneration: generation.sourceGeneration,
    asOf: generation.asOf,
    captureStartedAt: generation.captureStartedAt,
    captureCompletedAt: generation.captureCompletedAt,
    currency: 'IDR',
    presentation: parsePresentation(generation.presentation),
    delayed: generation.delayed,
  };
}

function parsePair(value: unknown): FinancialStatementPair {
  const pair = envelopeRecord(value);
  requireKeys(pair, ['kind', 'currentStart', 'currentEnd', 'priorStart', 'priorEnd']);
  if (!isPeriodKind(pair.kind)) reject();
  if (![pair.currentStart, pair.currentEnd, pair.priorStart, pair.priorEnd].every(isRealDate)) reject();
  const duration = pair.kind === 'month' ? 1 : pair.kind === 'quarter' ? 3 : 12;
  const currentStart = pair.currentStart as string;
  const currentEnd = pair.currentEnd as string;
  const priorStart = pair.priorStart as string;
  const priorEnd = pair.priorEnd as string;
  const dayBeforeCurrent = new Date(`${currentStart}T00:00:00.000Z`);
  dayBeforeCurrent.setUTCDate(dayBeforeCurrent.getUTCDate() - 1);
  if (!isFiscalPeriodRange(currentStart, currentEnd, duration) ||
      !isFiscalPeriodRange(priorStart, priorEnd, duration) ||
      dayBeforeCurrent.toISOString().slice(0, 10) !== priorEnd) reject();
  return {
    kind: pair.kind,
    currentStart: pair.currentStart as string,
    currentEnd: pair.currentEnd as string,
    priorStart: pair.priorStart as string,
    priorEnd: pair.priorEnd as string,
  };
}

function parseCompanyLabel(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') reject();
  return value;
}

function parseSelection(value: unknown): FinancialStatementSelection {
  const selection = envelopeRecord(value);
  requireKeys(selection, ['periodKind', 'periodStart', 'statement', 'scopeKind', 'projectId', 'viewKind']);
  if (!isPeriodKind(selection.periodKind) || !isRealDate(selection.periodStart) || !isStatementKind(selection.statement) || !isScopeKind(selection.scopeKind) || !isViewKind(selection.viewKind)) reject();
  if (selection.projectId !== null && !isUuid(selection.projectId)) reject();
  if ((selection.scopeKind === 'project') !== (selection.projectId !== null)) reject();
  if (selection.scopeKind === 'company' && selection.viewKind !== 'account_breakdown') reject();
  if (selection.scopeKind === 'project' && (selection.statement !== 'profit_and_loss' || !['account_breakdown', 'project_totals'].includes(selection.viewKind as string))) reject();
  return {
    periodKind: selection.periodKind,
    periodStart: selection.periodStart as string,
    statement: selection.statement,
    scopeKind: selection.scopeKind,
    projectId: selection.projectId as string | null,
    viewKind: selection.viewKind,
  };
}

function statementOrderIndex(value: FinancialStatementKind): number {
  return STATEMENT_ORDER.indexOf(value);
}

function viewOrderIndex(value: FinancialStatementViewKind): number {
  return VIEW_ORDER.indexOf(value);
}

function parseScope(value: unknown): FinancialStatementScope {
  const scope = envelopeRecord(value);
  requireKeys(scope, ['scopeKind', 'projectId', 'statements', 'viewKinds']);
  if (!isScopeKind(scope.scopeKind) || (scope.projectId !== null && !isUuid(scope.projectId))) reject();
  if ((scope.scopeKind === 'project') !== (scope.projectId !== null)) reject();
  if (!Array.isArray(scope.statements) || scope.statements.length === 0 || !scope.statements.every(isStatementKind)) reject();
  if (!Array.isArray(scope.viewKinds) || scope.viewKinds.length === 0 || !scope.viewKinds.every(isViewKind)) reject();
  const statements = [...scope.statements] as FinancialStatementKind[];
  const viewKinds = [...scope.viewKinds] as FinancialStatementViewKind[];
  if (new Set(statements).size !== statements.length || statements.some((item, index) => index > 0 && statementOrderIndex(statements[index - 1]!) >= statementOrderIndex(item))) reject();
  if (new Set(viewKinds).size !== viewKinds.length || viewKinds.some((item, index) => index > 0 && viewOrderIndex(viewKinds[index - 1]!) >= viewOrderIndex(item))) reject();
  if (scope.scopeKind === 'company' && viewKinds.some((kind) => kind !== 'account_breakdown')) reject();
  if (scope.scopeKind === 'project' && (statements.length !== 1 || statements[0] !== 'profit_and_loss')) reject();
  return { scopeKind: scope.scopeKind, projectId: scope.projectId as string | null, statements, viewKinds };
}

function validateCatalogueOrder(periods: readonly FinancialStatementPair[], scopes: readonly FinancialStatementScope[]): void {
  const periodKeys = new Set<string>();
  const currentKeys = new Set<string>();
  const kindOrder: Record<FinancialStatementPeriodKind, number> = { month: 0, quarter: 1, fiscal_year: 2 };
  for (let index = 0; index < periods.length; index += 1) {
    const pair = periods[index]!;
    const key = `${pair.kind}|${pair.currentStart}|${pair.currentEnd}|${pair.priorStart}|${pair.priorEnd}`;
    const currentKey = `${pair.kind}|${pair.currentStart}`;
    if (periodKeys.has(key) || currentKeys.has(currentKey)) reject();
    periodKeys.add(key);
    currentKeys.add(currentKey);
    if (index > 0) {
      const previous = periods[index - 1]!;
      if (previous.currentStart > pair.currentStart || (previous.currentStart === pair.currentStart && kindOrder[previous.kind] >= kindOrder[pair.kind])) reject();
    }
  }
  const scopeKeys = new Set<string>();
  for (let index = 0; index < scopes.length; index += 1) {
    const scope = scopes[index]!;
    const key = `${scope.scopeKind}|${scope.projectId ?? ''}`;
    if (scopeKeys.has(key)) reject();
    scopeKeys.add(key);
    if (index > 0) {
      const previous = scopes[index - 1]!;
      const previousRank = SCOPE_ORDER.indexOf(previous.scopeKind);
      const rank = SCOPE_ORDER.indexOf(scope.scopeKind);
      if (previousRank > rank || (previous.scopeKind === 'project' && scope.scopeKind === 'project' && previous.projectId! >= scope.projectId!)) reject();
    }
  }
}

export function parseFinancialStatementCatalogue(value: unknown): FinancialStatementCatalogue {
  try {
    const catalogue = envelopeRecord(value);
    requireKeys(catalogue, ['state', 'companyLabel', 'generation', 'periods', 'scopes']);
    if (catalogue.state !== 'unavailable' && catalogue.state !== 'complete') reject();
    const companyLabel = parseCompanyLabel(catalogue.companyLabel);
    const generation = catalogue.generation === null ? null : parseGeneration(catalogue.generation);
    if (!Array.isArray(catalogue.periods) || !Array.isArray(catalogue.scopes)) reject();
    const periods = catalogue.periods.map(parsePair);
    const scopes = catalogue.scopes.map(parseScope);
    validateCatalogueOrder(periods, scopes);
    if (catalogue.state === 'unavailable') {
      if (generation !== null || periods.length !== 0 || scopes.length !== 0) reject();
    } else if (generation === null || periods.length === 0 || scopes.length === 0) reject();
    return { state: catalogue.state, companyLabel, generation, periods, scopes };
  } catch {
    throw new TypeError(INVALID_ENVELOPE_MESSAGE);
  }
}

function sameSelection(left: FinancialStatementSelection, right: FinancialStatementSelection): boolean {
  return left.periodKind === right.periodKind && left.periodStart === right.periodStart && left.statement === right.statement &&
    left.scopeKind === right.scopeKind && left.projectId === right.projectId && left.viewKind === right.viewKind;
}

export function parseFinancialStatementRead(value: unknown, expected: FinancialStatementSelection): FinancialStatementRead {
  try {
    const read = envelopeRecord(value);
    requireKeys(read, ['state', 'companyLabel', 'generation', 'selection', 'result']);
    if (read.state !== 'unavailable' && read.state !== 'complete') reject();
    const companyLabel = parseCompanyLabel(read.companyLabel);
    const generation = read.generation === null ? null : parseGeneration(read.generation);
    const selection = parseSelection(read.selection);
    if (!sameSelection(selection, parseSelection(expected))) reject();
    let result: FinancialStatementResult | null = null;
    if (read.result !== null) {
      const raw = envelopeRecord(read.result);
      if (raw.viewKind === 'account_breakdown') {
        requireKeys(raw, ['viewKind', 'period', 'hasActivity', 'payload', 'provenance']);
        if (typeof raw.hasActivity !== 'boolean') reject();
        const period = parsePair(raw.period);
        if (period.kind !== selection.periodKind || period.currentStart !== selection.periodStart || selection.viewKind !== 'account_breakdown') reject();
        const expectedNativePeriod: NativeReadPeriod = {
          kind: period.kind, currentStart: period.currentStart, currentEnd: period.currentEnd,
          priorStart: period.priorStart, priorEnd: period.priorEnd,
        };
        if (!isNativePayload(raw.payload, selection.statement, selection.projectId, expectedNativePeriod)) reject();
        const provenance = envelopeRecord(raw.provenance);
        requireKeys(provenance, ['sourceReport', 'reportVersion', 'filters', 'settings']);
        if ((provenance.sourceReport !== null && typeof provenance.sourceReport !== 'string') ||
            (provenance.reportVersion !== null && typeof provenance.reportVersion !== 'string')) reject();
        if (provenance.filters !== null) copyJson(provenance.filters);
        if (provenance.settings !== null) copyJson(provenance.settings);
        if (provenance.sourceReport !== raw.payload.current.reportName ||
            provenance.reportVersion !== raw.payload.current.profile.erpVersion ||
            !sameJsonValue(provenance.filters, {
              current: raw.payload.current.provenance.filters,
              prior: raw.payload.prior.provenance.filters,
            })) reject();
        if (generation === null ||
            Date.parse(raw.payload.current.provenance.acquiredAt) < Date.parse(generation.captureStartedAt) ||
            Date.parse(raw.payload.current.provenance.acquiredAt) > Date.parse(generation.captureCompletedAt) ||
            Date.parse(raw.payload.prior.provenance.acquiredAt) < Date.parse(generation.captureStartedAt) ||
            Date.parse(raw.payload.prior.provenance.acquiredAt) > Date.parse(generation.captureCompletedAt)) reject();
        result = {
          viewKind: 'account_breakdown', period, hasActivity: raw.hasActivity,
          payload: copyJson(raw.payload) as FinancialStatementNativePayload,
          provenance: {
            sourceReport: provenance.sourceReport as string | null,
            reportVersion: provenance.reportVersion as string | null,
            filters: provenance.filters === null ? null : copyJson(provenance.filters) as Json,
            settings: provenance.settings === null ? null : copyJson(provenance.settings) as Json,
          },
        };
      } else if (raw.viewKind === 'project_totals') {
        requireKeys(raw, ['viewKind', 'period', 'hasActivity', 'payload']);
        if (typeof raw.hasActivity !== 'boolean' || selection.viewKind !== 'project_totals' || selection.scopeKind !== 'project') reject();
        const period = parsePair(raw.period);
        if (period.kind !== selection.periodKind || period.currentStart !== selection.periodStart || !isTotalsPayload(raw.payload)) reject();
        const totals = envelopeRecord(raw.payload);
        const current = envelopeRecord(totals.current);
        const prior = envelopeRecord(totals.prior);
        result = {
          viewKind: 'project_totals', period, hasActivity: raw.hasActivity,
          payload: {
            current: { income: current.income as string, expense: current.expense as string, net: current.net as string },
            prior: { income: prior.income as string, expense: prior.expense as string, net: prior.net as string },
          },
        };
      } else reject();
    }
    if (read.state === 'complete') {
      if (generation === null || result === null) reject();
    } else if (result !== null) reject();
    return { state: read.state, companyLabel, generation, selection, result };
  } catch {
    throw new TypeError(INVALID_ENVELOPE_MESSAGE);
  }
}
