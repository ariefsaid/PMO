/** repositories/claimOverCap.ts (survey-cap-stop) — the seam over the organisation's claim-quantity setting (ADR-0017). */
import { getClaimOverCap, setClaimOverCap, type ClaimOverCapMode } from '@/src/lib/db/claimOverCap';
import { wrap } from './repositoryErrors';

export const claimOverCapRepository = {
  get: (orgId: string) => wrap(() => getClaimOverCap(orgId)),
  /** Admin-only (server). */
  set: (orgId: string, mode: ClaimOverCapMode) => wrap(() => setClaimOverCap(orgId, mode)),
};
