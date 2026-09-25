import { describe, expect, it, vi } from 'vitest';

const setMyInterfaceLanguage = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/db/preferences', () => ({ setMyInterfaceLanguage }));

import { profilePreferencesRepository } from './profilePreferences';

describe('profile preferences repository', () => {
  it('passes the signed-in profile ID and inherit choice to the DAL and does not hide write failures', async () => {
    setMyInterfaceLanguage.mockRejectedValueOnce(new Error('write refused'));
    await expect(profilePreferencesRepository.setInterfaceLanguage('u1', null)).rejects.toThrow('write refused');
    expect(setMyInterfaceLanguage).toHaveBeenCalledWith('u1', null);
  });
});
