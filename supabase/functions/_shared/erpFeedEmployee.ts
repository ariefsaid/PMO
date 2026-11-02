import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { escapeLikePattern } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import type { ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { putIfPresent } from './erpFeedRevenue.ts';
import { surfaceActionRequired } from './erpFeedNotifications.ts';

/**
 * P3b — the Employee mirror columns an inbound update repairs (FR-TSP-090/092.4). Only `employee`-kind
 * changes touch this; every other kind is untouched (`{}`).
 *
 * ⚑ FR-TSP-092.4 (the confirmed-link guard): `profile_id`/`link_state`/`linked_by`/`linked_at` are
 * NEVER part of this patch — those columns are written EXCLUSIVELY by `confirm_erp_employee_link`
 * (migration 0140). This function only mirrors the Employee master's OWN fields. When the row's
 * CURRENT `link_state` is `'confirmed'` and the incoming `work_email` differs from what is stored, an
 * ERP-side email edit on a confirmed link surfaces `employee-link-email-changed` — the confirmed link
 * itself STANDS (never re-pointed here); the mirrored `work_email` column still updates for display
 * accuracy (ERP-side email is Desk-editable and the mirror should reflect current reality — only the
 * PMO-user LINK is the security-sensitive part, and this function structurally cannot touch it).
 */
export async function employeeFieldPatch(
  serviceClient: SupabaseClient,
  orgId: string,
  kind: ErpDocKind,
  pmoRecordId: string,
  canonical: PmoRecord,
): Promise<Record<string, unknown>> {
  if (kind !== 'employee') return {};
  const patch: Record<string, unknown> = {};
  putIfPresent(patch, 'employee_name', (canonical as { employee_name?: unknown }).employee_name);
  putIfPresent(patch, 'erp_user_id', (canonical as { erp_user_id?: unknown }).erp_user_id);
  putIfPresent(patch, 'erp_status', (canonical as { erp_status?: unknown }).erp_status);

  const newWorkEmail = (canonical as { work_email?: string | null | undefined }).work_email;
  if (newWorkEmail !== undefined) {
    const { data, error } = await serviceClient.from('erp_employees').select('work_email, link_state')
      .eq('org_id', orgId).eq('id', pmoRecordId).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    const row = data as { work_email?: string | null; link_state?: string } | null;
    if (row && row.link_state === 'confirmed' && (row.work_email ?? null) !== (newWorkEmail ?? null)) {
      await surfaceActionRequired(serviceClient, orgId, 'employee-link-email-changed', { erpEmployeeId: pmoRecordId });
    }
    patch.work_email = newWorkEmail;
  }
  return patch;
}

/**
 * OQ-TSP-10(C) FR-TSP-092: PROPOSE, never confirm. On adopt, an Employee's `work_email` is probed
 * against `profiles.email` for a UNIQUE, exact, case-insensitive match. Zero or multiple hits leave the
 * row `link_state='unlinked'` + surface action-required (the party-adopt ambiguous-match precedent:
 * SURFACE, never auto-resolve) — only a Human `confirm_erp_employee_link` (0148) authorizes a push.
 * The update is scoped to `link_state='unlinked'` so it never re-proposes over an already-
 * proposed/confirmed/rejected row (FR-TSP-092.4 stays intact even on a re-apply).
 */
export async function proposeEmployeeLink(
  serviceClient: SupabaseClient,
  orgId: string,
  erpEmployeeId: string,
  workEmail: string | null,
): Promise<void> {
  if (!workEmail) {
    await surfaceActionRequired(serviceClient, orgId, 'employee-link-no-email', { erpEmployeeId });
    return;
  }
  // ⚑ `work_email` is DESK-EDITABLE — it is the exact untrusted input 0140's human-confirm step exists
  // to contain, so it must never reach a pattern operator unescaped. `.ilike()` treats `%`/`_` as
  // wildcards: a Desk user setting `work_email` to `finance.lead%` yields a UNIQUE match against
  // `finance.lead@corp.com` and gets auto-proposed with `link_proposed_reason:
  // 'work-email-exact-match'` — a claim that is simply FALSE, shown to the Admin who then confirms it,
  // after which that user's hours post against the attacker's Employee costing rate. Escaped, `.ilike`
  // with no live wildcards IS the case-insensitive exact match this intends. Same helper, same reason,
  // as the P3a anchor-search fix (`client.ts:escapeLikePattern`).
  const { data, error } = await serviceClient.from('profiles').select('id, email')
    .eq('org_id', orgId).ilike('email', escapeLikePattern(workEmail));
  if (error) throw new AppError(error.message, error.code);
  // ⚑ THE DB FILTER IS A PREFILTER ONLY — the match is DECIDED here, by exact case-insensitive
  // equality. `escapeLikePattern` escapes `%`/`_`/`\\`, which is the SQL LIKE metacharacter set, but
  // the value crosses PostgREST, which ALSO substitutes `*` -> `%` in `like`/`ilike` — so an escaped
  // pattern is still not guaranteed to be literal end-to-end, and the fix for `finance.lead%` alone
  // was reopened by `finance.lead*`. Rather than chase one transport's metacharacters, nothing
  // downstream depends on the pattern being literal: a wildcard can only ever WIDEN the candidate set,
  // and this comparison then rejects every row that is not a true exact match. Belt and braces —
  // the escape narrows in the DB, this decides.
  const candidates = (data as Array<{ id: string; email: string | null }> | null) ?? [];
  const target = workEmail.trim().toLowerCase();
  const rows = candidates.filter((r) => (r.email ?? '').trim().toLowerCase() === target);
  if (rows.length !== 1) {
    await surfaceActionRequired(
      serviceClient,
      orgId,
      rows.length === 0 ? 'employee-link-no-match' : 'employee-link-ambiguous',
      { erpEmployeeId, workEmail },
    );
    return; // stays link_state='unlinked', profile_id=null — NEVER auto-resolve
  }
  const { error: updateError } = await serviceClient.from('erp_employees')
    .update({ link_state: 'proposed', profile_id: rows[0].id, link_proposed_reason: 'work-email-exact-match' })
    .eq('org_id', orgId).eq('id', erpEmployeeId).eq('link_state', 'unlinked');
  if (updateError) throw new AppError(updateError.message, updateError.code);
}
