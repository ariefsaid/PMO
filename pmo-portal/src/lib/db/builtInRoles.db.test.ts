import { describe, it, expect, vi, beforeEach } from 'vitest';

/** #2709 — the built-in role setting and assignment at the DAL seam. No org id is ever sent; the database decides. */
const h = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { rpc: h.rpc, from: () => ({ update: h.update }) },
}));

import { getOrgBuiltInRolesEnabled, setOrgBuiltInRolesEnabled } from '@/src/lib/db/orgs';
import { updateUserBuiltInRole } from '@/src/lib/db/adminUsers';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.rpc.mockReset();
  h.update.mockReset();
  h.update.mockReturnValue({ eq: h.eq });
  h.eq.mockReturnValue({ select: h.select });
});

describe('AC-014 the organization setting', () => {
  it('reads true only when the server says true', async () => {
    h.rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(getOrgBuiltInRolesEnabled()).resolves.toBe(true);
    expect(h.rpc).toHaveBeenCalledWith('get_built_in_roles_enabled');
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(getOrgBuiltInRolesEnabled()).resolves.toBe(false);
  });
  it('a transport error is a failure, not off', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline', code: 'FETCH_ERROR' } });
    await expect(getOrgBuiltInRolesEnabled()).rejects.toBeInstanceOf(AppError);
  });
  it('sends only the flag to the Admin setter and preserves the error code', async () => {
    h.rpc.mockResolvedValueOnce({ data: true, error: null });
    await setOrgBuiltInRolesEnabled(true);
    expect(h.rpc).toHaveBeenCalledWith('set_built_in_roles_enabled', { p_enabled: true });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'only an Admin', code: '42501' } });
    await expect(setOrgBuiltInRolesEnabled(false)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-006 assigning a built-in role', () => {
  it('updates only built_in_role for that person', async () => {
    h.select.mockResolvedValueOnce({ data: [{ id: 'u1' }], error: null });
    await updateUserBuiltInRole('u1', 'planner');
    expect(h.update).toHaveBeenCalledWith({ built_in_role: 'planner' });
    expect(h.eq).toHaveBeenCalledWith('id', 'u1');
  });
  it('clears with null', async () => {
    h.select.mockResolvedValueOnce({ data: [{ id: 'u1' }], error: null });
    await updateUserBuiltInRole('u1', null);
    expect(h.update).toHaveBeenCalledWith({ built_in_role: null });
  });
  it('a refusal (setting off, not allowed) surfaces with its code; a silent zero-row write is not success', async () => {
    h.select.mockResolvedValueOnce({ data: null, error: { message: 'not turned on', code: 'P0001' } });
    await expect(updateUserBuiltInRole('u1', 'planner')).rejects.toMatchObject({ code: 'P0001' });
    h.select.mockResolvedValueOnce({ data: [], error: null });
    await expect(updateUserBuiltInRole('u1', 'planner')).rejects.toBeInstanceOf(Error);
  });
});
