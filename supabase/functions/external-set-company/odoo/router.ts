/**
 * external-set-company — the Odoo router (#1504 S2, PQ-12): the same function and verbs as ERPNext, `tier: 'odoo'`.
 * The router owns the active-member check and the per-verb role gates, because later Odoo verbs (S3+) allow
 * Finance and project managers where the ERPNext path is Admin-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { activate, listCompanies } from './activate.ts';

export interface OdooCtx {
  sc: SupabaseClient;
  orgId: string;
  userId: string;
  role: string;
  operator: boolean;
  body: Record<string, unknown>;
  respond: (body: unknown, status?: number) => Response;
}

const adminOrOperator = (c: OdooCtx) => c.role === 'Admin' || c.operator;
const GATES: Record<string, (c: OdooCtx) => boolean> = { 'list-companies': adminOrOperator, activate: adminOrOperator };
const VERBS: Record<string, (c: OdooCtx) => Promise<Response>> = { 'list-companies': listCompanies, activate };

export function odooError(c: OdooCtx, message: string, code: string, status: number): Response {
  return c.respond({ error: code, message }, status);
}

export async function routeOdoo(c: OdooCtx): Promise<Response> {
  const verb = typeof c.body.setupAction === 'string' ? c.body.setupAction : 'activate';
  const { data: state, error } = await c.sc.rpc('actor_authorization_state', { p_org_id: c.orgId, p_user_id: c.userId });
  if (error || (state as { active?: unknown } | null)?.active !== true) return odooError(c, 'Only an active member can do this', 'FORBIDDEN', 403);
  if (!Object.hasOwn(VERBS, verb)) return odooError(c, 'Unknown action', 'BAD_REQUEST', 400);
  if (!GATES[verb](c)) return odooError(c, 'Not allowed for your role', 'FORBIDDEN', 403);
  return await VERBS[verb](c);
}
