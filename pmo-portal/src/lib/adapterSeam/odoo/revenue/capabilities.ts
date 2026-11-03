import type { SnapshotView } from '../purchase/capabilities.ts';

/**
 * The models an invoice and a receipt need (FR-OCI-001), read from the capability snapshot discovery stores on the binding. Three are
 * probed as "later" models (present and readable by the key); the journal, tax and account directories are O1 models. The SQL twin is
 * `odoo_revenue_employ_blocker` (migration 0510): keep the two lists in step.
 */
export const REVENUE_MODELS = ['account.move', 'account.move.line', 'account.payment', 'account.journal', 'account.tax', 'account.account'] as const;
const DIRECTORY_MODELS: ReadonlySet<string> = new Set(['account.journal', 'account.tax', 'account.account']);

/** The first required model the snapshot does not show present and readable, or null. No snapshot fails closed. */
export function revenueCapabilityGap(snapshot: SnapshotView | null | undefined): string | null {
  for (const model of REVENUE_MODELS) {
    const ok = DIRECTORY_MODELS.has(model) ? snapshot?.models?.[model]?.exists === true && snapshot.models[model]?.read === true : snapshot?.later?.[model] === true;
    if (!ok) return model;
  }
  return null;
}
