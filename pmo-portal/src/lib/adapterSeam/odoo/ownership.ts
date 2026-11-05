import { ODOO_TIER } from './connectAdapter.ts';
import { domainTier } from '../ownershipCache.ts';

/** Keep the procurement tier identity check inside the adapter seam (AC-ECA-043). */
export const odooOwnsProcurementTier = (tier: unknown): boolean => tier === ODOO_TIER;
/** Keep the revenue tier identity check inside the adapter seam (AC-ECA-043). */
export const odooOwnsRevenueTier = (tier: unknown): boolean => tier === ODOO_TIER;

/** True once the ownership cache says Odoo runs procurement. The tier name stays in this directory (AC-ECA-043); screens ask this. */
export const odooOwnsProcurement = (): boolean => domainTier('procurement') === 'odoo';
