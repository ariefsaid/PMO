/**
 * Transition semantics (AC-ENA-023, FR-ENA-044, R2, design decision #3). `routeEdit` decides whether a
 * PMO-initiated edit is a safe direct `PUT` (a draft) or must go through cancel+amend (a submitted
 * doc — a direct `PUT` would yield ERPNext's `UpdateAfterSubmitError`, R9 §5). `cancelChain` cancels a
 * set of linked docs in the caller-supplied REVERSE-DEPENDENCY order (the downstream doc first —
 * Purchase Receipt-then-Purchase Order, Payment Entry-then-Purchase Invoice, R9 §5 "Cancel the chain
 * in reverse"); a blocking `LinkExistsError` propagates UNCAUGHT (never swallowed/faked as success),
 * and — since this module has no mirror dependency at all — a blocked cancel structurally cannot
 * mutate the PMO mirror.
 *
 * AC-SAR-022 (AR delta): SI cancel is NOT hard-blocked by an active PE-receive (OQ-SAR-1 #8).
 * ERPNext cancels a referenced SI with 200 and AUTO-UNLINKS the PE-receive's `references`.
 * `reconcileSiCancelAutoUnlink` is the read-model reconcile helper: given a successful SI-cancel
 * (ERP 200) + the knowledge that a PE-receive referenced it, returns the mirror patch
 * `{sales_invoice_id: null}` for the PE-receive (it becomes on-account) + the SI tombstone.
 * `cancelChain` itself is UNCHANGED — it propagates rejections uncaught; the SI-cancel path simply
 * does not throw (ERP returns 200).
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

export interface ChainCancelStep {
  doctype: string;
  name: string;
}

export interface CancelChainDeps {
  /** `PUT {docstatus:2}` for one doc — throws (e.g. `LinkExistsError`) on an ERP-side block. */
  cancelDoc: (doctype: string, name: string) => Promise<void>;
}

/**
 * Cancels a chain of linked ERP docs in the given (already reverse-dependency-ordered) sequence. Any
 * step's rejection propagates UNCAUGHT and stops the chain — the caller must never catch-and-continue
 * (that would leave an inconsistent partial cancel or fake a success the ERP side never confirmed).
 */
export async function cancelChain(steps: readonly ChainCancelStep[], deps: CancelChainDeps): Promise<void> {
  for (const step of steps) {
    await deps.cancelDoc(step.doctype, step.name);
  }
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
