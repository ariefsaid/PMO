import { ODOO_TIER } from './connectAdapter.ts';
import { domainTier } from '../ownershipCache.ts';

/** Keep the procurement tier identity check inside the adapter seam (AC-ECA-043). */
export const odooOwnsProcurementTier = (tier: unknown): boolean => tier === ODOO_TIER;
/** Keep the revenue tier identity check inside the adapter seam (AC-ECA-043). */
export const odooOwnsRevenueTier = (tier: unknown): boolean => tier === ODOO_TIER;
/** Keep the companies tier identity check inside the adapter seam (AC-ECA-043). */
export const odooOwnsCompaniesTier = (tier: unknown): boolean => tier === ODOO_TIER;
/** Keep the projects tier identity check inside the adapter seam (AC-ECA-043). */
export const odooOwnsProjectsTier = (tier: unknown): boolean => tier === ODOO_TIER;
export const odooOwnsProjectTier = odooOwnsProjectsTier;

/** True once the ownership cache says Odoo runs procurement. The tier name stays in this directory (AC-ECA-043); screens ask this. */
export const odooOwnsProcurement = (): boolean => domainTier('procurement') === 'odoo';
