/**
 * ECA-6 (#1603, PD-ECA-12/13, FR-ECA-041) — the read-only half of "the ERP already holds a budget PMO did not create".
 *
 *   inspect       name the exact ERP budget a replace would touch (the UI shows it in the confirm).
 *   use-as-draft  turn that ERP budget's figures into a PMO Draft version. The ERP is only read.
 *
 * The third way forward, replace, is NOT here: it is the ordinary push, which `dispatchBudget.ts` lets amend the
 * document only while a recorded consent names it. No outbox row is written here (nothing goes to the ERP).
 *
 * Admin/Finance only. Own gate rather than `checkErpnextCommandAuthorization`: `budget-occupant` is a request, not an
 * ERP document kind, so it must not enter `KIND_DOMAIN` (the sweep polls every kind in the doctype registry).
 */
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { getDoc, type ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { readBudgetGrain } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchBudget.ts';
import { resolveErpProjectName } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchRefs.ts';
import type { DispatchServiceClient } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchTypes.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { AuthorizationClient } from './authGuard.ts';
import { dispatchErrorStatus } from './dispatchErrorStatus.ts';
import { fromCents, toCents } from '../../../pmo-portal/src/lib/budget/budgetAmount.ts';
import { isCanonicalUuid } from './transitionTargetGuard.ts';

const OCCUPANT_ROLES = ['Admin', 'Finance'] as const;

export function isBudgetOccupantCommand(command: AdapterCommand): boolean {
  return command.domain === 'budget' && (command.record as { erp_doc_kind?: unknown }).erp_doc_kind === 'budget-occupant';
}

/** Active ERPNext binding, and an active Admin or Finance member, judged on database truth. */
export async function authorizeBudgetOccupant(
  client: AuthorizationClient,
  orgId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const employed = await client.rpc('org_has_active_erpnext_binding', { p_org_id: orgId });
  if (employed.error || employed.data !== true) return { ok: false, status: 403, message: 'org has no active ERPNext binding' };
  const state = await client.rpc('actor_authorization_state', { p_org_id: orgId, p_user_id: userId });
  const actor = state.data as { role: string | null; active: boolean } | null;
  if (state.error || !actor) return { ok: false, status: 403, message: 'caller role not resolvable' };
  if (!actor.active || !actor.role || !(OCCUPANT_ROLES as readonly string[]).includes(actor.role)) {
    return { ok: false, status: 403, message: 'only an Admin or Finance member can resolve an existing ERP budget' };
  }
  return { ok: true };
}

export interface BudgetOccupantDeps {
  command: AdapterCommand;
  orgId: string;
  /** The caller's own JWT: the Draft is created under their RLS, never the service role. */
  callerClient: { rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string; code?: string } | null }> };
  serviceClient: DispatchServiceClient;
  binding: { version_major: number | null; config: Record<string, unknown> | null };
  erp: ErpClientDeps;
}

export type BudgetOccupantReply = { status: number; body: Record<string, unknown> };

const refuse = (message: string, code = 'commit-rejected'): never => { throw new AppError(message, code); };

/** Exact integer cents, by the same parser the push uses (`toCents`), so the draft and the push agree to the cent. */
function cents(amount: unknown): number {
  try {
    const c = toCents(String(amount));
    if (c >= 0) return c;
  } catch { /* falls through to the refusal */ }
  return refuse('the ERP budget holds an amount PMO cannot read');
}

/** The ERP budget's (account, amount) rows: one document row on ERPNext 16, the `accounts` table on 15. */
function erpRows(doc: Record<string, unknown>, major: 15 | 16, account: string | null): Array<{ account: string; amount: number }> {
  if (major === 16) {
    if (doc.account !== account) refuse('the ERP budget is not on the requested account');
    return [{ account: String(doc.account), amount: cents(doc.budget_amount) }];
  }
  const accounts = Array.isArray(doc.accounts) ? (doc.accounts as Array<Record<string, unknown>>) : [];
  return accounts.map((row) => ({ account: String(row.account), amount: cents(row.budget_amount) }));
}

async function run(d: BudgetOccupantDeps): Promise<BudgetOccupantReply> {
  const rec = d.command.record as Record<string, unknown>;
  const major = d.binding.version_major;
  if (major !== 15 && major !== 16) return refuse('the ERP binding version is not supported', 'config-rejected');
  const action = rec.action;
  if (action !== 'inspect' && action !== 'use-as-draft') return refuse('unknown action');
  const projectId = rec.projectId;
  const fiscalYear = rec.fiscalYear;
  const account = typeof rec.erpAccount === 'string' && rec.erpAccount ? rec.erpAccount : null;
  if (typeof projectId !== 'string' || !isCanonicalUuid(projectId) || typeof fiscalYear !== 'string' || !fiscalYear
      || (major === 16 && !account)) {
    return refuse('projectId, fiscalYear and (on ERPNext 16) erpAccount are required');
  }
  const company = d.binding.config?.company;
  const project = resolveErpProjectName(d.binding.config ?? undefined, projectId);
  if (typeof company !== 'string' || !company || !project) return refuse('this project is not linked to an ERP project', 'config-rejected');

  const live = (await readBudgetGrain(d.erp, { company, project, major, account, fiscalYear }))
    .filter((row) => Number(row.docstatus) === 1).map((row) => String(row.name));
  if (live.length !== 1) {
    return refuse(live.length === 0
      ? 'the ERP holds no live budget for this project, account and year'
      : `the ERP holds ${live.length} live budgets for this project, account and year (${live.join(', ')}); an operator must resolve the duplicate first`);
  }
  const name = live[0];
  if (action === 'inspect') return { status: 200, body: { erpBudgetName: name, erpAccount: account ?? '', fiscalYear } };

  const rows = erpRows(await getDoc(d.erp, 'Budget', name) as Record<string, unknown>, major, account);
  const { data: map, error: mapError } = await d.serviceClient
    .from('budget_category_account_map').select('category, erp_account').eq('org_id', d.orgId);
  if (mapError) return refuse(`the category map could not be read: ${mapError.message}`);
  const categoryOf = new Map((map as Array<{ category: string; erp_account: string }>).map((m) => [m.erp_account, m.category]));
  // Never a draft that silently totals less than the ERP budget.
  const unmapped = rows.filter((r) => !categoryOf.has(r.account)).map((r) => r.account);
  if (unmapped.length > 0) return refuse(`Map these ERP accounts to a budget category first: ${unmapped.join(', ')}`, 'budget-category-unmapped');

  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(categoryOf.get(r.account)!, (byCategory.get(categoryOf.get(r.account)!) ?? 0) + r.amount);
  const lines = [...byCategory].filter(([, c]) => c > 0)
    .map(([category, c]) => ({ category, budgeted_amount: fromCents(c), fiscal_year: fiscalYear }));
  if (lines.length === 0) return refuse('the ERP budget holds no amount to copy');

  const created = await d.callerClient.rpc('create_budget_draft_from_erp', {
    p_project_id: projectId, p_erp_budget_name: name, p_lines: lines,
  });
  if (created.error || typeof created.data !== 'string') {
    return refuse(created.error?.message ?? 'the draft could not be created', created.error?.code === '42501' ? 'forbidden' : 'commit-rejected');
  }
  return { status: 200, body: { draftVersionId: created.data } };
}

export async function runBudgetOccupant(d: BudgetOccupantDeps): Promise<BudgetOccupantReply> {
  try {
    return await run(d);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    return {
      status: code === 'forbidden' ? 403 : dispatchErrorStatus(code, 500),
      body: { error: typeof code === 'string' ? code : 'DISPATCH_FAILED', message: err instanceof Error ? err.message : 'failed' },
    };
  }
}
