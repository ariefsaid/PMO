/**
 * AC-TSC-R12 (FE DAL half) — `attestTimesheetNoErpDocument` is a thin wrapper over the Admin-only,
 * reason-required, audited `attest_timesheet_no_erp_document` RPC (mig 0157 §5 / 0159). It is the
 * product's route out of a post-submit ERP unknown (Luna FU-1a round-12 SHOULD-FIX 1). org_id is NEVER
 * sent — the security-definer RPC re-asserts org, Admin and active membership from auth context.
 *
 * This complements the pgTAP proof (0159_attestation_admits_the_reopen) that the RPC clears the witness
 * AND releases the held mirror so the re-open is admitted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

import { attestTimesheetNoErpDocument } from './timesheetTransition';

function makeRpcBuilder(resolved: { data: unknown; error: unknown }) {
  mockRpc.mockReturnValue({
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  });
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe('AC-TSC-R12: attestTimesheetNoErpDocument wraps the attest RPC', () => {
  it('AC-TSC-R12: calls attest_timesheet_no_erp_document(id, reason) with no org_id', async () => {
    makeRpcBuilder({ data: null, error: null });
    await attestTimesheetNoErpDocument('ts-att-1', 'Checked ERPNext: no Timesheet for this week');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('attest_timesheet_no_erp_document', {
      p_timesheet_id: 'ts-att-1',
      p_reason: 'Checked ERPNext: no Timesheet for this week',
    });
    // org_id is NEVER sent (the security-definer RPC re-asserts org from auth context).
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
    // No table access — this is a pure RPC wrapper.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('AC-TSC-R12: surfaces the RPC refusal verbatim (does not swallow it)', async () => {
    makeRpcBuilder({ data: null, error: { message: 'not authorized', code: '42501' } });
    await expect(
      attestTimesheetNoErpDocument('ts-att-2', 'reason'),
    ).rejects.toThrow('not authorized');
  });
});
