import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), eq: vi.fn(), from: vi.fn(),
  result: { data: [{ id: 'org-1', tax_prepaid_account: 'Tax Prepaid - DEMO' }], error: null as null | { message: string } } }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { getOrgWithholdingAccount, setOrgWithholdingAccount } from './orgs';
beforeEach(() => {
  vi.clearAllMocks();
  h.result.error = null;
  const builder = { select: h.select, update: h.update, eq: h.eq, limit: () => builder,
    then: (resolve: (value: typeof h.result) => unknown) => resolve(h.result) };
  h.from.mockReturnValue(builder); h.select.mockReturnValue(builder);
  h.update.mockReturnValue(builder); h.eq.mockReturnValue(builder);
});
it('AC-WHT-004: reads the RLS-scoped org account setting without a client org filter', async () => {
  expect(await getOrgWithholdingAccount()).toBe('Tax Prepaid - DEMO');
  expect(h.select).toHaveBeenCalledWith('tax_prepaid_account');
  expect(h.eq).not.toHaveBeenCalled();
});
it('AC-WHT-004: changing the account writes only that column to the RLS-resolved org', async () => {
  await setOrgWithholdingAccount(' Tax Credit - DEMO ');
  expect(h.update).toHaveBeenCalledWith({ tax_prepaid_account: 'Tax Credit - DEMO' });
  expect(h.eq).toHaveBeenCalledWith('id', 'org-1');
});
it('AC-WHT-004: refusing an account longer than the ERP link limit makes no write', async () => {
  await expect(setOrgWithholdingAccount('x'.repeat(141))).rejects.toThrow(/140/);
  expect(h.update).not.toHaveBeenCalled();
});
