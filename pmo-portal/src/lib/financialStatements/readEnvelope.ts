// Catalogue/read response envelope parsing: the strict contract for the HTTP
// responses that present financial statements. Shared primitives come from
// ./validation; native payload validation from ./nativeReport.
import type { Json } from '../supabase/database.types';
import {
  PERIOD_KINDS,
  ROUNDING_METHODS,
  SCOPE_KINDS,
  STATEMENTS,
  VIEW_KINDS,
  copyJson,
  hasExactKeys,
  isFiscalPeriodRange,
  isRealDate,
  isRealTimestamp,
  isUuid,
  recordValues,
  reject,
  sameJsonValue,
  type FinancialStatementKind,
  type FinancialStatementPeriodKind,
  type FinancialStatementRoundingMode,
} from './validation';
import { isNativePayload, isTotalsPayload, type FinancialStatementNativePayload, type NativeReadPeriod } from './nativeReport';

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
      !isRealTimestamp(generation.captureCompletedAt) || Date.parse(generation.asOf) < Date.parse(generation.captureCompletedAt) ||
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
