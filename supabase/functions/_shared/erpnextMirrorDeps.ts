/**
 * erpnextMirrorDeps — SHARED edge-fn wiring for the ERPNext mirror callbacks (task 2.15,
 * parameterizes `clickupMirrorDeps.ts`'s pattern for `(tier='erpnext', domain, tableWriter)`).
 *
 * Unlike ClickUp's single `tasks` domain/table, ERPNext's `procurement` domain spans MULTIPLE mirror
 * tables (purchase_requests/rfqs/procurement_quotations/procurement_items/purchase_orders/
 * procurement_receipts/procurement_invoices/payments) and `companies` spans `companies`+`contacts` —
 * so this module takes the PER-TABLE read/write primitives as an injected `ErpMirrorTableWriter`
 * (filled per mirror table by slices 3-8) rather than hardcoding one table name, and wires them into
 * the SAME callback shape `applyInboundChange`/`runSweep` (`adapterSeam/applyEngine.ts`, task 1.12)
 * expect — `erp_modified` (a raw ERP datetime string) stands in for ClickUp's ms-based
 * `source_updated_at`, converted via `Date.parse` at this boundary only.
 *
 * EDGE-FN WIRING (depends on the real supabase-js client + does DB writes), NOT pure logic — lives in
 * `_shared/`, not the pure `erpnext/**` lib (confinement, FR-ENA-013/NFR-ENA-CONTRACT-001 — this file
 * itself carries no Frappe doctype/field vocabulary, only PMO-shaped `PmoRecord`s). Deno-only
 * (imported by edge fns); relative imports resolve via each fn's deno.json import map.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

export { ERPNEXT_TIER };

export interface ErpMirrorCallbackCtx {
  /** The service-role client (RLS-bypassing) the callbacks write through. */
  serviceClient: SupabaseClient;
  /** The org every write is scoped to (FR-EAS-024 — bound above the adapter, never from the payload). */
  orgId: string;
  /** The PMO domain (`'companies'`|`'procurement'`) — the watermark row key. */
  domain: string;
  /** The per-mirror-table read/write primitives — filled per table by slices 3-8 (e.g. one for
   *  `companies`, one for `purchase_requests`, one for `procurement_items`, ...). */
  tableWriter: ErpMirrorTableWriter;
}

/** The per-table primitives this module needs — kept minimal (no `erp_modified` <-> ms conversion,
 *  done once at THIS boundary) so a slice wiring a new mirror table implements only these four. */
export interface ErpMirrorTableWriter {
  resolvePmoRecordId: (externalRecordId: string) => Promise<string | null>;
  /** Reads the mirror row's raw ERP `modified` string (or `null` if the row has none / doesn't exist). */
  readMirrorErpModified: (pmoRecordId: string) => Promise<string | null>;
  updateMirror: (pmoRecordId: string, canonical: PmoRecord, erpModified: string) => Promise<void>;
  mintMirror: (canonical: PmoRecord, erpModified: string) => Promise<string>;
}

/** The shared mirror-callback bag — SAME shape as `ClickUpMirrorCallbacks`
 *  (`applyEngine.ts`'s `ApplyChangeDeps & WatermarkDeps & {recordExternalRef}`), ms-based source-mod
 *  (this module converts the table writer's raw ERP `modified` string via `Date.parse`). */
export interface ErpMirrorCallbacks {
  resolvePmoRecordId: (externalRecordId: string) => Promise<string | null>;
  readMirrorSourceMod: (pmoRecordId: string) => Promise<number | null>;
  updateMirror: (pmoRecordId: string, canonical: PmoRecord, sourceModMs: number) => Promise<void>;
  mintMirror: (canonical: PmoRecord, sourceModMs: number) => Promise<string>;
  readWatermark: () => Promise<string | null>;
  advanceWatermark: (cursor: string) => Promise<void>;
  recordExternalRef: (mapping: { pmoRecordId: string; externalTier: string; externalRecordId: string; domain: string }) => Promise<void>;
}

/**
 * Build the shared ERPNext mirror-callback bag for one (org, domain, tableWriter). The watermark row
 * is keyed `(org_id, external_tier='erpnext', domain)` — same table `external_sync_watermarks` P1 uses.
 */
export function createErpMirrorCallbacks(ctx: ErpMirrorCallbackCtx): ErpMirrorCallbacks {
  const { serviceClient, orgId, domain, tableWriter } = ctx;
  return {
    resolvePmoRecordId: tableWriter.resolvePmoRecordId,
    readMirrorSourceMod: async (pmoRecordId) => {
      const erpModified = await tableWriter.readMirrorErpModified(pmoRecordId);
      return erpModified ? Date.parse(erpModified) : null;
    },
    updateMirror: async (pmoRecordId, canonical, sourceModMs) => tableWriter.updateMirror(pmoRecordId, canonical, new Date(sourceModMs).toISOString()),
    mintMirror: async (canonical, sourceModMs) => tableWriter.mintMirror(canonical, new Date(sourceModMs).toISOString()),
    readWatermark: async () => {
      const { data } = await serviceClient
        .from('external_sync_watermarks')
        .select('watermark_cursor')
        .eq('org_id', orgId)
        .eq('external_tier', ERPNEXT_TIER)
        .eq('domain', domain)
        .maybeSingle();
      return (data as { watermark_cursor: string | null } | null)?.watermark_cursor ?? null;
    },
    advanceWatermark: async (cursor) => {
      const { error } = await serviceClient.from('external_sync_watermarks').upsert(
        { org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: cursor },
        { onConflict: 'org_id,external_tier,domain' },
      );
      if (error) throw new AppError(error.message, error.code);
    },
    recordExternalRef: (mapping) => recordExternalRefWrite(serviceClient as never, { ...mapping, orgId }),
  };
}
