/**
 * Odoo ledger reads and the basis switch (#1507 S7). One RPC per call, the database decides who may read; nothing here
 * sends an org, a company or a role. Money stays a decimal string end to end (NFR-ODA-001); a missing figure is `null`, never 0.
 */
import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';

export type OdooLedgerState = 'fresh' | 'stale' | 'catching-up' | 'unavailable';
export type OdooCheckStatus = 'matches' | 'differs' | 'not-checked';
export type OdooStatementKind = 'trial_balance' | 'profit_and_loss' | 'balance_sheet';
export type OdooPeriodKind = 'month' | 'quarter' | 'fiscal_year';

export interface OdooDebitCredit { debit: string; credit: string }
export interface OdooCheckAccount { account: string; pmo: OdooDebitCredit; odoo: OdooDebitCredit }
export interface OdooLedgerCheck {
  status: OdooCheckStatus;
  checkedAt: string | null;
  reason: string | null;
  accountsChecked: number;
  /** The check covered an older feed position, so it no longer vouches for the figures. */
  stale: boolean;
  accounts: OdooCheckAccount[];
}
export interface OdooAmountGroup extends OdooDebitCredit { count: number }
export interface OdooUnmappedGroup extends OdooAmountGroup { accounts: string[] }
export interface OdooLedgerHealth {
  state: OdooLedgerState;
  asOf: string | null;
  caughtUp: boolean;
  lastCensus: string | null;
  /** Admin, Finance and Executive only; null for everyone else. */
  check: OdooLedgerCheck | null;
  lastGood: OdooLedgerCheck | null;
  unmapped: OdooUnmappedGroup | null;
  unattributed: OdooAmountGroup | null;
  unlinked: OdooAmountGroup | null;
}

export interface OdooLedgerLine { id: string; date: string | null; moveName: string; account: string; partner: string | null; debit: string; credit: string }
export interface OdooLedgerLinesPage { lines: OdooLedgerLine[]; next: string | null; limit: number; linked: boolean }

export interface OdooStatementPair { kind: OdooPeriodKind; currentStart: string; currentEnd: string; priorStart: string; priorEnd: string }
export interface OdooStatementScope { scopeKind: 'company' | 'project'; projectId: string | null; statements: OdooStatementKind[]; viewKinds: string[] }
export type OdooStatementCatalogue =
  | { state: 'not_in_use' }
  | { state: 'unavailable'; companyLabel: string | null }
  | { state: 'complete'; companyLabel: string | null; asOf: string | null; periods: OdooStatementPair[]; scopes: OdooStatementScope[] };

export type OdooStatementRow = Readonly<Record<string, string | number | boolean | null>>;
export interface OdooStatementSide { columns: Array<{ fieldname: string; label: string; type: 'text' | 'currency' }>; rows: OdooStatementRow[]; summary: OdooStatementRow[] }
export interface OdooStatementProvenance {
  ledgerAsOf: string | null;
  caughtUp: boolean | null;
  lastCheck: { status: OdooCheckStatus; checkedAt: string | null } | null;
  scope: 'company' | 'project';
  unattributed: OdooAmountGroup | null;
  unlinked: OdooAmountGroup | null;
  unclassified: { count: number; balance: string } | null;
}
export type OdooStatementRead =
  | { state: 'not_in_use' }
  | { state: 'unavailable'; companyLabel: string | null }
  | {
    state: 'complete';
    companyLabel: string | null;
    viewKind: 'account_breakdown' | 'project_totals';
    period: OdooStatementPair;
    hasActivity: boolean;
    current: OdooStatementSide;
    prior: OdooStatementSide;
    provenance: OdooStatementProvenance;
  };

export interface GetOdooStatementInput { statement: OdooStatementKind; periodKind: OdooPeriodKind; periodStart: string; projectId?: string }
export interface SwitchOdooLedgerBasisInput { confirmDifference?: boolean; reason?: string }

type Rec = Record<string, unknown>;
type RpcClient = { rpc: (fn: string, args?: Rec) => PromiseLike<{ data: unknown; error: { message: string; code?: string; details?: string } | null }> };

const INVALID_RESPONSE = 'The ledger service returned an invalid response.';
const INVALID_INPUT = 'Invalid ledger request.';
const bad = (): never => { throw new AppError(INVALID_RESPONSE, 'odoo-ledger-invalid-response'); };
const STATES: readonly string[] = ['fresh', 'stale', 'catching-up', 'unavailable'];
const CHECKS: readonly string[] = ['matches', 'differs', 'not-checked'];
const STATEMENTS: readonly string[] = ['trial_balance', 'profit_and_loss', 'balance_sheet'];
const PERIOD_KINDS: readonly string[] = ['month', 'quarter', 'fiscal_year'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIRST_OF_MONTH = /^\d{4}-\d{2}-01$/;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const money = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : bad());
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : bad());

async function call(fn: string, args: Rec): Promise<unknown> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(fn, args);
  if (error) throw new AppError(error.message, error.code, error.details);
  return data;
}

function debitCredit(v: unknown): OdooDebitCredit {
  if (!isRec(v)) return bad();
  return { debit: money(v.debit), credit: money(v.credit) };
}
function amountGroup(v: unknown): OdooAmountGroup | null {
  if (v === null || v === undefined) return null;
  if (!isRec(v)) return bad();
  return { count: num(v.count), ...debitCredit(v) };
}
function check(v: unknown): OdooLedgerCheck | null {
  if (v === null || v === undefined) return null;
  if (!isRec(v) || typeof v.status !== 'string' || !CHECKS.includes(v.status)) return bad();
  const accounts = Array.isArray(v.accounts) ? v.accounts : [];
  return {
    status: v.status as OdooCheckStatus,
    checkedAt: str(v.checkedAt),
    reason: str(v.reason),
    accountsChecked: typeof v.accountsChecked === 'number' ? v.accountsChecked : 0,
    stale: v.stale === true,
    accounts: accounts.map((a) => {
      if (!isRec(a) || typeof a.account !== 'string') return bad();
      return { account: a.account, pmo: debitCredit(a.pmo), odoo: debitCredit(a.odoo) };
    }),
  };
}

export async function getOdooLedgerHealth(projectId?: string): Promise<OdooLedgerHealth> {
  if (projectId !== undefined && !UUID.test(projectId)) throw new AppError(INVALID_INPUT, 'odoo-ledger-invalid-input');
  const d = await call('get_odoo_ledger_health', { p_project_id: projectId ?? null });
  if (!isRec(d) || typeof d.state !== 'string' || !STATES.includes(d.state) || typeof d.caughtUp !== 'boolean') return bad();
  const unmapped = amountGroup(d.unmapped);
  return {
    state: d.state as OdooLedgerState,
    asOf: str(d.asOf),
    caughtUp: d.caughtUp,
    lastCensus: str(d.lastCensus),
    check: check(d.check),
    lastGood: check(d.lastGood),
    unmapped: unmapped && { ...unmapped, accounts: isRec(d.unmapped) && Array.isArray(d.unmapped.accounts) ? d.unmapped.accounts.filter((a): a is string => typeof a === 'string') : [] },
    unattributed: amountGroup(d.unattributed),
    unlinked: amountGroup(d.unlinked),
  };
}

export async function getOdooLedgerLines(input: { projectId: string; category: string; after?: string | null; limit?: number }): Promise<OdooLedgerLinesPage> {
  if (!UUID.test(input.projectId) || input.category.trim() === '') throw new AppError(INVALID_INPUT, 'odoo-ledger-invalid-input');
  const d = await call('get_odoo_ledger_lines', { p_project_id: input.projectId, p_category: input.category, p_after: input.after ?? null, p_limit: input.limit ?? 50 });
  if (!isRec(d) || !Array.isArray(d.lines) || typeof d.linked !== 'boolean') return bad();
  return {
    linked: d.linked,
    limit: num(d.limit),
    next: str(d.next),
    lines: d.lines.map((l) => {
      if (!isRec(l) || typeof l.id !== 'string' || typeof l.moveName !== 'string' || typeof l.account !== 'string') return bad();
      return { id: l.id, date: str(l.date), moveName: l.moveName, account: l.account, partner: str(l.partner), debit: money(l.debit), credit: money(l.credit) };
    }),
  };
}

function pair(v: unknown): OdooStatementPair {
  if (!isRec(v) || typeof v.kind !== 'string' || !PERIOD_KINDS.includes(v.kind)) return bad();
  const date = (x: unknown) => (typeof x === 'string' ? x : bad());
  return { kind: v.kind as OdooPeriodKind, currentStart: date(v.currentStart), currentEnd: date(v.currentEnd), priorStart: date(v.priorStart), priorEnd: date(v.priorEnd) };
}

export async function getOdooStatementCatalogue(projectId?: string): Promise<OdooStatementCatalogue> {
  if (projectId !== undefined && !UUID.test(projectId)) throw new AppError(INVALID_INPUT, 'odoo-ledger-invalid-input');
  const d = await call('get_odoo_statement_catalogue', { p_project_id: projectId ?? null });
  if (!isRec(d)) return bad();
  if (d.state === 'not_in_use') return { state: 'not_in_use' };
  if (d.state === 'unavailable') return { state: 'unavailable', companyLabel: str(d.companyLabel) };
  if (d.state !== 'complete' || !Array.isArray(d.periods) || !Array.isArray(d.scopes)) return bad();
  return {
    state: 'complete',
    companyLabel: str(d.companyLabel),
    asOf: isRec(d.generation) ? str(d.generation.asOf) : null,
    periods: d.periods.map(pair),
    scopes: d.scopes.map((s) => {
      if (!isRec(s) || (s.scopeKind !== 'company' && s.scopeKind !== 'project') || !Array.isArray(s.statements)) return bad();
      return { scopeKind: s.scopeKind, projectId: str(s.projectId), statements: s.statements.filter((x): x is OdooStatementKind => typeof x === 'string' && STATEMENTS.includes(x)), viewKinds: Array.isArray(s.viewKinds) ? s.viewKinds.filter((x): x is string => typeof x === 'string') : [] };
    }),
  };
}

function side(v: unknown): OdooStatementSide {
  if (!isRec(v)) return bad();
  const rows = (x: unknown): OdooStatementRow[] => (Array.isArray(x) ? x.map((r) => (isRec(r) ? (r as OdooStatementRow) : bad())) : []);
  return {
    columns: Array.isArray(v.columns) ? v.columns.flatMap((c) => (isRec(c) && typeof c.fieldname === 'string' && typeof c.label === 'string' ? [{ fieldname: c.fieldname, label: c.label, type: c.type === 'currency' ? 'currency' as const : 'text' as const }] : [])) : [],
    rows: rows(v.rows),
    summary: rows(v.summary),
  };
}

function provenance(v: unknown): OdooStatementProvenance {
  if (!isRec(v)) return bad();
  const lc = v.lastCheck;
  const un = v.unclassified;
  return {
    ledgerAsOf: str(v.ledgerAsOf),
    caughtUp: typeof v.caughtUp === 'boolean' ? v.caughtUp : null,
    lastCheck: isRec(lc) && typeof lc.status === 'string' && CHECKS.includes(lc.status) ? { status: lc.status as OdooCheckStatus, checkedAt: str(lc.checkedAt) } : null,
    scope: v.scope === 'project' ? 'project' : 'company',
    unattributed: amountGroup(v.unattributed),
    unlinked: amountGroup(v.unlinked),
    unclassified: isRec(un) ? { count: num(un.count), balance: money(un.balance) } : null,
  };
}

export async function getOdooStatement(input: GetOdooStatementInput): Promise<OdooStatementRead> {
  if (!STATEMENTS.includes(input.statement) || !PERIOD_KINDS.includes(input.periodKind) || !FIRST_OF_MONTH.test(input.periodStart) ||
      (input.projectId !== undefined && !UUID.test(input.projectId))) throw new AppError(INVALID_INPUT, 'odoo-ledger-invalid-input');
  const d = await call('get_odoo_statement', { p_kind: input.statement, p_period: { kind: input.periodKind, start: input.periodStart }, p_project_id: input.projectId ?? null });
  if (!isRec(d)) return bad();
  if (d.state === 'not_in_use') return { state: 'not_in_use' };
  if (d.state === 'unavailable') return { state: 'unavailable', companyLabel: str(d.companyLabel) };
  const r = d.result;
  if (d.state !== 'complete' || !isRec(r) || !isRec(r.payload)) return bad();
  const projectTotals = r.viewKind === 'project_totals';
  const empty: OdooStatementSide = { columns: [], rows: [], summary: [] };
  return {
    state: 'complete',
    companyLabel: str(d.companyLabel),
    viewKind: projectTotals ? 'project_totals' : 'account_breakdown',
    period: pair(r.period),
    hasActivity: r.hasActivity === true,
    // The narrow project reader (Project Manager, Engineer) returns {income, expense, net} per period, shown as one summary row.
    current: projectTotals ? { ...empty, summary: [r.payload.current as OdooStatementRow] } : side(r.payload.current),
    prior: projectTotals ? { ...empty, summary: [r.payload.prior as OdooStatementRow] } : side(r.payload.prior),
    provenance: projectTotals ? { ledgerAsOf: isRec(d.generation) ? str(d.generation.asOf) : null, caughtUp: null, lastCheck: null, scope: 'project', unattributed: null, unlinked: null, unclassified: null } : provenance(r.provenance),
  };
}

/** Whether an Odoo cost account is linked to the project (any member who can see the project reads its binding). */
export async function getOdooProjectLinked(projectId: string): Promise<boolean> {
  if (!UUID.test(projectId)) throw new AppError(INVALID_INPUT, 'odoo-ledger-invalid-input');
  const { data, error } = await supabase.from('external_project_bindings').select('id')
    .eq('project_id', projectId).eq('external_tier', 'odoo').is('disconnected_at', null).limit(1);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).length > 0;
}

/** Admin only (the RPC re-checks the real role). A refusal keeps its reason slug as the message and `P0001` as the code. */
export async function switchOdooLedgerBasis(input: SwitchOdooLedgerBasisInput = {}): Promise<string> {
  const reason = input.reason?.trim() || null;
  const d = await call('switch_odoo_ledger_basis', { p_confirm_difference: input.confirmDifference === true, p_reason: reason });
  return typeof d === 'string' ? d : bad();
}
