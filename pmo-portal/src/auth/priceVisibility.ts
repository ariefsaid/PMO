import type { Role } from './AuthContext';
import { roleSeesPrices } from './builtInRoles';

/**
 * #2699: who sees unit prices and amounts. The frontend mirror of the database's `actor_may_see_prices()` (migration 1215);
 * the database is the authority (ADR-0016), this only decides what to draw. With the organisation setting off everyone sees prices.
 * With it on, a person acting purely as a requester does not: a built-in officer or field role without price right, or a legacy
 * Engineer who holds no built-in role. Real role, per person, never the view-as role.
 */
export interface PriceVisibilityInput {
  settingOn: boolean;
  baseRole: Role | null | undefined;
  builtInRoleKey: string | null | undefined;
  active?: boolean;
}

export function canSeePrices({ settingOn, baseRole, builtInRoleKey, active = true }: PriceVisibilityInput): boolean {
  if (!settingOn) return true;
  if (!active) return false;
  if (!roleSeesPrices(builtInRoleKey)) return false;
  return !(builtInRoleKey == null && baseRole === 'Engineer');
}
