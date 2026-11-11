/**
 * Transition semantics (AC-ENA-023, FR-ENA-044, R2, design decision #3). `routeEdit` decides whether a
 * PMO-initiated edit is a safe direct `PUT` (a draft) or must go through cancel+amend (a submitted
 * doc — a direct `PUT` would yield ERPNext's `UpdateAfterSubmitError`, R9 §5). A multi-doc cancel is
 * the CALLER's chain concern (reverse-dependency order, downstream doc first); the adapter ships the
 * single-doc cancel primitive only.
 *
 * AC-SAR-022 (AR delta): SI cancel is NOT hard-blocked by an active PE-receive (OQ-SAR-1 #8).
 * ERPNext cancels a referenced SI with 200 and AUTO-UNLINKS the PE-receive's `references`.
 * `reconcileSiCancelAutoUnlink` is the read-model reconcile helper: given a successful SI-cancel
 * (ERP 200) + the knowledge that a PE-receive referenced it, returns the mirror patch
 * `{sales_invoice_id: null}` for the PE-receive (it becomes on-account) + the SI tombstone.
 */
import { AdapterError } from '../contract.ts';

export type EditRoute = 'update' | 'amend';

/** `docstatus 0` (draft) -> a direct field `PUT` is safe. `docstatus 1` (submitted) -> `amend`
 *  (cancel + create-with-`amended_from`) — a direct `PUT` on a submitted doc raises
 *  `UpdateAfterSubmitError` (R9 §5, probed live). `docstatus 2` (cancelled) can never be edited. */
export function routeEdit(docstatus: number): EditRoute {
  if (docstatus === 0) return 'update';
  if (docstatus === 1) return 'amend';
  throw new AdapterError('commit-rejected', `cannot edit an already-cancelled document (docstatus ${docstatus})`);
}

/**
 * AC-SAR-022: SI cancel auto-unlink reconcile (AR delta from procurement).
 * ERPNext returns 200 on SI cancel even when a PE-receive references it — it auto-unlinks the
 * PE-receive's `references` child table. The read-model must reconcile:
 * - PE-receive becomes on-account: `sales_invoice_id` → null
 * - SI is tombstoned (handled by lineage.applyCancel)
 * This is a PURE helper — no DB writes, no ERP calls. The dispatch read-model writer applies it.
 */
export interface SiCancelAutoUnlinkResult {
  peReceivePatch: { sales_invoice_id: null } | null;
  siTombstone: { erp_cancelled_at: string; erp_docstatus: 2; erp_modified: string };
}

export function reconcileSiCancelAutoUnlink(
  peReceivePmoId: string | null,
  erpModified: string,
): SiCancelAutoUnlinkResult {
  return {
    peReceivePatch: peReceivePmoId ? { sales_invoice_id: null } : null,
    siTombstone: { erp_cancelled_at: new Date().toISOString(), erp_docstatus: 2, erp_modified: erpModified },
  };
}
