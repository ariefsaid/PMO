/**
 * What the connection must allow before an org can employ `timesheets` under Odoo (FR-OLH-001). The SQL twin is
 * `odoo_labour_employ_blocker` (0861); keep them in step.
 */
import { LABOUR_MODELS, type ModelProbe } from '../discovery.ts';

/** Models PMO writes; the anchor model needs `create` only, and `hr.employee` is read-only (PMO creates no employee, D6). */
export const LABOUR_WRITE_MODELS = ['account.analytic.line', 'account.move', 'account.move.line'] as const;

/** The first gap that stops the employ, named `model`, `model:field` or `model:create|write`; `null` when none. A missing snapshot fails closed. */
export function labourCapabilityGap(snapshot: { labour?: Record<string, ModelProbe | undefined> } | null | undefined): string | null {
  for (const model of Object.keys(LABOUR_MODELS)) {
    const p = snapshot?.labour?.[model];
    if (!p || !p.exists || !p.read) return model;
    if (p.fields_missing.length) return `${model}:${p.fields_missing[0]}`;
    if (!(LABOUR_WRITE_MODELS as readonly string[]).includes(model) && model !== 'ir.model.data') continue;
    if (!p.create) return `${model}:create`;
    if (model !== 'ir.model.data' && !p.write) return `${model}:write`;
  }
  return null;
}
