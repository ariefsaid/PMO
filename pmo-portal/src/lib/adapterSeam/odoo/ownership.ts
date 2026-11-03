import { domainTier } from '../ownershipCache.ts';

/** True once the ownership cache says Odoo runs procurement. The tier name stays in this directory (AC-ECA-043); screens ask this. */
export const odooOwnsProcurement = (): boolean => domainTier('procurement') === 'odoo';
