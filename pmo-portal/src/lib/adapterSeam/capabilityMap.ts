import { CAPTURED_PURCHASE_CAPABILITIES as erpCapture, STOCK_MATCHING_CAPABILITIES as erpStock, ACCOUNTING_SETUP_CAPABILITIES as erpAccounting } from './erpnext/workflowDeclarations.ts';
import { CAPTURED_PURCHASE_CAPABILITIES as odooCapture, STOCK_MATCHING_CAPABILITIES as odooStock, ACCOUNTING_SETUP_CAPABILITIES as odooAccounting } from './odoo/workflowDeclarations.ts';
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

/** Tier declarations used by stock matching in setup. Whether a tier posts stock is decided by the domain-ownership guard and the adapter registry, not here. */
const STOCK_POSTING: Readonly<Record<string, { stockMatching: boolean }>> = {
  erpnext: erpStock,
  odoo: odooStock,
};
export function stockMatchingCapabilities(tier?: string): { stockMatching: boolean } {
  return STOCK_POSTING[tier ?? ''] ?? { stockMatching: false };
}

/** Accounting setup is a declared capability rather than a tier-name decision in a screen. */
const ACCOUNTING_SETUP: Readonly<Record<string, { accounting: boolean }>> = {
  erpnext: erpAccounting,
  odoo: odooAccounting,
};
export function accountingSetupCapabilities(tier?: string): { accounting: boolean } {
  return ACCOUNTING_SETUP[tier ?? ''] ?? { accounting: false };
}
