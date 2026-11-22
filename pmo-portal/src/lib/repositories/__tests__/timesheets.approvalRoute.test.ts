import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { AppError } from '@/src/lib/appError';
import { timesheetRepository } from '../timesheets';

// Block-bodied on purpose: `mockReset()` RETURNS the mock, and Vitest registers any function returned
// from `beforeEach` as an after-test cleanup — a phantom call that would reject with the body's own
// armed mock value and fail an otherwise passing test.
beforeEach(() => { h.rpc.mockReset(); });

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

  it('normalizes a thrown transport failure through the repository wrap contract', async () => {
    h.rpc.mockRejectedValue(new Error('network down'));

    // ONE rejected promise, asserted as a REJECTION (never resolved-and-caught): the seam must throw
    // exactly one normalized `AppError`, the single type every consumer classifies on.
    const read = timesheetRepository.getApprovalRoute('ts-1');
    await expect(read).rejects.toBeInstanceOf(AppError);
    await expect(read).rejects.toMatchObject({ message: 'network down' });
  });
});
