import { ODOO_TIER } from './connectAdapter.ts';

/** Keep the tier-specific revenue ownership decision inside the Odoo adapter seam. */
export const odooOwnsRevenueTier = (tier: string | undefined): boolean => tier === ODOO_TIER;
