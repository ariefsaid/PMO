/**
 * What the connection must allow before an org can employ `equipment` under Odoo (FR-OFM-001). The SQL twin is
 * `odoo_equipment_employ_blocker` (0796); keep them in step.
 */
import { ASSET_MODELS, type ModelProbe } from '../discovery.ts';

/** Models PMO writes; the anchor model needs `create` only. */
export const EQUIPMENT_WRITE_MODELS = ['fleet.vehicle', 'maintenance.equipment', 'maintenance.request', 'fleet.vehicle.log.services', 'ir.model.data'] as const;

/** The first gap that stops the employ, named `model`, `model:field` or `model:create|write`; `null` when none. A missing snapshot fails closed. */
export function equipmentCapabilityGap(snapshot: { assets?: Record<string, ModelProbe | undefined> } | null | undefined): string | null {
  for (const model of Object.keys(ASSET_MODELS)) {
    const p = snapshot?.assets?.[model];
    if (!p || !p.exists || !p.read) return model;
    if (p.fields_missing.length) return `${model}:${p.fields_missing[0]}`;
    if (!(EQUIPMENT_WRITE_MODELS as readonly string[]).includes(model)) continue;
    if (!p.create) return `${model}:create`;
    if (model !== 'ir.model.data' && !p.write) return `${model}:write`;
  }
  return null;
}
