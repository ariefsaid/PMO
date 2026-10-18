import { AppError } from '@/src/lib/appError';
import { parseFinancialStatementCatalogue, parseFinancialStatementRead } from '@/src/lib/financialStatements';
import type {
  FinancialStatementCatalogue,
  FinancialStatementKind,
  FinancialStatementPair,
  FinancialStatementPeriodKind,
  FinancialStatementRead,
  FinancialStatementSelection,
} from '@/src/lib/financialStatements';
import { supabase } from '@/src/lib/supabase/client';

export interface FinancialStatementCatalogueOptions {
  projectId?: string;
}

export interface GetFinancialStatementInput {
  periodKind: FinancialStatementPeriodKind;
  periodStart: string;
  statement: FinancialStatementKind;
  projectId?: string;
  viewKind?: 'account_breakdown' | 'project_totals';
}

type NormalizedSelection = FinancialStatementSelection;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_KINDS = ['month', 'quarter', 'fiscal_year'] as const;
const STATEMENTS = ['trial_balance', 'profit_and_loss', 'balance_sheet'] as const;
const VIEW_KINDS = ['account_breakdown', 'project_totals'] as const;
const INVALID_INPUT = 'Invalid financial statement request.';
const INVALID_RESPONSE = 'The statement service returned an invalid response.';
const SNAPSHOT_CHANGED = 'Statement data changed while it was being read. Please try again.';

function invalidInput(): never {
  throw new AppError(INVALID_INPUT, 'statement-invalid-input');
}

function strictObject(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidInput();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidInput();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return invalidInput();
  const names = keys as string[];
  if (names.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) return invalidInput();
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return invalidInput();
  }
  return value as Record<string, unknown>;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day >= 1 && day <= days;
}

function normalizeCatalogueOptions(value: unknown = {}): string | null {
  const options = strictObject(value, ['projectId']);
  if (!Object.hasOwn(options, 'projectId')) return null;
  if (typeof options.projectId !== 'string' || !UUID.test(options.projectId)) return invalidInput();
  return options.projectId.toLowerCase();
}

function normalizeSelection(value: unknown): NormalizedSelection {
  const input = strictObject(value, ['periodKind', 'periodStart', 'statement', 'projectId', 'viewKind'], ['periodKind', 'periodStart', 'statement']);
  if (typeof input.periodKind !== 'string' || !(PERIOD_KINDS as readonly string[]).includes(input.periodKind)) return invalidInput();
  if (!validDate(input.periodStart)) return invalidInput();
  if (typeof input.statement !== 'string' || !(STATEMENTS as readonly string[]).includes(input.statement)) return invalidInput();

  let projectId: string | null = null;
  if (Object.hasOwn(input, 'projectId')) {
    if (typeof input.projectId !== 'string' || !UUID.test(input.projectId)) return invalidInput();
    projectId = input.projectId.toLowerCase();
  }
  let viewKind: 'account_breakdown' | 'project_totals' = 'account_breakdown';
  if (Object.hasOwn(input, 'viewKind')) {
    if (typeof input.viewKind !== 'string' || !(VIEW_KINDS as readonly string[]).includes(input.viewKind)) return invalidInput();
    viewKind = input.viewKind as 'account_breakdown' | 'project_totals';
  }
  const statement = input.statement as FinancialStatementKind;
  if (projectId !== null && statement !== 'profit_and_loss') return invalidInput();
  if (viewKind === 'project_totals' && (projectId === null || statement !== 'profit_and_loss')) return invalidInput();
  const scopeKind = projectId !== null ? 'project' : 'company';
  return {
    periodKind: input.periodKind as FinancialStatementPeriodKind,
    periodStart: input.periodStart,
    statement: input.statement as FinancialStatementKind,
    scopeKind,
    projectId,
    viewKind,
  };
}

function responseError(error: { message: string; code?: string; details?: string }): AppError {
  return new AppError(error.message, error.code, error.details);
}

function parseCatalogueResponse(data: unknown): FinancialStatementCatalogue {
  try {
    return parseFinancialStatementCatalogue(data);
  } catch {
    throw new AppError(INVALID_RESPONSE, 'statement-invalid-response');
  }
}

function parseReadResponse(data: unknown, selection: FinancialStatementSelection): FinancialStatementRead {
  try {
    return parseFinancialStatementRead(data, selection);
  } catch {
    throw new AppError(INVALID_RESPONSE, 'statement-invalid-response');
  }
}

export async function getFinancialStatementCatalogue(
  options: FinancialStatementCatalogueOptions = {},
): Promise<FinancialStatementCatalogue> {
  const projectId = normalizeCatalogueOptions(options);
  const { data, error } = await supabase.rpc('get_financial_statement_catalogue', { p_project_id: projectId });
  if (error) throw responseError(error);
  return parseCatalogueResponse(data);
}

function sameGeneration(
  left: FinancialStatementCatalogue['generation'] | FinancialStatementRead['generation'],
  right: FinancialStatementCatalogue['generation'] | FinancialStatementRead['generation'],
): boolean {
  if (left === null || right === null) return left === right;
  return left.snapshotId === right.snapshotId && left.sourceGeneration === right.sourceGeneration &&
    left.asOf === right.asOf && left.captureStartedAt === right.captureStartedAt &&
    left.captureCompletedAt === right.captureCompletedAt && left.currency === right.currency &&
    left.presentation.precision === right.presentation.precision &&
    left.presentation.roundingMethod === right.presentation.roundingMethod;
}

function samePair(left: FinancialStatementPair, right: FinancialStatementPair): boolean {
  return left.kind === right.kind && left.currentStart === right.currentStart && left.currentEnd === right.currentEnd &&
    left.priorStart === right.priorStart && left.priorEnd === right.priorEnd;
}

function completeReadBelongsToCatalogue(
  catalogue: FinancialStatementCatalogue,
  read: FinancialStatementRead,
): boolean {
  if (read.state !== 'complete' || !read.result) return true;
  const selection = read.selection;
  const pair = read.result.period;
  return catalogue.periods.some((candidate) => samePair(candidate, pair)) && catalogue.scopes.some((scope) =>
    scope.scopeKind === selection.scopeKind && scope.projectId === selection.projectId &&
    scope.statements.includes(selection.statement) && scope.viewKinds.includes(selection.viewKind));
}

async function readCatalogue(projectId: string | null): Promise<FinancialStatementCatalogue> {
  const { data, error } = await supabase.rpc('get_financial_statement_catalogue', { p_project_id: projectId });
  if (error) throw responseError(error);
  return parseCatalogueResponse(data);
}

async function readStatement(input: NormalizedSelection): Promise<FinancialStatementRead> {
  const { data, error } = await supabase.rpc('get_financial_statement', {
    p_period_kind: input.periodKind,
    p_period_start: input.periodStart,
    p_statement: input.statement,
    p_project_id: input.projectId,
    p_view_kind: input.viewKind,
    p_unassigned: false,
  });
  if (error) throw responseError(error);
  const expected: FinancialStatementSelection = {
    periodKind: input.periodKind,
    periodStart: input.periodStart,
    statement: input.statement,
    scopeKind: input.scopeKind,
    projectId: input.projectId,
    viewKind: input.viewKind,
  };
  return parseReadResponse(data, expected);
}

export async function getFinancialStatement(value: GetFinancialStatementInput): Promise<FinancialStatementRead> {
  const input = normalizeSelection(value);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const catalogue = await readCatalogue(input.projectId);
    const read = await readStatement(input);
    if (sameGeneration(catalogue.generation, read.generation) && catalogue.companyLabel === read.companyLabel &&
        completeReadBelongsToCatalogue(catalogue, read)) return read;
  }
  throw new AppError(SNAPSHOT_CHANGED, 'statement-snapshot-changed');
}
