import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { dailySiteReportRepository } from '../dailySiteReports';

beforeEach(() => { h.rpc.mockReset(); });

/**
 * fix-waiting item 3 (FR-WAIT-006) — the repository seam exposes the typed route read unchanged: the
 * hook never reaches the DAL directly, and no org id travels with the call. The DAL's own validation
 * and the RPC args are owned by `src/lib/db/dsrValidationRoute.test.ts`.
 */
describe('FR-WAIT-006 dailySiteReportRepository.validationRoute', () => {
  it('forwards ONE report id to the typed route DAL and returns its parsed route', async () => {
    h.rpc.mockResolvedValue({
      data: { approvers: [{ id: 'u-pm', name: 'Rina Wati', role: 'Project Manager' }], route_kind: 'project_manager' },
      error: null,
    });

    await expect(dailySiteReportRepository.validationRoute('r1')).resolves.toEqual({
      routeKind: 'project_manager',
      approvers: [{ id: 'u-pm', name: 'Rina Wati', role: 'Project Manager' }],
    });
    expect(h.rpc).toHaveBeenCalledWith('get_dsr_validation_route', { p_report_id: 'r1' });
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain('org_id');
  });
});
