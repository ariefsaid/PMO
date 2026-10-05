import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const state = { results: [] as Array<{ data: unknown; error: unknown }> };
  const calls = { select: vi.fn(), update: vi.fn(), eq: vi.fn(), from: vi.fn() };
  const builder = { select: calls.select, update: calls.update, eq: calls.eq, limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => resolve(state.results.shift()) };
  calls.select.mockReturnValue(builder); calls.update.mockReturnValue(builder); calls.eq.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder); calls.from.mockReturnValue(builder);
  return { state, calls };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.calls.from } }));
import { getOrgProjectClassificationOptions, setOrgProjectClassificationOptions } from './orgs';
beforeEach(() => { vi.clearAllMocks(); h.state.results = []; });
describe('AC-TAG-001 own-org classification option repository DAL', () => {
  it('reads exactly the configured option lists under RLS', async () => {
    h.state.results.push({ data: [{ service_line_options: ['Engineering'], sector_options: ['Energy'] }], error: null });
    expect(await getOrgProjectClassificationOptions()).toEqual({ serviceLines: ['Engineering'], sectors: ['Energy'] });
    expect(h.calls.select).toHaveBeenCalledWith('service_line_options,sector_options');
  });
  it('refuses unreadable settings instead of inventing empty option lists', async () => {
    h.state.results.push({ data: [], error: null });
    await expect(getOrgProjectClassificationOptions()).rejects.toThrow(/not available/i);
  });
  it('saves only option columns on the one RLS-readable organization', async () => {
    h.state.results.push({ data: [{ id: 'org-1' }], error: null }, { data: [{ id: 'org-1' }], error: null });
    await setOrgProjectClassificationOptions({ serviceLines: ['Engineering'], sectors: ['Energy'] });
    expect(h.calls.update).toHaveBeenCalledWith({ service_line_options: ['Engineering'], sector_options: ['Energy'] });
    expect(h.calls.eq).toHaveBeenCalledWith('id', 'org-1');
  });
  it('reports a refused settings write rather than claiming it succeeded', async () => {
    h.state.results.push({ data: [{ id: 'org-1' }], error: null }, { data: [], error: null });
    await expect(setOrgProjectClassificationOptions({ serviceLines: [], sectors: [] })).rejects.toThrow();
  });
});
