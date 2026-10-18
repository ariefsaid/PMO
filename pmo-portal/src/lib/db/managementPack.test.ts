import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getManagementPackFacts, recordProjectProgress, parseManagementPackFacts } from './managementPack';

const body = {
  from: '2026-01-01', to: '2026-04-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [], invoiced: [], invoiced_before: [], progress: [],
};

beforeEach(() => h.rpc.mockReset());

describe('db/managementPack', () => {
  it('AC-MMP-013 support: omits an unset window so the server picks the org-timezone default', async () => {
    h.rpc.mockResolvedValue({ data: body, error: null });
    await getManagementPackFacts({});
    expect(h.rpc).toHaveBeenCalledWith('get_management_pack', {});
  });

  it('AC-MMP-013 support: passes a chosen window through', async () => {
    h.rpc.mockResolvedValue({ data: body, error: null });
    await getManagementPackFacts({ from: '2026-01-01', to: '2026-04-01' });
    expect(h.rpc).toHaveBeenCalledWith('get_management_pack', { p_from: '2026-01-01', p_to: '2026-04-01' });
  });

  it('AC-MMP-013 support: a malformed body is an error, never an empty pack', () => {
    expect(() => parseManagementPackFacts({ ...body, projects: null })).toThrow(/malformed/);
    expect(() => parseManagementPackFacts(null)).toThrow(/malformed/);
  });

  it('AC-MIP-005: accepts empty earlier facts and preserves finite nonnegative invoice counts', () => {
    expect(parseManagementPackFacts(body).invoiced_before).toEqual([]);
    expect(parseManagementPackFacts({
      ...body,
      invoiced_before: [
        { project_id: 'p1', currency: 'USD', net: 0, invoice_count: 0 },
        { project_id: 'p2', currency: 'EUR', net: 0, invoice_count: 2 },
      ],
    }).invoiced_before).toEqual([
      { project_id: 'p1', currency: 'USD', net: 0, invoice_count: 0 },
      { project_id: 'p2', currency: 'EUR', net: 0, invoice_count: 2 },
    ]);
  });

  it('AC-MIP-005: rejects a missing earlier invoice count as malformed', () => {
    expect(() => parseManagementPackFacts({
      ...body,
      invoiced_before: [{ project_id: 'p1', currency: 'USD', net: 0 }],
    })).toThrow(expect.objectContaining({ code: 'pack-malformed' }));
  });

  it.each([
    ['null', null],
    ['negative', -1],
    ['fractional', 0.5],
    ['string', '2'],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])(
    'AC-MIP-005: rejects %s earlier invoice count as malformed',
    (_label, invoice_count) => {
      expect(() => parseManagementPackFacts({
        ...body,
        invoiced_before: [{ project_id: 'p1', currency: 'USD', net: 0, invoice_count }],
      })).toThrow(expect.objectContaining({ code: 'pack-malformed' }));
    },
  );

  it('AC-MMP-013 support: an RPC error keeps its code', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'window', code: '22023' } });
    await expect(getManagementPackFacts({})).rejects.toMatchObject({ code: '22023' });
  });

  it('AC-MMP-014 support: records progress with a trimmed note, omitting an empty one', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await recordProjectProgress({ projectId: 'p1', month: '2026-03-01', pctComplete: 45, note: '  site visit ' });
    await recordProjectProgress({ projectId: 'p1', month: '2026-04-01', pctComplete: 50, note: '   ' });
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'record_project_progress',
      { p_project_id: 'p1', p_month: '2026-03-01', p_pct_complete: 45, p_note: 'site visit' });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'record_project_progress',
      { p_project_id: 'p1', p_month: '2026-04-01', p_pct_complete: 50 });
  });
});
