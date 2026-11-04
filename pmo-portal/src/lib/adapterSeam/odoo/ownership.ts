import { ODOO_TIER } from './connectAdapter.ts';
import { domainTier } from '../ownershipCache.ts';

/** Keep the tier-specific revenue ownership decision inside the Odoo adapter seam. */
export const odooOwnsRevenueTier = (tier: unknown): boolean => tier === ODOO_TIER;

/** Validate the selected adapter for an externally owned item catalogue. */
export const odooOwnsExternalItemCatalog = (tier: unknown): boolean => tier === ODOO_TIER;
export const erpnextOwnsExternalItemCatalog = (tier: unknown): boolean => tier === 'erpnext';

/** True once the ownership cache says Odoo runs procurement. The tier name stays in this directory (AC-ECA-043); screens ask this. */
export const odooOwnsProcurement = (): boolean => domainTier('procurement') === 'odoo';
