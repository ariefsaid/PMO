/**
 * Light accounts (#2710, OD-SCOPE-4): a profile whose built-in role is Foreman or Field user. One phone home screen, a separate
 * seat type. `seatTypeOf` is the single frontend mirror of the database's `profile_seat_type` / `is_light_role_key` (1205);
 * `lightAccount.test.ts` ties it to the role table so the two cannot drift. The database is the authority (restrictive RLS, 1206);
 * this only decides which shell the person sees.
 */
export const LIGHT_ROLE_KEYS = ['foreman', 'field_user'] as const;
export type SeatType = 'light' | 'full';

export function isLightRoleKey(key: string | null | undefined): boolean {
  return key === 'foreman' || key === 'field_user';
}

export const seatTypeOf = (key: string | null | undefined): SeatType => (isLightRoleKey(key) ? 'light' : 'full');

/** A signed-in profile is a light account (an inactive one is never signed in here). */
export const isLightAccount = (profile: { built_in_role?: string | null } | null | undefined): boolean =>
  isLightRoleKey(profile?.built_in_role);
