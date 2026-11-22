/** AC-TX-005/008 (#2712): the role-name DAL validates before writing and maps rows to overrides. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn().mockResolvedValue({ error: null });
const eq: ReturnType<typeof vi.fn> = vi.fn(() => Object.assign(Promise.resolve({ error: null }), { eq }));
const del = vi.fn(() => ({ eq }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: () => ({ upsert: (...a: unknown[]) => upsert(...a), delete: () => del(), select: () => ({ limit: () => Promise.resolve({ data: [
    { role_key: 'buyer', locale: 'en', name: 'Purchaser' },
    { role_key: 'buyer', locale: 'fr', name: 'Acheteur' },
    { role_key: 'ghost', locale: 'en', name: 'X' },
  ], error: null }) }) }) },
}));

import { listOrgRoleNames, resetOrgRoleName, rowsToRoleNames, saveOrgRoleName, validateRoleName } from './orgRoleNames';

beforeEach(() => vi.clearAllMocks());

describe('org role names DAL', () => {
  it('maps rows and drops unknown roles and languages', async () => {
    expect(await listOrgRoleNames()).toEqual({ en: { buyer: 'Purchaser' } });
    expect(rowsToRoleNames([])).toEqual({});
  });
  it('validates key, language, blank and length', () => {
    expect(validateRoleName({ roleKey: 'buyer', locale: 'en', name: 'Ok' })).toBeNull();
    expect(validateRoleName({ roleKey: 'nope', locale: 'en', name: 'Ok' })).toBe('unknownRole');
    expect(validateRoleName({ roleKey: 'buyer', locale: 'fr' as 'en', name: 'Ok' })).toBe('unknownLocale');
    expect(validateRoleName({ roleKey: 'buyer', locale: 'en', name: '  ' })).toBe('required');
    expect(validateRoleName({ roleKey: 'buyer', locale: 'en', name: 'x'.repeat(61) })).toBe('tooLong');
  });
  it('saves trimmed, without org_id, and refuses invalid input before the call', async () => {
    await saveOrgRoleName({ roleKey: 'buyer', locale: 'id', name: '  Pembeli Utama ' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ role_key: 'buyer', locale: 'id', name: 'Pembeli Utama' }), { onConflict: 'org_id,role_key,locale' });
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('org_id');
    await expect(saveOrgRoleName({ roleKey: 'buyer', locale: 'en', name: '' })).rejects.toThrow();
    expect(upsert).toHaveBeenCalledTimes(1);
  });
  it('reset deletes one row by role and language', async () => {
    await resetOrgRoleName('buyer', 'en');
    expect(eq).toHaveBeenCalledWith('role_key', 'buyer');
    expect(eq).toHaveBeenCalledWith('locale', 'en');
  });
});
