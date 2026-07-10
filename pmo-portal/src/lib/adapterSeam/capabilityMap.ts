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
