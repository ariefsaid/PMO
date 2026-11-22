/**
 * repositories/hidePrices.ts (#2699) — the seam over the "hide prices from requesters" setting and the caller's own price visibility
 * (ADR-0017). Standalone module (same shape as `builtInRoles.ts`): imported directly by its hooks.
 */
import { getHidePricesEnabled, setHidePricesEnabled, getMaySeePrices } from '@/src/lib/db/hidePrices';
import { wrap } from './repositoryErrors';

export const hidePricesRepository = {
  getEnabled: () => wrap(() => getHidePricesEnabled()),
  /** Admin-only (server). */
  setEnabled: (enabled: boolean) => wrap(() => setHidePricesEnabled(enabled)),
  getMaySee: () => wrap(() => getMaySeePrices()),
};
