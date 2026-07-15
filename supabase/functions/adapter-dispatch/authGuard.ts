// Luna money audit — BLOCK 4: server-side authorization gate for erpnext-tier commands.
// Extracted as a pure/testable module so the dispatch-path enforcement is unit-provable.
// The adapter-dispatch edge function MUST invoke this BEFORE any adapter/outbox/ERP write.
//
// Checks (in order):
// (a) caller's org owns the command's domain → public.domain_externally_owned(orgId, domain) via deputy client
// (b) caller's role is permitted for money write → Admin/Executive/Project Manager/Finance (MONEY_AUTHOR_ROLES)
// (c) command.domain matches KIND_DOMAIN[erp_doc_kind] → rejects cross-domain kinds (e.g. domain:'procurement' with erp_doc_kind:'incoming-payment')
import { KIND_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The role set permitted for money writes (matches can()'s MONEY_AUTHOR_ROLES in auth/policy.ts). */
export const MONEY_WRITE_ROLES = ['Admin', 'Executive', 'Project Manager', 'Finance'] as const;
export type MoneyWriteRole = (typeof MONEY_WRITE_ROLES)[number];

/** Structural client for the domain ownership RPC + profiles read (via deputy client). */
export interface AuthorizationClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): Promise<{ data: unknown; error: { code?: string; message: string } | null }> };
    };
  };
}

export interface AuthorizationResult {
  ok: boolean;
  status: number;
  message: string;
}

/**
 * Enforce the three authorization gates for any erpnext-tier command.
 * Returns {ok:true, status:200} when all pass; otherwise {ok:false, status, message}.
 * Does NOT throw — the caller maps the result to an HTTP response.
 */
export async function checkErpnextCommandAuthorization(
  client: AuthorizationClient,
  orgId: string,
  userId: string,
  command: { domain: string; operation: string; record: { erp_doc_kind?: unknown; id: string } },
): Promise<AuthorizationResult> {
  // (a) Domain ownership: the caller's org must have this domain assigned to an employed tier.
  const domainOwned = await client.rpc('domain_externally_owned', { p_org_id: orgId, p_domain: command.domain });
  if (domainOwned.error || domainOwned.data !== true) {
    return { ok: false, status: 403, message: `org ${orgId} does not own domain "${command.domain}"` };
  }

  // (b) Role authorization: only money-write roles may issue erpnext money commands.
  // Read the caller's role from profiles (the authority is profiles.role, per auth_role() SECURITY DEFINER).
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile) {
    return { ok: false, status: 403, message: 'caller role not resolvable' };
  }

  const role = (profile as { role: string }).role;
  if (!role || !MONEY_WRITE_ROLES.includes(role as MoneyWriteRole)) {
    return { ok: false, status: 403, message: `role "${role ?? 'null'}" not authorized for money write` };
  }

  // (c) Domain-kind consistency: the command's domain must match the kind's canonical domain.
  const kind = command.record.erp_doc_kind;
  if (typeof kind !== 'string' || !(kind in KIND_DOMAIN)) {
    return { ok: false, status: 422, message: `missing or unknown erp_doc_kind on record: ${String(kind)}` };
  }
  const expectedDomain = KIND_DOMAIN[kind as keyof typeof KIND_DOMAIN];
  if (command.domain !== expectedDomain) {
    return {
      ok: false,
      status: 422,
      message: `command domain "${command.domain}" does not match erp_doc_kind "${kind}" domain "${expectedDomain}"`,
    };
  }

  return { ok: true, status: 200, message: '' };
}