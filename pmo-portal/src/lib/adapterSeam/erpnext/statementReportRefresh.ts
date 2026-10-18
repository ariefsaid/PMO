import type { ErpClientDeps } from './client.ts';
import { fetchStatementVersionProfile } from './binding.ts';
import { fetchStatementPublicationMetadata } from './statementMetadata.ts';
import {
  fetchStatementReport,
  type StatementReportContext,
  type StatementReportName,
  type StatementReportPeriod,
} from './statementReports.ts';

const OPEN_RPC = 'open_erp_statement_report_batch';
const MARK_ATTEMPT_RPC = 'mark_erp_statement_report_refresh_attempt';
const STAGE_RPC = 'stage_erp_statement_report';
const PUBLISH_RPC = 'publish_erp_financial_statements';
const FILTER_PROFILE = 'erpnext-v16-standard-statements-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const REQUEST_RESERVE_MS = 250;
const CONTEXT_RECHECK_ADMISSION_MS = 5_000;
export const STATEMENT_READ_REQUEST_TIMEOUT_MS = 5_000;
export const STATEMENT_READ_STAGE_TIMEOUT_MS = 7_000;
const ERROR_CODES = {
  context: 'native-context-unavailable',
  rpc: 'native-batch-unavailable',
  request: 'native-report-unavailable',
  response: 'native-batch-invalid-response',
  stage: 'native-stage-outcome-unknown',
  deadline: 'native-stage-deadline',
} as const;

type StatementKey = 'trial_balance' | 'profit_and_loss' | 'balance_sheet';
type SqlPeriodKind = 'month' | 'quarter' | 'fiscal_year';
type Side = 'current' | 'prior';

interface CanonicalSelection {
  statement: StatementKey;
  projectId: string | null;
  periodKind: SqlPeriodKind;
  currentStart: string;
  currentEnd: string;
  priorStart: string;
  priorEnd: string;
  side: Side;
}

interface OpenBatch {
  batchId: string;
  startedAt: string;
  nextRequest: CanonicalSelection | null;
  complete: boolean;
}

interface NativeRpcError {
  message?: string;
  code?: string;
}

/** The deliberately small RPC surface used by the native statement batch protocol. */
export interface StatementReportBatchService {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: NativeRpcError | null }>;
}

export interface StatementReportRefreshBinding {
  id: string;
  activatedAt: string;
  versionMajor: number;
  company: string;
  projectMap: Record<string, unknown>;
}

/** Inputs are the already authenticated per-org client, live binding facts, and claimed sweep holder. */
export interface StatementReportRefreshInput {
  orgId: string;
  holder: string;
  binding: StatementReportRefreshBinding;
  client: ErpClientDeps;
  service: StatementReportBatchService;
  /** Remaining invocation-wide sweep time at admission; the native segment can never exceed it. */
  remainingTickBudgetMs?: number;
}

export interface StatementReportRefreshResult {
  status: 'progress' | 'published' | 'failed';
  staged: number;
  complete: boolean;
  batchId?: string;
  startedAt?: string;
  snapshotId?: string;
  errorCode?: string;
}

interface NativeContext {
  rpc: Record<string, unknown>;
  fetch: StatementReportContext;
  calendar: Array<{ name: string; start: string; end: string }>;
  client: ErpClientDeps;
}

interface Runtime {
  controller: AbortController;
  expiresAt: number;
  active: boolean;
  batch: OpenBatch | null;
  staged: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}

function validateSelection(value: unknown): CanonicalSelection | null {
  if (!isRecord(value) || !exactKeys(value, [
    'statement', 'projectId', 'periodKind', 'currentStart', 'currentEnd', 'priorStart', 'priorEnd', 'side',
  ])) return null;
  if (!['trial_balance', 'profit_and_loss', 'balance_sheet'].includes(String(value.statement))) return null;
  if (!['month', 'quarter', 'fiscal_year'].includes(String(value.periodKind))) return null;
  if (value.side !== 'current' && value.side !== 'prior') return null;
  if (value.projectId !== null && (typeof value.projectId !== 'string' || !UUID_PATTERN.test(value.projectId))) return null;
  if (value.projectId !== null && value.statement !== 'profit_and_loss') return null;
  if (![value.currentStart, value.currentEnd, value.priorStart, value.priorEnd].every(validDate)) return null;
  if ((value.currentStart as string) > (value.currentEnd as string) || (value.priorStart as string) > (value.priorEnd as string)) return null;
  return value as unknown as CanonicalSelection;
}

function validateOpenBatch(value: unknown): OpenBatch | null {
  if (!isRecord(value) || !exactKeys(value, ['batchId', 'startedAt', 'nextRequest', 'complete'])) return null;
  if (typeof value.batchId !== 'string' || !UUID_PATTERN.test(value.batchId)) return null;
  if (typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) return null;
  if (typeof value.complete !== 'boolean') return null;
  const nextRequest = value.nextRequest === null ? null : validateSelection(value.nextRequest);
  if (value.nextRequest !== null && nextRequest === null) return null;
  if (value.complete !== (nextRequest === null)) return null;
  return { batchId: value.batchId, startedAt: value.startedAt, nextRequest, complete: value.complete };
}

function validCalendar(value: unknown): value is Array<{ name: string; start: string; end: string }> {
  if (!Array.isArray(value) || value.length === 0) return false;
  let priorEnd = '';
  const names = new Set<string>();
  for (const year of value) {
    if (!isRecord(year) || typeof year.name !== 'string' || year.name.trim() === '' ||
      !validDate(year.start) || !validDate(year.end) || year.start > year.end || year.start <= priorEnd || names.has(year.name)) return false;
    names.add(year.name);
    priorEnd = year.end;
  }
  return true;
}

function semanticJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (isRecord(input)) return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
    return input;
  };
  return JSON.stringify(normalize(value));
}

function errorResult(
  code: string,
  batch?: OpenBatch | null,
  staged = 0,
): StatementReportRefreshResult {
  return {
    status: 'failed', staged, complete: batch?.complete ?? false,
    ...(batch ? { batchId: batch.batchId, startedAt: batch.startedAt } : {}), errorCode: code,
  };
}

function progressResult(batch: OpenBatch | null, staged: number, errorCode?: string): StatementReportRefreshResult {
  return {
    status: 'progress', staged, complete: batch?.complete ?? false,
    ...(batch ? { batchId: batch.batchId, startedAt: batch.startedAt } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

function datePeriod(
  start: string,
  end: string,
  calendar: readonly { name: string; start: string; end: string }[],
  kind: StatementReportPeriod['kind'],
): StatementReportPeriod | null {
  const startYears = calendar.filter((year) => year.start <= start && year.end >= start);
  const endYears = calendar.filter((year) => year.start <= end && year.end >= end);
  if (startYears.length !== 1 || endYears.length !== 1) return null;
  return {
    fromDate: start,
    toDate: end,
    fromFiscalYear: startYears[0]!.name,
    toFiscalYear: endYears[0]!.name,
    kind,
  };
}

function reportSelection(
  request: CanonicalSelection,
  context: NativeContext,
  binding: StatementReportRefreshBinding,
): { selection: import('./statementReports.ts').StatementReportSelection; reportName: StatementReportName } | null {
  const reportName: StatementReportName = request.statement === 'trial_balance'
    ? 'Trial Balance'
    : request.statement === 'profit_and_loss' ? 'Profit and Loss Statement' : 'Balance Sheet';
  const kind: StatementReportPeriod['kind'] = request.periodKind === 'fiscal_year'
    ? 'year'
    : request.periodKind;
  const current = datePeriod(request.currentStart, request.currentEnd, context.calendar, kind);
  const prior = datePeriod(request.priorStart, request.priorEnd, context.calendar, kind);
  if (!current || !prior) return null;
  let project: { projectId: string; erpProjectName: string } | undefined;
  if (request.projectId !== null) {
    const erpProjectName = binding.projectMap[request.projectId];
    if (typeof erpProjectName !== 'string' || erpProjectName.trim() === '') return null;
    project = { projectId: request.projectId, erpProjectName };
  }
  return {
    reportName,
    selection: {
      reportName,
      company: context.fetch.publicationContext.raw.company.name,
      side: request.side,
      periods: { current, prior },
      ...(project ? { project } : {}),
    },
  };
}

async function readNativeContext(input: StatementReportRefreshInput, runtime: Runtime): Promise<NativeContext | null> {
  if (!runtime.active || runtime.controller.signal.aborted) return null;
  const boundedClient: ErpClientDeps = {
    ...input.client,
    timeoutMs: STATEMENT_READ_REQUEST_TIMEOUT_MS,
    maxRetries: 0,
    fetchImpl: async (request, init) => {
      if (!runtime.active || runtime.controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
      const requestSignal = request instanceof Request ? request.signal : new Request(request, init).signal;
      const signal = requestSignal
        ? AbortSignal.any([runtime.controller.signal, requestSignal])
        : runtime.controller.signal;
      const response = await input.client.fetchImpl(request, { ...init, signal });
      if (!runtime.active || runtime.controller.signal.aborted || requestSignal?.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      return response;
    },
  };
  const profile = await fetchStatementVersionProfile(boundedClient);
  if (!runtime.active || runtime.controller.signal.aborted) return null;
  const { metadata, context } = await fetchStatementPublicationMetadata(boundedClient, {
    company: input.binding.company,
    profile,
  });
  if (!runtime.active || runtime.controller.signal.aborted || !validCalendar(metadata.calendar)) return null;
  if (context.raw.company.name !== input.binding.company || profile.erpVersion !== metadata.erpVersion || profile.frappeVersion !== metadata.frappeVersion) return null;
  const rpc = {
    binding: { id: input.binding.id, activatedAt: input.binding.activatedAt, versionMajor: input.binding.versionMajor },
    company: context.raw.company.name,
    profile,
    calendar: metadata.calendar.map(({ name, start, end }) => ({ name, start, end })),
    projectMap: input.binding.projectMap,
    language: context.requestLanguage,
    presentation: { metadata, context },
    filterProfile: FILTER_PROFILE,
  };
  return {
    rpc,
    fetch: { profile, metadata, publicationContext: context },
    calendar: rpc.calendar as NativeContext['calendar'],
    client: boundedClient,
  };
}

async function rpc(
  input: StatementReportRefreshInput,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    const result = await input.service.rpc(name, args);
    if (!result || result.error) return { ok: false };
    return { ok: true, data: result.data };
  } catch {
    return { ok: false };
  }
}

async function openBatch(
  input: StatementReportRefreshInput,
  context: NativeContext,
  runtime: Runtime,
): Promise<OpenBatch | null> {
  if (!runtime.active || runtime.controller.signal.aborted) return null;
  const opened = await rpc(input, OPEN_RPC, {
    p_org_id: input.orgId,
    p_holder: input.holder,
    p_context: context.rpc,
  });
  if (!runtime.active || runtime.controller.signal.aborted || !opened.ok) return null;
  return validateOpenBatch(opened.data);
}

function sameSelection(left: CanonicalSelection, right: CanonicalSelection): boolean {
  return semanticJson(left) === semanticJson(right);
}

async function publish(
  input: StatementReportRefreshInput,
  batch: OpenBatch,
  runtime: Runtime,
  staged: number,
): Promise<StatementReportRefreshResult> {
  if (!runtime.active || runtime.controller.signal.aborted) return progressResult(batch, staged, ERROR_CODES.deadline);
  const args = { p_org_id: input.orgId, p_holder: input.holder, p_batch_id: batch.batchId };
  let result = await rpc(input, PUBLISH_RPC, args);
  if (!runtime.active || runtime.controller.signal.aborted) return progressResult(batch, staged, ERROR_CODES.deadline);
  if (!result.ok || typeof result.data !== 'string' || !UUID_PATTERN.test(result.data)) {
    // The publisher is idempotent for this holder/batch: a lost response is reconciled by retrying it.
    result = await rpc(input, PUBLISH_RPC, args);
  }
  if (!runtime.active || runtime.controller.signal.aborted) return progressResult(batch, staged, ERROR_CODES.deadline);
  if (!result.ok || typeof result.data !== 'string' || !UUID_PATTERN.test(result.data)) {
    return errorResult(ERROR_CODES.rpc, batch, staged);
  }
  return { status: 'published', staged, complete: true, batchId: batch.batchId, startedAt: batch.startedAt, snapshotId: result.data };
}

async function runBatch(input: StatementReportRefreshInput, runtime: Runtime): Promise<StatementReportRefreshResult> {
  let staged = 0;
  if (!runtime.active || runtime.controller.signal.aborted) return progressResult(null, staged, ERROR_CODES.deadline);
  const admission = await rpc(input, MARK_ATTEMPT_RPC, {
    p_org_id: input.orgId,
    p_holder: input.holder,
    p_binding: input.binding,
  });
  if (!runtime.active || runtime.controller.signal.aborted) return progressResult(null, staged, ERROR_CODES.deadline);
  if (!admission.ok) return errorResult(ERROR_CODES.rpc, null, staged);
  const initialContext = await readNativeContext(input, runtime);
  if (!initialContext) return progressResult(null, staged, runtime.active ? ERROR_CODES.context : ERROR_CODES.deadline);
  const opened = await openBatch(input, initialContext, runtime);
  if (!opened) return errorResult(runtime.active ? ERROR_CODES.response : ERROR_CODES.deadline, null, staged);
  let batch: OpenBatch = opened;
  runtime.batch = batch;
  if (batch.complete) return await publish(input, batch, runtime, staged);

  const context = initialContext;
  while (batch.nextRequest && runtime.active && !runtime.controller.signal.aborted) {
    const request = batch.nextRequest;
    const remaining = runtime.expiresAt - Date.now();
    if (remaining < STATEMENT_READ_REQUEST_TIMEOUT_MS + REQUEST_RESERVE_MS) return progressResult(batch, staged);
    const mapped = reportSelection(request, context, input.binding);
    if (!mapped) return errorResult(ERROR_CODES.response, batch, staged);
    let fetched: Awaited<ReturnType<typeof fetchStatementReport>>;
    try {
      fetched = await fetchStatementReport(context.client, mapped.selection, context.fetch);
    } catch {
      return errorResult(runtime.active ? ERROR_CODES.request : ERROR_CODES.deadline, batch, staged);
    }
    if (!runtime.active || runtime.controller.signal.aborted) return progressResult(batch, staged, ERROR_CODES.deadline);
    const payload = { selection: request, report: fetched.report, rawText: fetched.rawText };
    const stageArgs = { p_org_id: input.orgId, p_holder: input.holder, p_batch_id: batch.batchId, p_report: payload };
    const firstStage = await rpc(input, STAGE_RPC, stageArgs);
    if (!runtime.active || runtime.controller.signal.aborted) return progressResult(batch, staged, ERROR_CODES.deadline);
    if (!firstStage.ok) {
      const reconciled = await openBatch(input, context, runtime);
      if (!reconciled) return errorResult(runtime.active ? ERROR_CODES.stage : ERROR_CODES.deadline, batch, staged);
      batch = reconciled;
      runtime.batch = batch;
      if (!batch.nextRequest || !sameSelection(batch.nextRequest, request)) {
        staged += 1;
        runtime.staged = staged;
        if (batch.complete) break;
        continue;
      }
      if (!runtime.active || runtime.controller.signal.aborted || runtime.expiresAt - Date.now() <= REQUEST_RESERVE_MS) {
        return progressResult(batch, staged, ERROR_CODES.stage);
      }
      const retry = await rpc(input, STAGE_RPC, stageArgs);
      if (!runtime.active || runtime.controller.signal.aborted) return progressResult(batch, staged, ERROR_CODES.deadline);
      if (!retry.ok) {
        const afterRetry = await openBatch(input, context, runtime);
        if (!afterRetry) return errorResult(runtime.active ? ERROR_CODES.stage : ERROR_CODES.deadline, batch, staged);
        batch = afterRetry;
        runtime.batch = batch;
        if (batch.nextRequest && sameSelection(batch.nextRequest, request)) return progressResult(batch, staged, ERROR_CODES.stage);
        staged += 1;
        runtime.staged = staged;
      } else {
        staged += 1;
        runtime.staged = staged;
        const refreshed = await openBatch(input, context, runtime);
        if (!refreshed) return errorResult(runtime.active ? ERROR_CODES.rpc : ERROR_CODES.deadline, null, staged);
        batch = refreshed;
        runtime.batch = batch;
        if (batch.nextRequest && sameSelection(batch.nextRequest, request)) return progressResult(batch, staged, ERROR_CODES.stage);
      }
    } else {
      staged += 1;
      runtime.staged = staged;
      const refreshed = await openBatch(input, context, runtime);
      if (!refreshed) return errorResult(runtime.active ? ERROR_CODES.rpc : ERROR_CODES.deadline, null, staged);
      batch = refreshed;
      runtime.batch = batch;
      if (batch.nextRequest && sameSelection(batch.nextRequest, request)) return progressResult(batch, staged, ERROR_CODES.stage);
    }

    if (batch.complete) break;
  }

  if (!batch.complete) return progressResult(batch, staged, runtime.active ? undefined : ERROR_CODES.deadline);
  if (staged === 0) return await publish(input, batch, runtime, staged);

  // A completed batch made new reports in this segment; compare fresh native identity/settings before publish.
  if (runtime.expiresAt - Date.now() < CONTEXT_RECHECK_ADMISSION_MS) return progressResult(batch, staged);
  const closingContext = await readNativeContext(input, runtime);
  if (!closingContext) return progressResult(batch, staged, ERROR_CODES.deadline);
  if (semanticJson(context.rpc) !== semanticJson(closingContext.rpc)) {
    const restarted = await openBatch(input, closingContext, runtime);
    if (!restarted) return errorResult(runtime.active ? ERROR_CODES.rpc : ERROR_CODES.deadline, batch, staged);
    return progressResult(restarted, staged);
  }
  return await publish(input, batch, runtime, staged);
}

/**
 * Runs one bounded resumable native-report segment under the sweep's already-claimed holder.
 * This coordinator stages only fetched native columns and original response text; it never builds
 * statement pairs, derives totals, or changes ERP state.
 */
export async function refreshStatementReportBatch(input: StatementReportRefreshInput): Promise<StatementReportRefreshResult> {
  if (!input || !UUID_PATTERN.test(input.orgId) || !UUID_PATTERN.test(input.holder) ||
    !UUID_PATTERN.test(input.binding?.id ?? '') || !input.binding.activatedAt || !Number.isFinite(Date.parse(input.binding.activatedAt)) ||
    input.binding.versionMajor !== 16 || typeof input.binding.company !== 'string' || input.binding.company.trim() === '' ||
    !isRecord(input.binding.projectMap) || !input.client || !input.service ||
    (input.remainingTickBudgetMs !== undefined && (!Number.isFinite(input.remainingTickBudgetMs) || input.remainingTickBudgetMs < 0))) {
    return errorResult(ERROR_CODES.context);
  }
  const stageDurationMs = Math.min(STATEMENT_READ_STAGE_TIMEOUT_MS, input.remainingTickBudgetMs ?? STATEMENT_READ_STAGE_TIMEOUT_MS);
  if (stageDurationMs <= 0) return progressResult(null, 0, ERROR_CODES.deadline);
  const controller = new AbortController();
  const runtime: Runtime = {
    controller,
    expiresAt: Date.now() + stageDurationMs,
    active: true,
    batch: null,
    staged: 0,
  };
  let resolveDeadline!: (result: StatementReportRefreshResult) => void;
  const deadline = new Promise<StatementReportRefreshResult>((resolve) => { resolveDeadline = resolve; });
  const timer = setTimeout(() => {
    runtime.active = false;
    controller.abort(new DOMException('statement stage deadline exceeded', 'TimeoutError'));
    resolveDeadline(progressResult(runtime.batch, runtime.staged, ERROR_CODES.deadline));
  }, stageDurationMs);
  const operation = runBatch(input, runtime).catch(() => errorResult(ERROR_CODES.context, runtime.batch, runtime.staged));
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
    runtime.active = false;
    if (!controller.signal.aborted) controller.abort();
  }
}
