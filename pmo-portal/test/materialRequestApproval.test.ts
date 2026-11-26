import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { captureMaterialRequestApproval } from '../e2e/support/materialRequestApproval';

it.each([{ steps: [] }, { steps: [
  { role: 'Engineer', job_role: 'foreman', label: 'Site check', only_over_plan: true },
  { role: 'Finance', job_role: null, label: 'Finance check', only_over_plan: false },
] }])('restores the original approval settings after a failed journey (%j)', async ({ steps }) => {
  const order = vi.fn().mockResolvedValue({ data: steps, error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: { approver_inbox: true }, error: null });
  const eq = vi.fn().mockReturnValue({ order, maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const admin = { from: vi.fn().mockReturnValue({ select }), rpc } as unknown as SupabaseClient;

  const restore = await captureMaterialRequestApproval(admin, 'test-org');
  await expect((async () => {
    try {
      throw new Error('journey failed');
    } finally {
      await restore();
    }
  })()).rejects.toThrow('journey failed');
  expect(eq).toHaveBeenCalledWith('org_id', 'test-org');
  expect(order).toHaveBeenCalledWith('position');
  expect(rpc).toHaveBeenCalledWith('mrq_set_chain', { p_steps: steps });
  expect(rpc).toHaveBeenCalledWith('mrq_set_approver_inbox', { p_on: true });
});
