import { CAPTURED_PURCHASE_CAPABILITIES as erpCapture } from './erpnext/workflowDeclarations.ts';
import { CAPTURED_PURCHASE_CAPABILITIES as odooCapture } from './odoo/workflowDeclarations.ts';
/**
 * Capability-map bounding (FR-EAS-004, AC-EAS-013). An org may assign to a tier only domains within
 * that tier's STATIC capability map, so the effective flip set is bounded by the employed tier's real
 * capabilities. Pure helpers used by the provisioning path + the routing layer.
 */
import { CapabilityMap, PmoDomain } from './contract.ts';

/** True iff the tier's static capability map can natively own `domain` (FR-EAS-004, AC-EAS-013). */
export function canAssignDomainToTier(capabilityMap: CapabilityMap, domain: PmoDomain): boolean {
  return capabilityMap.has(domain);
}

/** Thrown when an assignment targets a domain the tier cannot own (AC-EAS-013 rejection). */
export class CapabilityMapError extends Error {
  constructor(domain: PmoDomain, tier: string) {
    super(`domain "${domain}" is not in tier "${tier}"'s capability map`);
    this.name = 'CapabilityMapError';
  }
}

/** Reject (throw) an assignment outside the tier's capability map — the provisioning guard. */
export function assertDomainInCapabilityMap(
  capabilityMap: CapabilityMap,
  tier: string,
  domain: PmoDomain,
): void {
  if (!canAssignDomainToTier(capabilityMap, domain)) throw new CapabilityMapError(domain, tier);
}

/** Tier declarations used by shared captured-purchase routing. */
const CAPTURED_PURCHASES: Readonly<Record<string, { payCapturedInvoice: boolean; applyStepPolicy: boolean }>> = {
  erpnext: erpCapture,
  odoo: odooCapture,
};
export function capturedPurchaseCapabilities(tier?: string): { payCapturedInvoice: boolean; applyStepPolicy: boolean } {
  return CAPTURED_PURCHASES[tier ?? ''] ?? { payCapturedInvoice: false, applyStepPolicy: true };
}

/** Static capability maps by tier declaring which domains each external tier natively supports (FR-EAS-004, AC-OSP-001). */
export const TIER_CAPABILITY_MAPS: Record<string, CapabilityMap> = {
  erpnext: new Set(['companies', 'procurement', 'revenue', 'timesheets', 'budget', 'expenses']),
  odoo: new Set(['companies', 'procurement', 'revenue', 'equipment', 'stock']),
};

export function tierHasCapability(tier: string, domain: PmoDomain): boolean {
  const map = TIER_CAPABILITY_MAPS[tier];
  return map ? canAssignDomainToTier(map, domain) : false;
}
