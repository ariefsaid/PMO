import { supabase } from '@/src/lib/supabase/client';

/**
 * org_plans read — the CALLER-SCOPED org plan (plans S4, FR-PLN-016: the plan becomes a PostHog group
 * property; S3's "Your plan" page reads it too).
 *
 * The plan tables have no API-role path at all (migration 0530: force RLS, no policies, grants revoked
 * from `anon`/`authenticated`/`service_role`), so a member CANNOT read `org_plans` directly. The one
 * member-readable projection is S3's `resolved_org_plan()` (migration 0537, shipped with the console
 * slice): own org only (`auth_org_id()`), active member required, stable security definer, granted to
 * `authenticated`, and it returns the Enterprise row when the org has no explicit plan (0530: an absent
 * plan resolves Enterprise).
 *
 * ⚑ Cross-lane dependency: until 0537 lands, this RPC does not exist. The FIRST call therefore fails
 * with a "no such function" error, and that answer is remembered for the rest of the page load, so a
 * deployment without the projection never fires a failing request per session (or per stale window).
 * Nothing is registered. It never throws and never blocks a render: a plan read is ANALYTICS, not a
 * gate, so an unavailable plan degrades to "no group property" and nothing else.
 *
 * Why the cast: `src/lib/supabase/database.types.ts` is generated from the deployed schema and does not
 * know `resolved_org_plan` yet. Regenerating it here would be a false claim about the DB; the narrow
 * local type keeps the call honest until the generator catches up.
 */

/** A plan row as `resolved_org_plan()` returns it. */
export interface OrgPlan {
  plan_id: string;
  plan_name: string;
  seat_limit: number | null;
  project_limit: number | null;
  ai_monthly_messages: number | null;
}

interface RpcResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

type UnresolvedPlanRpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;

/** The caller-scoped plan projection (S3). Named once so a rename is one edit AND one test. */
export const RESOLVED_ORG_PLAN_RPC = 'resolved_org_plan';

/**
 * Errors that mean the FUNCTION IS NOT THERE (this deployment predates S3), as opposed to a transient
 * failure: PostgREST's `PGRST202`/`PGRST203` (not in the schema cache / ambiguous) and Postgres'
 * `42883` (undefined_function), plus a bare 404. Only these latch.
 */
const MISSING_RPC_CODES: ReadonlySet<string> = new Set(['PGRST202', 'PGRST203', '42883', '404']);

/** Latched once the deployment is known not to have the projection — one probe per page load. */
let unavailable = false;

/** Is THIS error the "no such function" shape? (Transient errors must not latch.) */
export function isMissingRpcError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (typeof error.code === 'string' && MISSING_RPC_CODES.has(error.code)) return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('could not find the function') || message.includes('does not exist');
}

/** Coerce one RPC row into an `OrgPlan`, or null when the shape is not what 0537 promises. */
function toOrgPlan(row: unknown): OrgPlan | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.plan_id !== 'string' || !r.plan_id) return null;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    plan_id: r.plan_id,
    plan_name: typeof r.plan_name === 'string' ? r.plan_name : r.plan_id,
    seat_limit: num(r.seat_limit),
    project_limit: num(r.project_limit),
    ai_monthly_messages: num(r.ai_monthly_messages),
  };
}

/**
 * The caller's own org plan, or `null` when it cannot be resolved (RPC absent from this deployment,
 * no session, transport error). Never throws.
 */
export async function getOwnOrgPlan(): Promise<OrgPlan | null> {
  if (unavailable) return null; // one probe per page load: nothing here can make the RPC appear
  try {
    const rpc = supabase.rpc as unknown as UnresolvedPlanRpc;
    const { data, error } = await rpc(RESOLVED_ORG_PLAN_RPC);
    if (error) {
      if (isMissingRpcError(error)) unavailable = true;
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return toOrgPlan(row);
  } catch {
    return null;
  }
}
