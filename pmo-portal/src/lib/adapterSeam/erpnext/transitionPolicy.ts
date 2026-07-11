/**
 * Transition semantics (AC-ENA-023, FR-ENA-044, R2, design decision #3). `routeEdit` decides whether a
 * PMO-initiated edit is a safe direct `PUT` (a draft) or must go through cancel+amend (a submitted
 * doc — a direct `PUT` would yield ERPNext's `UpdateAfterSubmitError`, R9 §5). `cancelChain` cancels a
 * set of linked docs in the caller-supplied REVERSE-DEPENDENCY order (the downstream doc first —
 * Purchase Receipt-then-Purchase Order, Payment Entry-then-Purchase Invoice, R9 §5 "Cancel the chain
 * in reverse"); a blocking `LinkExistsError` propagates UNCAUGHT (never swallowed/faked as success),
 * and — since this module has no mirror dependency at all — a blocked cancel structurally cannot
 * mutate the PMO mirror.
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
