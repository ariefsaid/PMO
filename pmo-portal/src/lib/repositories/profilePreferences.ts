import { setMyInterfaceLanguage } from '@/src/lib/db/preferences';

/** API seam for the signed-in user's profile preferences. */
export const profilePreferencesRepository = {
  setInterfaceLanguage: (userId: string, locale: 'id' | 'en' | null): Promise<void> =>
    setMyInterfaceLanguage(userId, locale),
};
