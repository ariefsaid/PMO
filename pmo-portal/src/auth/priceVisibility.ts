import { roleSeesPrices } from './builtInRoles';

/**
 * #2699: who sees unit prices and amounts. The frontend mirror of the database's `actor_may_see_prices()` (migration 1215);
 * the database is the authority (ADR-0016), this only decides what to draw. With the organisation setting off everyone sees prices.
 * With it on, only a person holding a job role without the price right (Foreman, Field user) does not; a person with no job role
 * sees prices at every base level. Real role, per person, never the view-as role.
 */
export interface PriceVisibilityInput {
  settingOn: boolean;
  builtInRoleKey: string | null | undefined;
  active?: boolean;
}

export function canSeePrices({ settingOn, builtInRoleKey, active = true }: PriceVisibilityInput): boolean {
  if (!settingOn) return true;
  if (!active) return false;
  return roleSeesPrices(builtInRoleKey);
}
