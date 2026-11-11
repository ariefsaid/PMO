/**
 * Project ↔ cost account verbs (#1504 S6, FR-ODC-070/071/073). Odoo's Project application is never involved: a PMO project
 * links to an analytic account of the chosen plan, read from the mirror. Who may link or un-link is decided by the actor-checked
 * RPCs (the caller is the actor), so the router gate only needs an active member. Odoo is not called.
 */
import { odooError, type OdooCtx } from './router.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ODOO_ID = /^[0-9]{1,9}$/;
/** A picker page; searching a bigger plan arrives with the picker (S5). */
const ACCOUNT_LIMIT = 1000;

const mirror = (c: OdooCtx, kind: string) => c.sc.from('external_master_records').select('external_id, code, name')
  .eq('org_id', c.orgId).eq('external_tier', 'odoo').eq('kind', kind).eq('active', true).is('tombstoned_at', null);

export async function listProjects(c: OdooCtx): Promise<Response> {
  const { data: binding, error } = await c.sc.from('external_org_bindings').select('config').eq('org_id', c.orgId).eq('external_tier', 'odoo').maybeSingle();
  if (error || !binding) return odooError(c, 'The Odoo connection could not be read', 'STORE_FAILED', 500);
  const plan = (binding.config as Record<string, unknown> | null)?.analytic_plan_id;
  if (!Number.isInteger(plan)) {
    const { data: plans, error: planError } = await mirror(c, 'analytic_plan').order('external_id');
    if (planError) return odooError(c, 'The plans could not be read', 'STORE_FAILED', 500);
    return c.respond({ planId: null, plans: (plans ?? []).map((p) => ({ id: p.external_id, name: p.name })), accounts: [], linked: [] });
  }
  const [accounts, links] = await Promise.all([
    mirror(c, 'analytic_account').eq('parent_external_id', String(plan)).order('code').limit(ACCOUNT_LIMIT + 1),   // one more than a page, to know whether there is more
    c.sc.from('external_project_bindings').select('project_id, external_container_id, config').eq('org_id', c.orgId).eq('external_tier', 'odoo'),
  ]);
  if (accounts.error || links.error) return odooError(c, 'The cost accounts could not be read', 'STORE_FAILED', 500);
  return c.respond({
    planId: plan,
    accounts: (accounts.data ?? []).slice(0, ACCOUNT_LIMIT).map((a) => ({ id: a.external_id, code: a.code, name: a.name })),
    truncated: (accounts.data ?? []).length > ACCOUNT_LIMIT,
    // `attention` is why a link needs a person's eye (archived, tombstoned, moved-company), set by the sweep's reconciliation (AC-ODC-054)
    linked: (links.data ?? []).map((l) => ({ projectId: l.project_id, accountId: l.external_container_id, attention: ((l.config as Record<string, unknown> | null)?.attention as string | undefined) ?? null })),
  });
}

/** The databases' own words for P0001 / 23505 are plain (they name a project number at most); anything else is not ours to explain. */
function refusal(c: OdooCtx, e: { code?: string; message?: string }): Response {
  if (e.code === '42501') return odooError(c, 'Not allowed for your role', 'FORBIDDEN', 403);
  if (e.code === 'P0001' || e.code === '23505') return odooError(c, e.message ?? 'The request was refused', 'REFUSED', 409);
  return odooError(c, 'The request could not be completed', 'STORE_FAILED', 500);
}

export async function linkProject(c: OdooCtx): Promise<Response> {
  const { projectId, accountId } = c.body;
  if (typeof projectId !== 'string' || !UUID.test(projectId) || typeof accountId !== 'string' || !ODOO_ID.test(accountId)) return odooError(c, 'projectId and accountId are required', 'BAD_REQUEST', 400);
  const { error } = await c.sc.rpc('link_odoo_cost_account', { p_org_id: c.orgId, p_actor_id: c.userId, p_project_id: projectId, p_account_id: accountId });
  return error ? refusal(c, error) : c.respond({ linked: true });
}

export async function unlinkProject(c: OdooCtx): Promise<Response> {
  const { projectId } = c.body;
  if (typeof projectId !== 'string' || !UUID.test(projectId)) return odooError(c, 'projectId is required', 'BAD_REQUEST', 400);
  const { error } = await c.sc.rpc('unlink_odoo_cost_account', { p_org_id: c.orgId, p_actor_id: c.userId, p_project_id: projectId });
  return error ? refusal(c, error) : c.respond({ unlinked: true });
}

export async function setAnalyticPlan(c: OdooCtx): Promise<Response> {
  const { planId } = c.body;
  if (typeof planId !== 'string' || !ODOO_ID.test(planId)) return odooError(c, 'planId is required', 'BAD_REQUEST', 400);
  const { error } = await c.sc.rpc('set_odoo_analytic_plan', { p_org_id: c.orgId, p_actor_id: c.userId, p_plan_id: planId });
  return error ? refusal(c, error) : c.respond({ planId: Number(planId) });
}
