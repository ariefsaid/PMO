import { describe, expect, it, vi } from 'vitest';

const { setMyLocalePreferences } = vi.hoisted(() => ({
  setMyLocalePreferences: vi.fn(),
}));
vi.mock('@/src/lib/db/preferences', () => ({ setMyLocalePreferences }));

import { profilePreferencesRepository } from './profilePreferences';

describe('profile preferences repository', () => {
  it('passes the signed-in profile ID and inherit choices to the DAL and does not hide write failures', async () => {
    const inheritAll = { locale: null, numberLocale: null, timezone: null };
    setMyLocalePreferences.mockRejectedValueOnce(new Error('write refused'));
    await expect(profilePreferencesRepository.setLocalePreferences('u1', inheritAll)).rejects.toThrow('write refused');
    expect(setMyLocalePreferences).toHaveBeenCalledWith('u1', inheritAll);
  });

  it('AC-PLC-002: writes all nullable locale preferences together, preserving explicit values beside inherit', async () => {
    const preferences = { locale: 'en', numberLocale: null, timezone: 'Asia/Jakarta' };
    setMyLocalePreferences.mockResolvedValueOnce(undefined);

    await profilePreferencesRepository.setLocalePreferences('u1', preferences);

    expect(setMyLocalePreferences).toHaveBeenCalledWith('u1', preferences);
  });
});
