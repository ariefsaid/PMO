/**
 * AC-TSC-012 (FE DAL half) — `reopenApprovedTimesheet` is a PURE PMO transition: it calls
 * `transition_timesheet(id,'Draft')` and issues NO ERP / adapter / push / repositories call of any
 * kind (FR-TSC-060). Slice A's re-open of an un-pushed sheet is structural: the RPC does the status
 * flip server-side under the race-safe precondition; the client never reaches for ERP. org_id is
 * NEVER sent (the security-definer RPC re-asserts org from auth context).
 *
 * This is the client-side lock that the re-open issues no money command — complementing the pgTAP
 * proof (0151_timesheet_reopen_precondition.test.sql) that the RPC itself does no ERP I/O.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom, pushApprovedSpy } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
  // Lock: if a future change wires a push into the re-open DAL fn, this spy catches it.
  pushApprovedSpy: vi.fn(),
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: { timesheet: { pushApproved: pushApprovedSpy } },
}));

import { reopenApprovedTimesheet } from './timesheetTransition';

function makeRpcBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockRpc.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  pushApprovedSpy.mockReset();
});

describe('AC-TSC-012: reopenApprovedTimesheet is a pure PMO transition (no ERP call)', () => {
  it('AC-TSC-012: calls transition_timesheet(id,"Draft") with no org_id', async () => {
    makeRpcBuilder({ data: null, error: null });
    await reopenApprovedTimesheet('ts-reopen-1');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('transition_timesheet', {
      p_timesheet_id: 'ts-reopen-1',
      p_to: 'Draft',
    });
    // org_id is NEVER sent (the security-definer RPC re-asserts org from auth context).
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
  });

  it('AC-TSC-012: issues NO ERP / adapter / push / repositories call (FR-TSC-060 — pure PMO)', async () => {
    makeRpcBuilder({ data: null, error: null });
    await reopenApprovedTimesheet('ts-reopen-2');

    // The ONLY interaction with the backend is the single transition_timesheet RPC.
    expect(mockFrom).not.toHaveBeenCalled();
    expect(pushApprovedSpy).not.toHaveBeenCalled();
  });

  it('AC-TSC-012: surfaces the RPC error (does not swallow a refusal)', async () => {
    makeRpcBuilder({ data: null, error: { message: 'reopen-erp-document-held', code: 'P0001' } });
    await expect(reopenApprovedTimesheet('ts-reopen-3')).rejects.toThrow('reopen-erp-document-held');
    // A refusal still issues no ERP command.
    expect(pushApprovedSpy).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
