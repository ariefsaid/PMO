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
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { mapsFromBindingConfig } from '../../../pmo-portal/src/lib/adapterSeam/clickup/bindingConfig.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
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
  updateMirror: (pmoRecordId: string, canonical: PmoRecord, sourceModMs: number) => Promise<void>;
  mintMirror: (canonical: PmoRecord, sourceModMs: number) => Promise<string>;
  readWatermark: () => Promise<string | null>;
  advanceWatermark: (cursor: string) => Promise<void>;
  recordExternalRef: (mapping: ExternalRefSeed) => Promise<void>;
}

/**
 * Build the shared ClickUp mirror-callback bag for one org (+ optional project). Each callback closes
 * over the service client / org / project; all writes are org-scoped. The `mintMirror` callback
 * requires `projectId` in the ctx (adopts mint into that project); callers with a per-row project
 * (the multi-List sweep) override `mintMirror` themselves.
 */
export function createClickUpMirrorCallbacks(ctx: MirrorCallbackCtx): ClickUpMirrorCallbacks {
  const { serviceClient, orgId, projectId } = ctx;
  return {
    resolvePmoRecordId: async (externalRecordId) => {
      const { data } = await serviceClient
        .from('external_refs')
        .select('pmo_record_id')
        .eq('org_id', orgId)
        .eq('domain', CLICKUP_TASKS_DOMAIN)
        .eq('external_record_id', externalRecordId)
        .maybeSingle();
      return (data as { pmo_record_id: string } | null)?.pmo_record_id ?? null;
    },
    readMirrorSourceMod: async (pmoRecordId) => {
      const { data } = await serviceClient
        .from('tasks')
        .select('source_updated_at')
        .eq('org_id', orgId)
        .eq('id', pmoRecordId)
        .maybeSingle();
      const iso = (data as { source_updated_at: string | null } | null)?.source_updated_at;
      return iso ? Date.parse(iso) : null;
    },
    updateMirror: async (pmoRecordId, canonical, sourceModMs) => {
      const { error } = await serviceClient
        .from('tasks')
        .update({
          name: canonical.name,
          status: canonical.status,
          assignee_id: canonical.assignee_id ?? null,
          start_date: canonical.start_date ?? null,
          end_date: canonical.end_date ?? null,
          completed_at: (canonical.completed_at as string | null | undefined) ?? null,
          parent_task_id: canonical.parent_task_id ?? null,
          source_updated_at: new Date(sourceModMs).toISOString(),
        })
        .eq('org_id', orgId)
        .eq('id', pmoRecordId);
      if (error) throw new AppError(error.message, error.code);
    },
    mintMirror: async (canonical, sourceModMs) => {
      if (!projectId) throw new AppError('projectId is required to adopt-mint a mirrored task', 'BAD_REQUEST');
      const pmoRecordId = crypto.randomUUID();
      const { error } = await serviceClient.from('tasks').insert({
        id: pmoRecordId,
        org_id: orgId,
        project_id: projectId,
        name: canonical.name,
        status: canonical.status,
        assignee_id: canonical.assignee_id ?? null,
        start_date: canonical.start_date ?? null,
        end_date: canonical.end_date ?? null,
        completed_at: (canonical.completed_at as string | null | undefined) ?? null,
        parent_task_id: canonical.parent_task_id ?? null,
        source_updated_at: new Date(sourceModMs).toISOString(),
      });
      if (error) throw new AppError(error.message, error.code);
      return pmoRecordId;
    },
    readWatermark: async () => {
      const { data } = await serviceClient
        .from('external_sync_watermarks')
        .select('watermark_cursor')
        .eq('org_id', orgId)
        .eq('external_tier', CLICKUP_TIER)
        .eq('domain', CLICKUP_TASKS_DOMAIN)
        .maybeSingle();
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
  };
}