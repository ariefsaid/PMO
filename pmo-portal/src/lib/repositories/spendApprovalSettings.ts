import { getSpendApprovalTiersEnabled, setSpendApprovalTiersEnabled } from '@/src/lib/db/spendApprovers';
import { wrap } from './repositoryErrors';

/**
 * #2695 — the organisation's approval-tier setting (spend_approval_settings, migration 1290). A repository of its own,
 * beside orgSettings, so the API-seam lists of the existing repositories are unchanged. Every active member reads;
 * writes are Admin-only (RLS). UX gates with can('manage','orgAccounting') are the caller's (ADR-0016).
 */
export const spendApprovalSettingsRepository = {
  getTiersEnabled: (): Promise<boolean> => wrap(() => getSpendApprovalTiersEnabled()),
  setTiersEnabled: (enabled: boolean): Promise<void> => wrap(() => setSpendApprovalTiersEnabled(enabled)),
};
