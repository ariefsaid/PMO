/**
 * clickupMirrorDeps — SHARED edge-fn wiring for the ClickUp mirror callbacks (review fix #3).
 *
 * The four ClickUp edge fns (clickup-webhook, clickup-sweep, clickup-onboard, adapter-dispatch) each
 * duplicated the same callback bag — resolvePmoRecordId / readMirrorSourceMod / updateMirror /
 * mintMirror / readWatermark / advanceWatermark / recordExternalRef — plus the same default-map
 * fallback off a binding config jsonb. This module is the single home for that wiring, parameterized
 * by (serviceClient, orgId, projectId?). It is EDGE-FN WIRING (depends on the real supabase-js client +
 * does DB writes), NOT pure logic — so it lives in `_shared/`, not in the pure `clickup/**` lib.
 *
 * Confinement (FR-CUA-012): CLICKUP_TIER / CLICKUP_TASKS_DOMAIN are imported from the pure
 * `adapter.ts` (the single declaration) and re-exported — the four fns import them from HERE instead
 * of re-declaring `'clickup'` / `'tasks'` literals. `recordExternalRef` routes through the shared
 * `recordExternalRefWrite` (refs.ts) — the webhook's former hand-rolled `external_refs` upsert is gone,
 * matching sweep + onboard.
 *
 * Deno-only (imported by edge fns); relative imports resolve via each fn's deno.json import map.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { CLICKUP_TIER, CLICKUP_TASKS_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/clickup/adapter.ts';
import { insertExternalRef, recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { mapsFromBindingConfig } from '../../../pmo-portal/src/lib/adapterSeam/clickup/bindingConfig.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { AtomicAdoptStrategy } from '../../../pmo-portal/src/lib/adapterSeam/applyEngine.ts';
import type { ExternalRefSeed } from '../../../pmo-portal/src/lib/adapterSeam/clickup/onboarding.ts';

export { CLICKUP_TIER, CLICKUP_TASKS_DOMAIN, mapsFromBindingConfig };

export interface MirrorCallbackCtx {
  /** The service-role client (RLS-bypassing) the callbacks write through. */
  serviceClient: SupabaseClient;
  /** The org every write is scoped to (FR-EAS-024 — bound above the adapter, never from the payload). */
  orgId: string;
  /** The project to adopt-mint into. Required for `mintMirror`; omit when the caller mints itself. */
  projectId?: string;
}

/** The shared mirror-callback bag (ms-based source-mod, matching ApplyChangeDeps in webhookApply.ts). */
export interface ClickUpMirrorCallbacks {
  resolvePmoRecordId: (externalRecordId: string) => Promise<string | null>;
  readMirrorSourceMod: (pmoRecordId: string) => Promise<number | null>;
  /** The mirror's CURRENT PMO status (feeds the inbound status stickiness). */
  readMirrorStatus: (pmoRecordId: string) => Promise<string | null>;
  /** The project an existing mirror belongs to (cross-project parent guard, per-task project resolution). */
  readMirrorProjectId: (pmoRecordId: string) => Promise<string | null>;
  /** ClickUp parent task id → PMO task id via `external_refs` (null = parent not mirrored yet). */
  resolveParentPmoId: (clickUpParentId: string) => Promise<string | null>;
  /** Compare-and-set: the update itself keeps the row only when the STORED source-modification is
   *  older-or-equal to the incoming one, and returns whether it applied (`false` = a newer state was
   *  already stored — apply nothing). */
  updateMirror: (pmoRecordId: string, canonical: PmoRecord, sourceModMs: number) => Promise<boolean>;
  mintMirror: (canonical: PmoRecord, sourceModMs: number) => Promise<string>;
  readWatermark: () => Promise<string | null>;
  advanceWatermark: (cursor: string) => Promise<void>;
  recordExternalRef: (mapping: ExternalRefSeed) => Promise<void>;
  /** Claim-first adopt (the `AtomicAdoptStrategy` the apply engine consumes): every ClickUp apply path
   *  built from this factory adopts through the CLAIM-first order, so a concurrent webhook/sweep adopt
   *  of one task mints exactly one mirror — the losing claim refuses (23505) before any mirror exists. */
  adoptAtomically: AtomicAdoptStrategy;
}

/** The ClickUp-owned mirror columns of a canonical record. Only fields PRESENT on the record are
 *  returned (an omitted field stays omitted, so an update never nulls what the sync did not carry —
 *  e.g. `parent_task_id` when the ClickUp task has no parent); a present `null` is kept as `null`.
 *  OD-INT-9: description + priority are ClickUp-owned native fields — mirrored inbound
 *  (`canonical.priority` is already the PMO enum label). */
const MIRROR_FIELDS = [
  'name', 'status', 'assignee_id', 'start_date', 'end_date', 'completed_at', 'description', 'priority', 'parent_task_id',
] as const;
function presentMirrorFields(canonical: PmoRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of MIRROR_FIELDS) {
    if (canonical[f] !== undefined) out[f] = canonical[f] ?? null;
  }
  return out;
}

/**
 * Build the shared ClickUp mirror-callback bag for one org (+ optional project). Each callback closes
 * over the service client / org / project; all writes are org-scoped. The `mintMirror` callback
 * requires `projectId` in the ctx (adopts mint into that project); callers with a per-row project
 * (the multi-List sweep) override `mintMirror` themselves.
 */
export function createClickUpMirrorCallbacks(ctx: MirrorCallbackCtx): ClickUpMirrorCallbacks {
  const { serviceClient, orgId, projectId } = ctx;
  const resolvePmoRecordId = async (externalRecordId: string): Promise<string | null> => {
    const { data, error } = await serviceClient
      .from('external_refs')
      .select('pmo_record_id')
      .eq('org_id', orgId)
      .eq('domain', CLICKUP_TASKS_DOMAIN)
      .eq('external_record_id', externalRecordId)
      .maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    return (data as { pmo_record_id: string } | null)?.pmo_record_id ?? null;
  };
  const readMirrorColumn = async (pmoRecordId: string, column: 'status' | 'project_id'): Promise<string | null> => {
    const { data, error } = await serviceClient.from('tasks').select(column).eq('org_id', orgId).eq('id', pmoRecordId).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    return (data as Record<string, string | null> | null)?.[column] ?? null;
  };
  // The mint prefers a `project_id` on the canonical record (the multi-List sweep resolves the project
  // per task, SEC-HIGH-2) and falls back to the ctx project (webhook / onboarding adopt paths).
  const insertMirror = async (pmoRecordId: string, canonical: PmoRecord, sourceModMs: number): Promise<void> => {
    const project = (canonical.project_id as string | null | undefined) ?? projectId;
    if (!project) throw new AppError('projectId is required to adopt-mint a mirrored task', 'BAD_REQUEST');
    const { error } = await serviceClient.from('tasks').insert({
      id: pmoRecordId,
      org_id: orgId,
      project_id: project,
      ...presentMirrorFields(canonical),
      source_updated_at: new Date(sourceModMs).toISOString(),
    });
    if (error) throw new AppError(error.message, error.code);
  };
  return {
    resolvePmoRecordId,
    // A ClickUp parent is just another mapped task: same `external_refs` lookup.
    resolveParentPmoId: resolvePmoRecordId,
    readMirrorStatus: (pmoRecordId) => readMirrorColumn(pmoRecordId, 'status'),
    readMirrorProjectId: (pmoRecordId) => readMirrorColumn(pmoRecordId, 'project_id'),
    readMirrorSourceMod: async (pmoRecordId) => {
      const { data, error } = await serviceClient
        .from('tasks')
        .select('source_updated_at')
        .eq('org_id', orgId)
        .eq('id', pmoRecordId)
        .maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      const iso = (data as { source_updated_at: string | null } | null)?.source_updated_at;
      return iso ? Date.parse(iso) : null;
    },
    updateMirror: async (pmoRecordId, canonical, sourceModMs) => {
      const iso = new Date(sourceModMs).toISOString();
      // Compare-and-set: the predicate keeps the row only when its stored source-modification is
      // OLDER-OR-EQUAL to the incoming one (`>=` semantics, matching the engine's guard — re-delivery
      // of the SAME state re-applies idempotently, strictly older loses). The updated rows are
      // selected back, so an empty selection reports the write applied 0 rows (a concurrent applier
      // already stored newer state). The pre-read guard in `applyInboundChange` cannot see this race:
      // two appliers can read the same stored timestamp before either write lands.
      const { data, error } = await serviceClient
        .from('tasks')
        .update({ ...presentMirrorFields(canonical), source_updated_at: iso })
        .eq('org_id', orgId)
        .eq('id', pmoRecordId)
        .or(`source_updated_at.is.null,source_updated_at.lte.${iso}`)
        .select('id');
      if (error) throw new AppError(error.message, error.code);
      return Array.isArray(data) && data.length > 0;
    },
    mintMirror: async (canonical, sourceModMs) => {
      const pmoRecordId = crypto.randomUUID();
      await insertMirror(pmoRecordId, canonical, sourceModMs);
      return pmoRecordId;
    },
    readWatermark: async () => {
      const { data, error } = await serviceClient
        .from('external_sync_watermarks')
        .select('watermark_cursor')
        .eq('org_id', orgId)
        .eq('external_tier', CLICKUP_TIER)
        .eq('domain', CLICKUP_TASKS_DOMAIN)
        .maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      return (data as { watermark_cursor: string | null } | null)?.watermark_cursor ?? null;
    },
    advanceWatermark: async (cursor) => {
      const { error } = await serviceClient.from('external_sync_watermarks').upsert(
        { org_id: orgId, external_tier: CLICKUP_TIER, domain: CLICKUP_TASKS_DOMAIN, watermark_cursor: cursor },
        { onConflict: 'org_id,external_tier,domain' },
      );
      if (error) throw new AppError(error.message, error.code);
    },
    recordExternalRef: (mapping) =>
      recordExternalRefWrite(serviceClient as never, { ...mapping, orgId }),
    // Claim-first adopt: the `external_refs` claim (insert-only — it refuses with 23505 when the task
    // is already mapped) is the adoption lock, taken BEFORE the mirror mint, so the loser of a
    // webhook/sweep adoption race writes no mirror row at all. `mirrorExists` closes the inverse
    // window (the ref was claimed, then the process died before the mint): the next apply re-mints
    // with the SAME pre-claimed id instead of a duplicate under a fresh one. The mint prefers a
    // `project_id` on the canonical record (the multi-List sweep resolves the project per task,
    // SEC-HIGH-2) and falls back to the ctx project (webhook / onboarding adopt paths).
    adoptAtomically: {
      newPmoRecordId: () => crypto.randomUUID(),
      claimExternalRef: (mapping) => insertExternalRef(serviceClient as never, { orgId, ...mapping }),
      mintWithId: (canonical, sourceModMs, pmoRecordId) => insertMirror(pmoRecordId, canonical, sourceModMs),
      mirrorExists: async (pmoRecordId) => {
        const { data, error } = await serviceClient
          .from('tasks')
          .select('id')
          .eq('org_id', orgId)
          .eq('id', pmoRecordId)
          .maybeSingle();
        if (error) throw new AppError(error.message, error.code);
        return data !== null;
      },
    },
  };
}