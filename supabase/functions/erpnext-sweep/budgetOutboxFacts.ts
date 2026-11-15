// The budget outbox facts the money-write gate and the budget backstop share (THEME-BACK-40, #1643): the named
// held state, what an outbox identity names (version, fiscal years, account), the keyed outbox lookup and the
// archive-cancellation lifecycle reads. Moved verbatim from index.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ERPNEXT_TIER } from '../_shared/erpnextFeedDeps.ts';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { findOutboxRowByKey } from './outboxRows.ts';
import type { BudgetArchiveCancelIntent } from './budgetArchiveBackstop.ts';
import { budgetVersionIdOf, decodeFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';
import { budgetAccountArchiveKey, budgetAccountIdentity, budgetLegacyArchiveKey, budgetLegacyIdentity, budgetRangeIdentity, parseBudgetIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { ERPNEXT_BUDGET_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';

/** FR-BFY-075 — the named state a sweep budget recovery takes when the CURRENT gate would refuse the
 *  frozen year/body. Surfaced per candidate; the row itself is left untouched (no POST, no state
 *  change), so the recovery resumes by itself once the operator resolves the cause. */
export const BUDGET_SWEEP_GATE_HELD = 'budget-sweep-gate-held';

/** The bare `budget_version_id` of an outbox identity — the mirror FK / version-read fact (FR-BFY-038).
 *  A pre-fan-out bare id is returned unchanged. */
export function bareBudgetVersionId(pmoRecordId: string): string {
  return pmoRecordId.includes(':') ? budgetVersionIdOf(pmoRecordId) : pmoRecordId;
}

/** The fiscal year a year-qualified outbox identity NAMES, or `null` for a pre-fan-out bare id. It is
 *  read out of the identity, never derived: the identity is what the dispatch itself resolved. */
export function fiscalYearOfIdentity(pmoRecordId: string): string | null {
  const sep = pmoRecordId.indexOf(':');
  if (sep < 0) return null;
  try {
    return parseBudgetIdentity(pmoRecordId).fiscalYear ?? (decodeFiscalYear(pmoRecordId.slice(sep + 1)) || null);
  } catch {
    return null;
  }
}

export function toFiscalYearOfIdentity(pmoRecordId: string): string | null {
  try {
    const identity = parseBudgetIdentity(pmoRecordId);
    return identity.kind === 'range' ? identity.toFiscalYear : null;
  } catch { return null; }
}

export function accountOfIdentity(pmoRecordId: string): string | null {
  try { return parseBudgetIdentity(pmoRecordId).erpAccount; } catch { return null; }
}

/** ⚑ BLOCKER 3 (FU-2) — the orphan dedup key. The budget mirror grain is (budget_version_id ×
 *  fiscal_year), so an outbox orphan is a duplicate of a mirror row ONLY when BOTH match. A NUL (\u0000)
 *  delimiter — which neither a UUID nor an ERPNext Fiscal Year name can contain — keeps the
 *  composite unambiguous. */
export function budgetDedupKey(versionId: string, fiscalYear: string | null | undefined, account?: string | null, toFiscalYear?: string | null): string {
  return `${versionId}\u0000${fiscalYear ?? ''}\u0000${toFiscalYear ?? ''}\u0000${account ?? ''}`;
}

/** Read the EXISTING `external_command_outbox` row for this budget version's deterministic key, if
 *  any (FR-BUD-141: the SAME key the foreground path derives — `budgetPushKey` — so this finds the
 *  SAME candidate rather than minting a second one; the two originators collide safely, ADR-0058). */
export function findBudgetOutboxRow(
  serviceClient: SupabaseClient,
  orgId: string,
  versionId: string,
  idempotencyKey: string,
): Promise<OutboxRow | null> {
  return findOutboxRowByKey(serviceClient, orgId, ERPNEXT_BUDGET_DOMAIN, versionId, idempotencyKey);
}

/** FR-BUD-122 — the durable, explicit archive-cancellation queue. #1462: legacy-aware. */
export async function readBudgetArchiveLifecycleLive(
  serviceClient: SupabaseClient,
  job: BudgetArchiveCancelIntent,
): Promise<{ status: string; activatedAt: string | null; activeSuccessorUsesTarget: boolean; cancellationState: string | null } | null> {
  const { data: version, error: versionError } = await serviceClient.from('budget_versions')
    .select('id,org_id,project_id,status,activated_at')
    .eq('id', job.budget_version_id).eq('org_id', job.org_id).maybeSingle();
  if (versionError) throw new AppError(versionError.message, versionError.code);
  if (!version || version.project_id !== job.project_id) return null;
  if (!job.request_id) return null;
  const { data: request, error: requestError } = await serviceClient.from('budget_archive_requests')
    .select('id,org_id,project_id,budget_version_id,requested_by,cancel_erp')
    .eq('id', job.request_id).eq('org_id', job.org_id).maybeSingle();
  if (requestError) throw new AppError(requestError.message, requestError.code);
  if (!request || request.project_id !== job.project_id || request.budget_version_id !== job.budget_version_id ||
      request.requested_by !== job.actor_user_id || request.cancel_erp !== true) return null;
  const { data: active, error: activeError } = await serviceClient.from('budget_versions')
    .select('id').eq('org_id', job.org_id).eq('project_id', job.project_id)
    .eq('status', 'Active').neq('id', job.budget_version_id).limit(1);
  if (activeError) throw new AppError(activeError.message, activeError.code);
  const activeIds = (active ?? []).map((row) => row.id);
  let activeSuccessorUsesTarget = false;
  const legacy = job.source_kind === 'legacy';
  const identity = legacy
    ? budgetLegacyIdentity(job.budget_version_id, job.fiscal_year)
    : job.to_fiscal_year
      ? budgetRangeIdentity(job.budget_version_id, job.fiscal_year, job.to_fiscal_year, job.erp_account!)
      : budgetAccountIdentity(job.budget_version_id, job.fiscal_year, job.erp_account!);
  const archiveKey = legacy
    ? budgetLegacyArchiveKey(identity, job.activated_at_witness)
    : budgetAccountArchiveKey(identity, job.activated_at_witness);
  const outbox = await findBudgetOutboxRow(serviceClient, job.org_id, identity, archiveKey);
  const cancellationState: string | null = outbox?.state ?? null;
  if (activeIds.length > 0) {
    // ⚑ #1462 — a successor can hold the SAME live ERP document through EITHER mirror kind and EITHER
    // grain: a v16 account row for the same account, or a legacy year row that names the same document.
    // A cancellation must be superseded when the active version still needs the document, whichever
    // table proves it — checking one table would cancel a control the successor version relies on.
    const { data: successorTargets, error: successorError } = await serviceClient.from('budget_version_account_erp_mirror')
      .select('id').eq('org_id', job.org_id).in('budget_version_id', activeIds)
      .eq('erp_budget_name', job.erp_budget_name)
      .is('erp_cancelled_at', null).neq('erp_docstatus', 2).limit(1);
    if (successorError) throw new AppError(successorError.message, successorError.code);
    if ((successorTargets ?? []).length > 0) {
      activeSuccessorUsesTarget = true;
    } else {
      const { data: legacyTargets, error: legacyError } = await serviceClient.from('budget_version_erp_mirror')
        .select('id').eq('org_id', job.org_id).in('budget_version_id', activeIds)
        .eq('erp_budget_name', job.erp_budget_name)
        .is('erp_cancelled_at', null).neq('erp_docstatus', 2).limit(1);
      if (legacyError) throw new AppError(legacyError.message, legacyError.code);
      activeSuccessorUsesTarget = (legacyTargets ?? []).length > 0;
    }
  }
  return {
    status: version.status,
    activatedAt: version.activated_at,
    activeSuccessorUsesTarget,
    cancellationState,
  };
}

export async function budgetArchiveTargetStillLiveAndOwnedLive(
  serviceClient: SupabaseClient,
  job: BudgetArchiveCancelIntent,
): Promise<boolean> {
  const sourceKind = job.source_kind ?? 'account';
  const { data: binding, error: bindingError } = await serviceClient.from('external_org_bindings')
    .select('version_major,activated_at').eq('org_id', job.org_id).eq('external_tier', ERPNEXT_TIER).maybeSingle();
  if (bindingError) throw new AppError(bindingError.message, bindingError.code);
  // A legacy document remains visible after a re-bind but automatic cancellation is enabled only on a
  // v15 binding until the v16 upgraded shape has actual test-bed evidence.
  const supported = sourceKind === 'legacy'
    ? binding?.version_major === 15
    : binding?.version_major === 16;
  if (!supported || !binding?.activated_at) return false;

  let identity: string;
  if (sourceKind === 'legacy') {
    const { data: mirror, error: legacyMirrorError } = await serviceClient.from('budget_version_erp_mirror')
      .select('id,org_id,budget_version_id,fiscal_year,push_state,erp_budget_name,erp_docstatus,erp_cancelled_at,activated_at_witness,pushed_project_start_date,pushed_project_end_date')
      .eq('id', job.source_mirror_id).eq('org_id', job.org_id)
      .eq('budget_version_id', job.budget_version_id).eq('fiscal_year', job.fiscal_year).maybeSingle();
    if (legacyMirrorError) throw new AppError(legacyMirrorError.message, legacyMirrorError.code);
    const legacyMirror = mirror as {
      id?: string; erp_budget_name?: string | null; erp_docstatus?: number | null;
      erp_cancelled_at?: string | null; activated_at_witness?: string | null;
      pushed_project_start_date?: string | null; pushed_project_end_date?: string | null;
    } | null;
    if (!legacyMirror || legacyMirror.erp_budget_name !== job.erp_budget_name ||
        legacyMirror.activated_at_witness !== job.activated_at_witness ||
        legacyMirror.pushed_project_start_date !== job.pushed_project_start_date ||
        legacyMirror.pushed_project_end_date !== job.pushed_project_end_date) return false;
    const isStillLive = legacyMirror.erp_cancelled_at === null && legacyMirror.erp_docstatus !== 2;
    const alreadyCancelled = legacyMirror.erp_cancelled_at != null && legacyMirror.erp_docstatus === 2;
    if (!isStillLive && !alreadyCancelled) return false;
    try { identity = budgetLegacyIdentity(job.budget_version_id, job.fiscal_year); }
    catch { return false; }
    const { data: legacyRef, error: legacyRefError } = await serviceClient.from('external_refs')
      .select('external_record_id').eq('org_id', job.org_id).eq('domain', ERPNEXT_BUDGET_DOMAIN)
      .eq('external_tier', ERPNEXT_TIER).eq('pmo_record_id', identity)
      .eq('external_record_id', job.erp_budget_name).maybeSingle();
    if (legacyRefError) throw new AppError(legacyRefError.message, legacyRefError.code);
    return !!legacyRef;
  }

  const mirrorQuery = serviceClient.from('budget_version_account_erp_mirror')
    .select('id,org_id,budget_version_id,fiscal_year,to_fiscal_year,erp_account,budget_intent,push_state,erp_budget_name,erp_docstatus,erp_cancelled_at,erp_modified,activated_at_witness,pushed_project_start_date,pushed_project_end_date')
    .eq('id', job.source_mirror_id).eq('org_id', job.org_id)
    .eq('budget_version_id', job.budget_version_id).eq('fiscal_year', job.fiscal_year)
    .eq('erp_account', job.erp_account);
  const scopedMirror = job.to_fiscal_year == null
    ? mirrorQuery.is('to_fiscal_year', null)
    : mirrorQuery.eq('to_fiscal_year', job.to_fiscal_year);
  const { data: mirror, error: mirrorError } = await scopedMirror.maybeSingle();
  if (mirrorError) throw new AppError(mirrorError.message, mirrorError.code);
  const accountRow = mirror as Record<string, unknown> | null;
  if (!accountRow || (accountRow.to_fiscal_year ?? null) !== (job.to_fiscal_year ?? null) ||
      accountRow.erp_budget_name !== job.erp_budget_name ||
      (job.to_fiscal_year != null && accountRow.erp_modified !== job.erp_modified) ||
      accountRow.activated_at_witness !== job.activated_at_witness || accountRow.budget_intent !== 'remove' ||
      accountRow.pushed_project_start_date !== job.pushed_project_start_date ||
      accountRow.pushed_project_end_date !== job.pushed_project_end_date) return false;
  const isStillLive = accountRow.erp_cancelled_at === null && accountRow.erp_docstatus !== 2 &&
    ['pending', 'failed', 'held', 'pushed'].includes(String(accountRow.push_state));
  const alreadyCancelled = accountRow.erp_cancelled_at !== null && accountRow.erp_docstatus === 2;
  if (!isStillLive && !alreadyCancelled) return false;

  try { identity = job.to_fiscal_year
    ? budgetRangeIdentity(job.budget_version_id, job.fiscal_year, job.to_fiscal_year, job.erp_account!)
    : budgetAccountIdentity(job.budget_version_id, job.fiscal_year, job.erp_account!); }
  catch { return false; }
  const { data: externalRef, error: refError } = await serviceClient.from('external_refs')
    .select('external_record_id').eq('org_id', job.org_id).eq('domain', ERPNEXT_BUDGET_DOMAIN)
    .eq('external_tier', ERPNEXT_TIER).eq('pmo_record_id', identity)
    .eq('external_record_id', job.erp_budget_name).maybeSingle();
  if (refError) throw new AppError(refError.message, refError.code);
  return !!externalRef;
}
