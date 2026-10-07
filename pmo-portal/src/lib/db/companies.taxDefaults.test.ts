import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: vi.fn() } }));
import { setCompanyTaxDefaults } from './companies';

beforeEach(() => vi.clearAllMocks());

it('AC-VWH-032 (DAL): setCompanyTaxDefaults calls set_vendor_tax_defaults with the parsed defaults', async () => {
  h.rpc.mockResolvedValue({ data: { id: 'vendor-1' }, error: null });
  await setCompanyTaxDefaults('vendor-1', { vatRate: 11, pphType: 'pph23', pphRate: 2 });
  expect(h.rpc).toHaveBeenCalledWith('set_vendor_tax_defaults', { p_company_id: 'vendor-1', p_vat_rate: 11, p_pph_type: 'pph23', p_pph_rate: 2 });
});

it('AC-VWH-032 (DAL): a cleared default is not sent (the RPC default is null)', async () => {
  h.rpc.mockResolvedValue({ data: { id: 'vendor-1' }, error: null });
  await setCompanyTaxDefaults('vendor-1', { vatRate: null, pphType: null, pphRate: null });
  const args = h.rpc.mock.calls[0][1] as Record<string, unknown>;
  expect(args).toEqual({ p_company_id: 'vendor-1', p_vat_rate: undefined, p_pph_type: undefined, p_pph_rate: undefined });
  expect(JSON.parse(JSON.stringify(args))).toEqual({ p_company_id: 'vendor-1' });
});

it('AC-VWH-032 (DAL): a refused save keeps its Postgres code', async () => {
  h.rpc.mockResolvedValue({ data: null, error: { message: "only Admin or Finance can set a vendor's tax defaults", code: '42501' } });
  await expect(setCompanyTaxDefaults('vendor-1', { vatRate: 11, pphType: null, pphRate: null })).rejects.toMatchObject({ code: '42501' });
});
