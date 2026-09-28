import { describe, expect, it, vi } from 'vitest';

const { setMyInterfaceLanguage, setMyLocalePreferences } = vi.hoisted(() => ({
  setMyInterfaceLanguage: vi.fn(),
  setMyLocalePreferences: vi.fn(),
}));
vi.mock('@/src/lib/db/preferences', () => ({ setMyInterfaceLanguage, setMyLocalePreferences }));

import { profilePreferencesRepository } from './profilePreferences';

describe('profile preferences repository', () => {
  it('passes the signed-in profile ID and inherit choice to the DAL and does not hide write failures', async () => {
    setMyInterfaceLanguage.mockRejectedValueOnce(new Error('write refused'));
    await expect(profilePreferencesRepository.setInterfaceLanguage('u1', null)).rejects.toThrow('write refused');
    expect(setMyInterfaceLanguage).toHaveBeenCalledWith('u1', null);
  });

  it('AC-PLC-002: writes all nullable locale preferences together, preserving explicit values beside inherit', async () => {
    const preferences = { locale: 'en', numberLocale: null, timezone: 'Asia/Jakarta' };
    setMyLocalePreferences.mockResolvedValueOnce(undefined);

    await profilePreferencesRepository.setLocalePreferences('u1', preferences);

    expect(setMyLocalePreferences).toHaveBeenCalledWith('u1', preferences);
  });
});
