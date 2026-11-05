// Change-driven native statement refresh (owner-approved 2026-11-04): every 15 minutes a cheap source check
// records a hint; a statement refresh runs only for a first publication, an unfinished nightly date or an
// unacknowledged "Refresh now"/confirmed-post intent. A checker error falls back to today's hourly refresh.
// The DB (0681/0682/0683) owns every decision and fence; this module only drives the RPCs.
import {
  checkStatementChanges, type StatementChangeResult, type StatementHintObservation,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/statementChangeCheck.ts';
import type { ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';

export interface ChangeDrivenRun {
  kind: 'run';
  reason: string;
  scopeEpoch: string;
  dirtyCut: string;
  intentCut: string;
  nightlyCut: string | null;
}
/** `legacy` = use today's hourly cadence (feature off, state disabled, or any error here). */
export type ChangeDrivenDecision = { kind: 'legacy' } | { kind: 'skip' } | ChangeDrivenRun;

interface Rpc { data: unknown; error: { code?: string } | null }
export interface ChangeDrivenService {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Rpc>;
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<Rpc> } };
  };
}
export interface ChangeDrivenOrg {
  orgId: string;
  bindingId?: string | null;
  activatedAt?: string | null;
  company: string;
  statementLockHolder?: string;
}

const PROFILE = '16.33.0/16.31.0';
// A checker failure is not evidence of "unchanged": run today's full refresh for this tick instead.
const CHECKER_FAILED = new Set(['context_mismatch', 'invalid_response', 'request_failed', 'cancelled', 'ambiguous_hint']);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const r = value as Record<string, unknown>;
    return `{${Object.keys(r).sort().map((k) => `${JSON.stringify(k)}:${stable(r[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function planChangeDrivenStatements(
  service: ChangeDrivenService,
  org: ChangeDrivenOrg,
  getClient: () => Promise<ErpClientDeps>,
  nowMs: number,
): Promise<ChangeDrivenDecision> {
  const holder = org.statementLockHolder;
  if (!holder || !org.bindingId || !org.activatedAt) return { kind: 'legacy' };
  const scope = { p_org_id: org.orgId, p_holder: holder, p_binding_id: org.bindingId, p_activated_at: org.activatedAt };
  try {
    const sync = await service.rpc('sync_erp_statement_change_scope', scope);
    const synced = sync.data as { enabled?: boolean; scope_epoch?: string } | null;
    if (sync.error || !synced || synced.enabled !== true || !synced.scope_epoch) return { kind: 'legacy' };
    const epoch = synced.scope_epoch;

    const row = await service.from('erp_statement_change_state')
      .select('next_check_at,diagnostic_result,binding_context').eq('org_id', org.orgId).maybeSingle();
    const state = row.data as { next_check_at?: string; diagnostic_result?: { observation?: StatementHintObservation } | null; binding_context?: unknown } | null;
    if (row.error || !state) return { kind: 'legacy' };

    if (Date.parse(state.next_check_at ?? '') <= nowMs) {
      const context = {
        bindingId: org.bindingId, activatedAt: org.activatedAt, company: org.company, profile: PROFILE,
        fingerprint: await sha256Hex(stable(state.binding_context)),
      };
      const prior = state.diagnostic_result?.observation ?? null;
      const previous = prior && prior.context?.fingerprint === context.fingerprint ? prior : null;
      const result: StatementChangeResult = await checkStatementChanges(await getClient(), { context, previous });
      const observed = await service.rpc('observe_erp_statement_change', { ...scope, p_scope_epoch: epoch, p_result: result });
      if (observed.error) return { kind: 'legacy' };
      if (result.status === 'unknown' && CHECKER_FAILED.has(result.reason)) return { kind: 'legacy' };
    }

    // Materialize the organization-local 02:00 obligations that have come due (idempotent, lease-fenced).
    const due = await service.rpc('record_erp_statement_nightly_due', scope);
    if (due.error) return { kind: 'legacy' };

    const plan = await service.rpc('plan_erp_statement_pass', { ...scope, p_scope_epoch: epoch });
    const planned = plan.data as { mode?: string; reason?: string; dirty_cut?: string; intent_cut?: string; nightly_cut?: string | null } | null;
    if (plan.error || !planned) return { kind: 'legacy' };
    if (planned.mode === 'legacy') return { kind: 'legacy' };
    if (planned.mode !== 'run') return { kind: 'skip' };
    return {
      kind: 'run', reason: planned.reason ?? 'unknown', scopeEpoch: epoch,
      dirtyCut: String(planned.dirty_cut), intentCut: String(planned.intent_cut), nightlyCut: planned.nightly_cut ?? null,
    };
  } catch {
    return { kind: 'legacy' };
  }
}

/** Acknowledge a published run (only through the captured cuts) or back off a failed one. */
export async function settleChangeDrivenRun(
  service: ChangeDrivenService,
  org: ChangeDrivenOrg,
  run: ChangeDrivenRun,
  result: { status?: 'published' | 'progress' | 'failed'; snapshotId?: string },
): Promise<void> {
  const scope = { p_org_id: org.orgId, p_holder: org.statementLockHolder, p_binding_id: org.bindingId, p_activated_at: org.activatedAt };
  if (result.status === 'published' && result.snapshotId) {
    const done = await service.rpc('complete_erp_statement_pass', {
      ...scope, p_scope_epoch: run.scopeEpoch, p_dirty_cut: run.dirtyCut, p_intent_cut: run.intentCut,
      p_nightly_cut: run.nightlyCut, p_snapshot_id: result.snapshotId,
    });
    if (done.error) throw new Error(`statement-pass complete failed: ${done.error.code ?? 'unknown'}`);
  } else if (result.status === 'failed') {
    const failed = await service.rpc('fail_erp_statement_pass', { ...scope, p_scope_epoch: run.scopeEpoch });
    if (failed.error) throw new Error(`statement-pass backoff failed: ${failed.error.code ?? 'unknown'}`);
  }
}
