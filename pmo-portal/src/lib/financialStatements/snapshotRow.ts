// Snapshot-row parsing: the strict contract for persisted
// `erp_financial_statement_snapshot` rows, native or totals payloads included.
// Shared primitives come from ./validation; native report validation from ./nativeReport.
import type { Database } from '../supabase/database.types';
import { INVALID_ROW_MESSAGE, PERIOD_KINDS, ROUNDING_METHODS, SCOPE_KINDS, STATEMENTS, VIEW_KINDS, copyJson, hasExactKeys, isRealTimestamp, isUuid, recordValues, reject, sameJsonValue, validPeriodPair } from './validation';
import { isNativePayload, isNativeRawReports, isTotalsPayload, nativeReportName, type FinancialStatementNativePayload, type FinancialStatementTotalsPayload, type NativeReadPeriod } from './nativeReport';

type GeneratedFinancialStatementRow = Database['public']['Tables']['erp_financial_statement_snapshot']['Row'];
export type FinancialStatementRow = Omit<GeneratedFinancialStatementRow, 'payload' | 'raw_reports' | 'capture_started_at' | 'capture_completed_at'> & {
  payload: FinancialStatementNativePayload | FinancialStatementTotalsPayload;
  raw_reports: { current: string; prior: string } | null;
  capture_started_at: string;
  capture_completed_at: string;
};

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
  'published_at',
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
      (source.published_at !== null && (typeof source.published_at !== 'string' || !isRealTimestamp(source.published_at))) ||
      (source.published_at === null
        ? source.as_of !== source.capture_completed_at
        : source.as_of !== source.published_at || Date.parse(source.published_at) < Date.parse(source.capture_completed_at)) ||
      Date.parse(source.capture_started_at) > Date.parse(source.capture_completed_at)) return reject();
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
    published_at: source.published_at as string | null,
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
