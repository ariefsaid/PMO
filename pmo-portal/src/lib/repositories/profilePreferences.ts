import { setMyLocalePreferences, type MyLocalePreferences } from '@/src/lib/db/preferences';

/** API seam for the signed-in user's profile preferences. */
export const profilePreferencesRepository = {
  setLocalePreferences: (userId: string, preferences: MyLocalePreferences): Promise<void> =>
    setMyLocalePreferences(userId, preferences),
};
