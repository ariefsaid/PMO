/**
 * The models a purchase needs (FR-OPP-001), read from the capability snapshot discovery stores on the binding. Six are probed as
 * "later" models (present and readable by the key); the journal is an O1 directory model. The SQL twin is
 * `odoo_procurement_employ_blocker` (migration 0505): keep the two lists in step.
 */
export const PROCUREMENT_MODELS = ['purchase.order', 'purchase.order.line', 'stock.picking', 'stock.move', 'account.move', 'account.payment', 'account.journal'] as const;

interface SnapshotView {
  later?: Record<string, boolean>;
  models?: Record<string, { exists?: boolean; read?: boolean } | undefined>;
}

/** The first required model the snapshot does not show present and readable, or null. No snapshot fails closed. */
export function procurementCapabilityGap(snapshot: SnapshotView | null | undefined): string | null {
  for (const model of PROCUREMENT_MODELS) {
    const ok = model === 'account.journal'
      ? snapshot?.models?.[model]?.exists === true && snapshot.models[model]?.read === true
      : snapshot?.later?.[model] === true;
    if (!ok) return model;
  }
  return null;
}
