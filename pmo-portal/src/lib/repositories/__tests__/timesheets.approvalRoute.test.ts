import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { timesheetRepository } from '../timesheets';

beforeEach(() => h.rpc.mockReset());

/**
 * fix-waiting item 3 (FR-WAIT-006) — the repository seam exposes the typed route read unchanged: the
 * hook never reaches the DAL directly, and no org id travels with the call. The DAL's own validation
 * and the RPC args are owned by `src/lib/db/timesheetApprovalRoute.test.ts`.
 */
describe('FR-WAIT-006 timesheetRepository.getApprovalRoute', () => {
  it('forwards ONE sheet id to the typed route DAL and returns its parsed route', async () => {
    h.rpc.mockResolvedValue({
      data: { approvers: [{ id: 'u-manager', name: 'Ani', role: 'line_manager' }], route_kind: 'line_manager' },
      error: null,
    });

    await expect(timesheetRepository.getApprovalRoute('ts-1')).resolves.toEqual({
      routeKind: 'line_manager',
      approvers: [{ id: 'u-manager', name: 'Ani', role: 'line_manager' }],
    });
    expect(h.rpc).toHaveBeenCalledWith('get_timesheet_approval_route', { p_timesheet_id: 'ts-1' });
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain('org_id');
  });
});
