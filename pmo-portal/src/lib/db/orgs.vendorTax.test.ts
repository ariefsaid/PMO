import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), eq: vi.fn(), from: vi.fn(),
  result: { data: [{ id: 'org-1', input_vat_account: 'Input VAT - DEMO', pph23_payable_account: null, pph4_2_payable_account: 'PPh 4(2) Payable - DEMO' }],
    error: null as null | { message: string } } }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { getOrgVendorTaxAccounts, setOrgVendorTaxAccounts } from './orgs';
beforeEach(() => {
  vi.clearAllMocks();
  h.result.error = null;
  const builder = { select: h.select, update: h.update, eq: h.eq, limit: () => builder,
    then: (resolve: (value: typeof h.result) => unknown) => resolve(h.result) };
  h.from.mockReturnValue(builder); h.select.mockReturnValue(builder);
  h.update.mockReturnValue(builder); h.eq.mockReturnValue(builder);
});
it('AC-VWH-032 (DAL): reads the RLS-scoped org tax accounts without a client org filter', async () => {
  expect(await getOrgVendorTaxAccounts()).toEqual({ inputVatAccount: 'Input VAT - DEMO', pph23PayableAccount: null, pph42PayableAccount: 'PPh 4(2) Payable - DEMO' });
  expect(h.select).toHaveBeenCalledWith('input_vat_account,pph23_payable_account,pph4_2_payable_account');
  expect(h.eq).not.toHaveBeenCalled();
});
it('AC-VWH-032 (DAL): saving writes exactly the three trimmed columns (blank → none) to the RLS-resolved org', async () => {
  await setOrgVendorTaxAccounts({ inputVatAccount: ' Input VAT - DEMO ', pph23PayableAccount: '', pph42PayableAccount: 'PPh 4(2) Payable - DEMO' });
  expect(h.update).toHaveBeenCalledWith({ input_vat_account: 'Input VAT - DEMO', pph23_payable_account: null, pph4_2_payable_account: 'PPh 4(2) Payable - DEMO' });
  expect(h.eq).toHaveBeenCalledWith('id', 'org-1');
});
it('AC-VWH-032 (DAL): a name longer than the ERPNext link limit makes no write', async () => {
  await expect(setOrgVendorTaxAccounts({ inputVatAccount: 'x'.repeat(141), pph23PayableAccount: null, pph42PayableAccount: null })).rejects.toThrow(/140/);
  expect(h.update).not.toHaveBeenCalled();
});
