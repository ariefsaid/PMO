import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), eq: vi.fn(), from: vi.fn(),
  result: { data: [{ id: 'org-1', down_payment_item: 'DP-ITEM' }] as unknown[], error: null as null | { message: string } } }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { getOrgDownPaymentItem, setOrgDownPaymentItem } from './orgs';
beforeEach(() => {
  vi.clearAllMocks();
  h.result.error = null;
  h.result.data = [{ id: 'org-1', down_payment_item: 'DP-ITEM' }];
  const builder = { select: h.select, update: h.update, eq: h.eq, limit: () => builder,
    then: (resolve: (value: typeof h.result) => unknown) => resolve(h.result) };
  h.from.mockReturnValue(builder); h.select.mockReturnValue(builder);
  h.update.mockReturnValue(builder); h.eq.mockReturnValue(builder);
});
it('AC-PB-011 reads the RLS-scoped down payment item', async () => {
  expect(await getOrgDownPaymentItem()).toBe('DP-ITEM');
  expect(h.select).toHaveBeenCalledWith('down_payment_item');
});
it('AC-PB-011 writes only that column to the one readable org', async () => {
  await setOrgDownPaymentItem(' DP-ITEM-2 ');
  expect(h.update).toHaveBeenCalledWith({ down_payment_item: 'DP-ITEM-2' });
  expect(h.eq).toHaveBeenCalledWith('id', 'org-1');
});
it('AC-PB-011 an item code over 140 characters makes no write', async () => {
  await expect(setOrgDownPaymentItem('x'.repeat(141))).rejects.toThrow(/140/);
  expect(h.update).not.toHaveBeenCalled();
});
it('AC-PB-011 a write RLS filtered to nothing is reported, not silently accepted', async () => {
  h.update.mockImplementation(() => ({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }));
  await expect(setOrgDownPaymentItem('DP-ITEM')).rejects.toThrow('Only an Admin can change the down payment item.');
});
