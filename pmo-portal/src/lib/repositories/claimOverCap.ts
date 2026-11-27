/** repositories/claimOverCap.ts (survey-cap-stop) — the seam over the organisation's claim-quantity setting (ADR-0017). */
import { getClaimOverCap, setClaimOverCap, type ClaimOverCapMode } from '@/src/lib/db/claimOverCap';
import { wrap } from './repositoryErrors';

export const claimOverCapRepository = {
  get: () => wrap(getClaimOverCap),
  /** Admin-only (server). */
  set: (mode: ClaimOverCapMode) => wrap(() => setClaimOverCap(mode)),
};
