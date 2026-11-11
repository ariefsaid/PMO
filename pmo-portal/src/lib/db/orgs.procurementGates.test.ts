/** FR-PFE-011 — the org's purchase rules are read and written only through their RPCs. */
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
import { getOrgProcurementGates, setOrgProcurementGates } from './orgs';

const OFF = { request_before_order: false, approval_before_order: false, approval_before_payment: false, receipt_before_invoice: false };
beforeEach(() => h.rpc.mockReset());

it('FR-PFE-011 reads the gates through get_procurement_gates', async () => {
  h.rpc.mockResolvedValueOnce({ data: OFF, error: null });
  expect(await getOrgProcurementGates()).toEqual(OFF);
  expect(h.rpc).toHaveBeenCalledWith('get_procurement_gates');
});

it('FR-PFE-011 writes only the changed key through set_procurement_gates and returns the stored gates', async () => {
  h.rpc.mockResolvedValueOnce({ data: { ...OFF, approval_before_payment: true }, error: null });
  const res = await setOrgProcurementGates({ approval_before_payment: true });
  expect(h.rpc).toHaveBeenCalledWith('set_procurement_gates', { p_gates: { approval_before_payment: true } });
  expect(res.approval_before_payment).toBe(true);
});

it('FR-PFE-011 a refusal surfaces with its code', async () => {
  h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Only an Admin can change purchase rules.', code: '42501' } });
  await expect(setOrgProcurementGates({ request_before_order: true })).rejects.toMatchObject({ message: 'Only an Admin can change purchase rules.' });
  h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: 'XX000' } });
  await expect(getOrgProcurementGates()).rejects.toThrow('boom');
});
