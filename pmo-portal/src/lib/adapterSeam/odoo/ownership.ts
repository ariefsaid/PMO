import { ODOO_TIER } from './connectAdapter.ts';
import { domainTier } from '../ownershipCache.ts';

/** Keep tier identity checks inside the Odoo adapter seam. */
export const odooOwnsTier = (tier: unknown): boolean => tier === ODOO_TIER;
/** Revenue callers keep the domain-specific name while sharing the seam's generic tier check. */
export const odooOwnsRevenueTier = odooOwnsTier;

/** True once the ownership cache says Odoo runs procurement. The tier name stays in this directory (AC-ECA-043); screens ask this. */
export const odooOwnsProcurement = (): boolean => domainTier('procurement') === 'odoo';
