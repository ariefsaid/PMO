import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { AppError } from '@/src/lib/appError';
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

  it('normalizes a thrown transport failure through the repository wrap contract', async () => {
    h.rpc.mockRejectedValue(new Error('network down'));

    // Capture the thrown value explicitly: the seam must REJECT with one normalized `AppError`
    // (never the raw transport `Error`), because that is the single type every consumer classifies on.
    const failure = await timesheetRepository.getApprovalRoute('ts-1').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).message).toBe('network down');
  });
});
