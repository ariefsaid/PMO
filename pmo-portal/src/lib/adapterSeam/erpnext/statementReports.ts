import { AppError } from '../../appError.ts';
import { erpnextRequest, isFinancialDecimalTextResponse, type ErpClientDeps, type FinancialDecimalTextResponse } from './client.ts';
import { statementRequestFetch, type StatementPublicationContext, type StatementPublicationMetadata, type StatementVersionProfile } from './statementMetadata.ts';

export type StatementReportName = 'Trial Balance' | 'Profit and Loss Statement' | 'Balance Sheet';
export type StatementPeriodKind = 'month' | 'quarter' | 'year';
export type StatementReportSide = 'current' | 'prior';

/** A period pair resolved against the binding's validated fiscal calendar. */
export interface StatementReportPeriod {
  fromDate: string;
  toDate: string;
  fromFiscalYear: string;
  toFiscalYear: string;
  kind: StatementPeriodKind;
  /** Optional compatibility hint; native translated labels are authoritative display text, not identity. */
  columnLabel?: string;
}

export interface StatementReportSelection {
  reportName: StatementReportName;
  company: string;
  side: StatementReportSide;
  periods: { current: StatementReportPeriod; prior: StatementReportPeriod };
  /** Supplied mapping only; project filters are legal only for native project P&L. */
  project?: { projectId: string; erpProjectName: string };
}

export interface StatementReportContext {
  profile: StatementVersionProfile;
  metadata: StatementPublicationMetadata;
  publicationContext: StatementPublicationContext;
}

export type NativeReportScalar = string | number | boolean | null;
export interface NativeReportColumn {
  readonly reportName: StatementReportName;
  readonly company: string;
  readonly side: StatementReportSide;
  readonly period: Readonly<StatementReportPeriod>;
  readonly periodPair: Readonly<{ current: StatementReportPeriod; prior: StatementReportPeriod }>;
  readonly project: Readonly<{ projectId: string; erpProjectName: string }> | null;
  readonly language: string;
  readonly profile: Readonly<StatementVersionProfile>;
  readonly columns: readonly {
    fieldname: string;
    label: string;
    type: 'text' | 'currency';
    width?: number;
    hidden?: boolean;
  }[];
  readonly rows: readonly Readonly<Record<string, NativeReportScalar>>[];
  readonly summary: readonly Readonly<Record<string, NativeReportScalar>>[] | null;
  readonly provenance: {
    endpoint: '/api/method/frappe.desk.query_report.run';
    method: 'GET';
    ignorePreparedReport: 1;
    rawSha256: string;
    acquiredAt: string;
    filters: Readonly<Record<string, unknown>>;
  };
}

export interface FetchedStatementReport {
  report: NativeReportColumn;
  /** Exact capped UTF-8 response text; kept separate from the normalized display DTO. */
  rawText: string;
}

export type PairedAccountSide =
  | { status: 'present'; ordinal: number; cells: Readonly<Record<string, NativeReportScalar>> }
  | { status: 'native_omitted'; ordinal: null; cells: null };

export interface PairedStatementAccount {
  account: string;
  current: PairedAccountSide;
  prior: PairedAccountSide;
}

export interface StatementReportPair {
  current: NativeReportColumn;
  prior: NativeReportColumn;
  /** Current native order, followed by prior-only accounts in prior native order. */
  accounts: readonly PairedStatementAccount[];
}

/** Totals-only DTO for the project-staff path. It deliberately carries no report identity or detail. */
export interface NativeProjectStatementTotals {
  income: string;
  expense: string;
  net: string;
  currency: 'IDR';
}

const ENDPOINT = '/api/method/frappe.desk.query_report.run' as const;
const STATEMENT_NAMES = new Set<StatementReportName>(['Trial Balance', 'Profit and Loss Statement', 'Balance Sheet']);
const LANGUAGE_PATTERN = /^[A-Za-z]{1,8}(?:[-_][A-Za-z0-9]{1,8})*$/;
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const MAX_COLUMNS = 256;
const MAX_ROWS = 50_000;
const MAX_ROW_FIELDS = 512;
const MAX_TEXT_LENGTH = 16_384;
const TB_MONEY_FIELDS = ['opening_debit', 'opening_credit', 'debit', 'credit', 'closing_debit', 'closing_credit'] as const;
const BOOLEAN_FIELDS = new Set(['has_value', 'include_in_gross', 'is_group', 'is_group_account', 'warn_if_negative']);

interface PreparedRequest {
  reportName: StatementReportName;
  period: StatementReportPeriod;
  periodPair: { current: StatementReportPeriod; prior: StatementReportPeriod };
  project: { projectId: string; erpProjectName: string } | null;
  language: string;
  profile: StatementVersionProfile;
  filters: Record<string, unknown>;
  path: string;
  expectedMoneyFields: string[];
}

function fail(message = 'Malformed statement report response', code = 'commit-rejected'): never {
  throw new AppError(message, code);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function hasForbiddenControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) return true;
  }
  return false;
}
function boundedText(value: unknown, message: string, maxLength = MAX_TEXT_LENGTH, code = 'config-rejected'): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength || hasForbiddenControl(value)) fail(message, code);
  return value;
}
function validDate(value: unknown, message: string): string {
  if (typeof value !== 'string') fail(message, 'config-rejected');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) fail(message, 'config-rejected');
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) fail(message, 'config-rejected');
  return value;
}
function validateCalendar(context: StatementReportContext): Map<string, { start: string; end: string }> {
  const calendar = context.metadata.calendar;
  if (!Array.isArray(calendar) || calendar.length === 0) fail('Statement report context has no validated fiscal calendar', 'config-rejected');
  const byName = new Map<string, { start: string; end: string }>();
  let previousEnd = '';
  for (const fiscalYear of calendar) {
    const name = boundedText(fiscalYear?.name, 'Invalid statement fiscal calendar', 140);
    const start = validDate(fiscalYear?.start, 'Invalid statement fiscal calendar');
    const end = validDate(fiscalYear?.end, 'Invalid statement fiscal calendar');
    if (start > end || (previousEnd && previousEnd >= start) || byName.has(name)) fail('Invalid statement fiscal calendar', 'config-rejected');
    byName.set(name, { start, end });
    previousEnd = end;
  }
  return byName;
}
function validatePeriod(period: StatementReportPeriod, calendar: Map<string, { start: string; end: string }>, reportName: StatementReportName): StatementReportPeriod {
  if (!period || !['month', 'quarter', 'year'].includes(period.kind)) fail('Invalid statement report range', 'config-rejected');
  const fromDate = validDate(period.fromDate, 'Invalid statement report range');
  const toDate = validDate(period.toDate, 'Invalid statement report range');
  const fromFiscalYear = boundedText(period.fromFiscalYear, 'Invalid statement report fiscal year', 140);
  const toFiscalYear = boundedText(period.toFiscalYear, 'Invalid statement report fiscal year', 140);
  const fromYear = calendar.get(fromFiscalYear);
  const toYear = calendar.get(toFiscalYear);
  if (!fromYear || !toYear || fromDate > toDate || fromDate < fromYear.start || fromDate > fromYear.end || toDate < toYear.start || toDate > toYear.end) {
    fail('Statement report range does not match its validated fiscal calendar', 'config-rejected');
  }
  if (reportName === 'Trial Balance' && fromFiscalYear !== toFiscalYear) {
    fail('Trial Balance range must use one fiscal year', 'config-rejected');
  }
  return {
    fromDate, toDate, fromFiscalYear, toFiscalYear, kind: period.kind,
    ...(period.columnLabel === undefined ? {} : { columnLabel: period.columnLabel }),
  };
}
function monthFieldname(date: string): string {
  const month = Number(date.slice(5, 7));
  const year = date.slice(0, 4);
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return `${monthNames[month - 1]}_${year}`;
}
function selectedPeriodicity(period: StatementReportPeriod): 'Monthly' | 'Quarterly' | 'Yearly' {
  return period.kind === 'month' ? 'Monthly' : period.kind === 'quarter' ? 'Quarterly' : 'Yearly';
}
function validateAndPrepare(selection: StatementReportSelection, context: StatementReportContext): PreparedRequest {
  if (!selection || !STATEMENT_NAMES.has(selection.reportName)) fail('Unsupported statement report selection', 'config-rejected');
  const company = boundedText(selection.company, 'Invalid statement Company', 140);
  if (company !== context?.publicationContext?.raw?.company?.name || context.publicationContext.raw.company.currency !== 'IDR' || context.metadata.currency !== 'IDR') {
    fail('Statement report Company does not match its validated binding context', 'config-rejected');
  }
  if (!context.profile || context.profile.erpVersion !== '16.33.0' || context.profile.frappeVersion !== '16.31.0' ||
      context.metadata.erpVersion !== context.profile.erpVersion || context.metadata.frappeVersion !== context.profile.frappeVersion) {
    fail('Statement report requires its verified software profile', 'config-rejected');
  }
  const language = boundedText(context.publicationContext.requestLanguage, 'Invalid statement request language', 64);
  if (!LANGUAGE_PATTERN.test(language)) fail('Invalid statement request language', 'config-rejected');
  const calendar = validateCalendar(context);
  if (!selection.periods || !selection.periods.current || !selection.periods.prior) fail('Statement report requires a validated current/prior range pair', 'config-rejected');
  const current = validatePeriod(selection.periods.current, calendar, selection.reportName);
  const prior = validatePeriod(selection.periods.prior, calendar, selection.reportName);
  if (current.kind !== prior.kind || prior.toDate >= current.fromDate) fail('Statement current/prior ranges are contradictory', 'config-rejected');
  if (selection.side !== 'current' && selection.side !== 'prior') fail('Invalid statement report range side', 'config-rejected');
  const project = selection.project === undefined ? null : {
    projectId: boundedText(selection.project.projectId, 'Invalid mapped project identity', 140),
    erpProjectName: boundedText(selection.project.erpProjectName, 'Invalid mapped native project', 140),
  };
  if (project && selection.reportName !== 'Profit and Loss Statement') fail('Native project filtering is available only for project P&L', 'config-rejected');

  const periodPair = { current, prior };
  const period = periodPair[selection.side];
  const common = {
    company,
    finance_book: '',
    include_default_book_entries: 1,
    presentation_currency: 'IDR',
    cost_center: [],
    project: project ? [project.erpProjectName] : [],
  };
  let filters: Record<string, unknown>;
  let expectedMoneyFields: string[];
  if (selection.reportName === 'Trial Balance') {
    filters = {
      ...common,
      fiscal_year: period.fromFiscalYear,
      from_date: period.fromDate,
      to_date: period.toDate,
      with_period_closing_entry_for_opening: 1,
      with_period_closing_entry_for_current_period: 1,
      show_group_accounts: 1,
      show_net_values: 1,
      show_zero_values: 0,
      show_unclosed_fy_pl_balances: 0,
    };
    expectedMoneyFields = [...TB_MONEY_FIELDS];
  } else {
    filters = {
      ...common,
      filter_based_on: 'Date Range',
      from_fiscal_year: period.fromFiscalYear,
      to_fiscal_year: period.toFiscalYear,
      period_start_date: period.fromDate,
      period_end_date: period.toDate,
      periodicity: selectedPeriodicity(period),
      accumulated_values: selection.reportName === 'Balance Sheet' ? 1 : 0,
      selected_view: 'Report',
      report_template: '',
      show_zero_values: 0,
    };
    expectedMoneyFields = [monthFieldname(period.toDate)];
    if (selection.reportName === 'Profit and Loss Statement' && period.kind !== 'year') expectedMoneyFields.push('total');
  }
  const query = new URLSearchParams();
  query.set('report_name', selection.reportName);
  query.set('filters', JSON.stringify(filters));
  query.set('ignore_prepared_report', '1');
  return {
    reportName: selection.reportName,
    period,
    periodPair,
    project,
    language,
    profile: { erpVersion: context.profile.erpVersion, frappeVersion: context.profile.frappeVersion },
    filters,
    path: `${ENDPOINT}?${query.toString()}`,
    expectedMoneyFields,
  };
}

function plainLabel(value: unknown, message: string): string {
  // Keep native markup-looking text literal; consumers render this as React text, never HTML.
  return boundedText(value, message, 512, 'commit-rejected');
}
function metadataInteger(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== 'string' && typeof value !== 'number') fail(message);
  const text = String(value);
  if (!JSON_NUMBER.test(text)) fail(message);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail(message);
  return parsed;
}
function metadataBoolean(value: unknown, message: string): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  fail(message);
}
function normalizeColumns(value: unknown): Array<{ fieldname: string; label: string; type: 'text' | 'currency'; width?: number; hidden?: boolean }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLUMNS) fail('Statement report has invalid native columns');
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!isRecord(raw)) fail('Statement report has invalid native columns');
    const fieldname = boundedText(raw.fieldname, 'Statement report has invalid native columns', 128, 'commit-rejected');
    if (seen.has(fieldname)) fail('Statement report contains duplicate native columns');
    seen.add(fieldname);
    if (typeof raw.fieldtype !== 'string' || raw.fieldtype.length > 64) fail('Statement report has invalid native columns');
    const column: { fieldname: string; label: string; type: 'text' | 'currency'; width?: number; hidden?: boolean } = {
      fieldname,
      label: plainLabel(raw.label, 'Statement report has invalid native column label'),
      type: raw.fieldtype === 'Currency' ? 'currency' : 'text',
    };
    if (hasOwn(raw, 'width')) column.width = metadataInteger(raw.width, 1, 2_000, 'Statement report has invalid native column width');
    if (hasOwn(raw, 'hidden')) column.hidden = metadataBoolean(raw.hidden, 'Statement report has invalid native column visibility');
    return column;
  });
}
function validateExpectedColumns(columns: readonly { fieldname: string; type: 'text' | 'currency' }[], prepared: PreparedRequest): void {
  const byName = new Map(columns.map((column) => [column.fieldname, column]));
  if (byName.get('account')?.type !== 'text') fail('Statement report is missing its native account column');
  for (const field of prepared.expectedMoneyFields) {
    if (byName.get(field)?.type !== 'currency') fail('Statement report is missing a required native Currency column');
  }
}
function nativeScalar(value: unknown, message: string): NativeReportScalar {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.length <= MAX_TEXT_LENGTH) return value;
  fail(message);
}
function moneyToken(value: unknown, message: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 128 || !JSON_NUMBER.test(value)) fail(message);
  return value;
}
function isAccountDataRow(row: Record<string, unknown>): boolean {
  const hasAccountDetails = hasOwn(row, 'acc_name') || hasOwn(row, 'acc_number') || hasOwn(row, 'is_group') || hasOwn(row, 'is_group_account');
  return typeof row.account === 'string' && hasAccountDetails;
}
function normalizeRows(
  value: unknown,
  prepared: PreparedRequest,
  columns: readonly { fieldname: string; type: 'text' | 'currency'; hidden?: boolean }[],
): Array<Readonly<Record<string, NativeReportScalar>>> {
  if (!Array.isArray(value) || value.length > MAX_ROWS) fail('Statement report has invalid native rows');
  const amountFields = new Set(prepared.expectedMoneyFields);
  const currencyFields = new Set(columns.filter((column) => column.type === 'currency' && column.hidden !== true).map((column) => column.fieldname));
  const visibleFields = new Set(columns.filter((column) => column.hidden !== true).map((column) => column.fieldname));
  const consumedLabels = new Set(['account', 'account_name', 'acc_name', 'acc_number', 'parent_account']);
  const accountKeys = new Set<string>();
  return value.map((raw) => {
    if (!isRecord(raw) || Object.keys(raw).length > MAX_ROW_FIELDS) fail('Statement report has invalid native rows');
    const normalized: Record<string, NativeReportScalar> = {};
    for (const [key, cell] of Object.entries(raw)) {
      if (key.length === 0 || key.length > 128) fail('Statement report has invalid native rows');
      if (key === 'indent') normalized[key] = metadataInteger(cell, 0, 100, 'Statement report has invalid account indentation');
      else if (BOOLEAN_FIELDS.has(key)) normalized[key] = metadataBoolean(cell, 'Statement report has invalid account flags');
      else if (amountFields.has(key) || currencyFields.has(key) || key === 'opening_balance') normalized[key] = moneyToken(cell, 'Statement report has invalid native Currency value');
      else if (visibleFields.has(key) || consumedLabels.has(key)) normalized[key] = nativeScalar(cell, 'Statement report has invalid native row values');
      else if (cell !== null && typeof cell === 'object') continue;
      else normalized[key] = nativeScalar(cell, 'Statement report has invalid native row values');
    }
    if (isAccountDataRow(raw)) {
      if (!hasOwn(raw, 'account') || typeof raw.account !== 'string' || raw.account.trim() === '' ||
          typeof raw.acc_name !== 'string' || (raw.acc_number !== null && typeof raw.acc_number !== 'string') ||
          (raw.parent_account !== null && typeof raw.parent_account !== 'string') || typeof normalized.indent !== 'number') {
        fail('Statement report contains malformed account identity data');
      }
      for (const field of prepared.expectedMoneyFields) {
        if (!hasOwn(raw, field)) fail('Statement report account row is missing a required native amount');
      }
      const account = raw.account;
      if (accountKeys.has(account)) fail('Statement report contains duplicate account identity');
      accountKeys.add(account);
    }
    return normalized;
  });
}
function normalizeSummary(value: unknown): readonly Readonly<Record<string, NativeReportScalar>>[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 100) fail('Statement report has invalid native summary');
  return value.map((raw) => {
    if (!isRecord(raw) || Object.keys(raw).length > MAX_ROW_FIELDS) fail('Statement report has invalid native summary');
    const normalized: Record<string, NativeReportScalar> = {};
    for (const [key, item] of Object.entries(raw)) {
      if (key === 'value' && raw.datatype === 'Currency') normalized[key] = moneyToken(item, 'Statement report has invalid native summary amount');
      else if (item === null || typeof item === 'boolean' || typeof item === 'string') {
        normalized[key] = nativeScalar(item, 'Statement report has invalid native summary values');
      } else if (key === 'value') {
        fail('Statement report has invalid native summary values');
      }
    }
    return normalized;
  });
}
function samePeriodRange(left: StatementReportPeriod, right: StatementReportPeriod): boolean {
  return left.fromDate === right.fromDate && left.toDate === right.toDate &&
    left.fromFiscalYear === right.fromFiscalYear && left.toFiscalYear === right.toFiscalYear && left.kind === right.kind;
}
function samePeriodPair(
  left: { current: StatementReportPeriod; prior: StatementReportPeriod },
  right: { current: StatementReportPeriod; prior: StatementReportPeriod },
): boolean {
  return samePeriodRange(left.current, right.current) && samePeriodRange(left.prior, right.prior);
}
function normalizeForComparison(value: unknown): unknown {
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(normalizeForComparison);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeForComparison(value[key])]));
  return value;
}
function validateReturnedRequest(message: Record<string, unknown>, prepared: PreparedRequest): void {
  if (hasOwn(message, 'report_name') && message.report_name !== prepared.reportName) fail('Statement report identity does not match its request');
  if (hasOwn(message, 'filters') && JSON.stringify(normalizeForComparison(message.filters)) !== JSON.stringify(normalizeForComparison(prepared.filters))) {
    fail('Statement report filters do not match its request');
  }
}
async function sha256(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail('Statement report response integrity is unavailable');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function validateAcquiredAt(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    fail('Statement report acquisition time is invalid');
  }
  return value;
}

/** Purely normalizes one lossless, bounded standard-report response against its validated request. */
export async function parseStatementReport(
  response: FinancialDecimalTextResponse,
  selection: StatementReportSelection,
  context: StatementReportContext,
  acquiredAt: string,
): Promise<NativeReportColumn> {
  const prepared = validateAndPrepare(selection, context);
  if (!isFinancialDecimalTextResponse(response) || new TextEncoder().encode(response.rawText).byteLength > 5 * 1024 * 1024) fail();
  const capturedAt = validateAcquiredAt(acquiredAt);
  const envelope = response.body;
  if (!isRecord(envelope) || !isRecord(envelope.message)) fail();
  const message = envelope.message;
  validateReturnedRequest(message, prepared);
  const columns = normalizeColumns(message.columns);
  validateExpectedColumns(columns, prepared);
  if (prepared.reportName !== 'Trial Balance') {
    const expectedField = monthFieldname(prepared.period.toDate);
    if (!columns.some((column) => column.fieldname === expectedField)) fail('Statement period column does not match its validated range');
  }
  const rows = normalizeRows(message.result, prepared, columns);
  const summary = normalizeSummary(message.report_summary);
  if (prepared.project && prepared.reportName === 'Profit and Loss Statement') projectTotalsFromSummary(summary);
  return {
    reportName: prepared.reportName,
    company: selection.company,
    side: selection.side,
    period: prepared.period,
    periodPair: prepared.periodPair,
    project: prepared.project,
    language: prepared.language,
    profile: prepared.profile,
    columns,
    rows,
    summary,
    provenance: {
      endpoint: ENDPOINT,
      method: 'GET',
      ignorePreparedReport: 1,
      rawSha256: await sha256(response.rawText),
      acquiredAt: capturedAt,
      filters: prepared.filters,
    },
  };
}

/** Fetches one standard native statement using the bound origin/language and a fixed GET endpoint. */
export async function fetchStatementReport(
  client: ErpClientDeps,
  selection: StatementReportSelection,
  context: StatementReportContext,
): Promise<FetchedStatementReport> {
  const prepared = validateAndPrepare(selection, context);
  const scopedClient: ErpClientDeps = {
    ...client,
    fetchImpl: statementRequestFetch(client.fetchImpl, client.baseUrl, prepared.language),
  };
  const response = await erpnextRequest(scopedClient, {
    method: 'GET', path: prepared.path, responseNumbers: 'financial_decimal_text',
  });
  if (!isFinancialDecimalTextResponse(response)) fail();
  const report = await parseStatementReport(response, selection, context, new Date().toISOString());
  return { report, rawText: response.rawText };
}

function accountIdentity(row: Readonly<Record<string, NativeReportScalar>>): string | null {
  return isAccountDataRow(row) ? row.account as string : null;
}

/** Derives an optional union by opaque account identity; each native side remains authoritative. */
export function joinStatementReportPair(current: NativeReportColumn, prior: NativeReportColumn): StatementReportPair {
  if (!current || !prior || current.side !== 'current' || prior.side !== 'prior' || current.reportName !== prior.reportName ||
      current.company !== prior.company || current.language !== prior.language ||
      current.profile.erpVersion !== prior.profile.erpVersion || current.profile.frappeVersion !== prior.profile.frappeVersion ||
      JSON.stringify(current.project) !== JSON.stringify(prior.project) ||
      !samePeriodPair(current.periodPair, prior.periodPair) ||
      !samePeriodRange(current.periodPair.current, current.period) ||
      !samePeriodRange(prior.periodPair.prior, prior.period) ||
      current.period.kind !== prior.period.kind || prior.period.toDate >= current.period.fromDate) {
    fail('Statement current/prior report context does not match');
  }
  const currentRows = new Map<string, { ordinal: number; row: Readonly<Record<string, NativeReportScalar>> }>();
  const priorRows = new Map<string, { ordinal: number; row: Readonly<Record<string, NativeReportScalar>> }>();
  const indexRows = (report: NativeReportColumn, index: Map<string, { ordinal: number; row: Readonly<Record<string, NativeReportScalar>> }>) => {
    report.rows.forEach((row, ordinal) => {
      const account = accountIdentity(row);
      if (account === null) return;
      if (index.has(account)) fail('Statement pair contains duplicate account identity');
      index.set(account, { ordinal, row });
    });
  };
  indexRows(current, currentRows);
  indexRows(prior, priorRows);
  const accounts: PairedStatementAccount[] = [];
  for (const [account, left] of currentRows) {
    const right = priorRows.get(account);
    accounts.push({
      account,
      current: { status: 'present', ordinal: left.ordinal, cells: left.row },
      prior: right ? { status: 'present', ordinal: right.ordinal, cells: right.row } : { status: 'native_omitted', ordinal: null, cells: null },
    });
  }
  for (const [account, right] of priorRows) {
    if (!currentRows.has(account)) accounts.push({
      account,
      current: { status: 'native_omitted', ordinal: null, cells: null },
      prior: { status: 'present', ordinal: right.ordinal, cells: right.row },
    });
  }
  return { current, prior, accounts };
}

/** Copies the native project P&L summary's first three Currency tokens by position; never calculates. */
function projectTotalsFromSummary(summary: NativeReportColumn['summary']): NativeProjectStatementTotals {
  if (summary === null || summary.length < 3) fail('Project P&L native totals are unavailable');
  const values = summary.slice(0, 3).map((item) => {
    if (item.datatype !== 'Currency' || item.currency !== 'IDR') fail('Project P&L native totals are unavailable');
    return moneyToken(item.value, 'Project P&L native totals are unavailable');
  });
  if (values.length !== 3 || values.some((value) => value === null)) fail('Project P&L native totals are unavailable');
  return { income: values[0]!, expense: values[1]!, net: values[2]!, currency: 'IDR' };
}

export function projectStatementTotals(report: NativeReportColumn): NativeProjectStatementTotals {
  if (report.reportName !== 'Profit and Loss Statement' || !report.project) fail('Project totals require a project P&L report');
  return projectTotalsFromSummary(report.summary);
}
