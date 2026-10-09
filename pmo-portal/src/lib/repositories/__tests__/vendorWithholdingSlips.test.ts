import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ recordSlip: vi.fn(), correctSlip: vi.fn(), voidSlip: vi.fn(), listSlips: vi.fn(), listBills: vi.fn(), getSlip: vi.fn() }));
vi.mock('@/src/lib/db/vendorWithholdingSlips', () => m);
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'external') }));
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: vi.fn() }));
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { vendorWithholdingSlipsRepository as repo } from '../vendorWithholdingSlips';

beforeEach(() => { vi.clearAllMocks(); m.listSlips.mockResolvedValue({ rows: [], nextCursor: null }); m.listBills.mockResolvedValue({ rows: [], nextCursor: null }); });
it('AC-BUPOT-014 uses only PMO DAL readers/writers even under external ownership', async () => {
  await repo.record({ slipId: 's', vendorId: 'v', slipNumber: 'n', slipDate: '2026-10-01', taxPeriod: '2026-10-01', pphType: 'pph23', taxBase: '2.00', withheldAmount: '1.00', invoiceIds: ['i'], declaredInvoiceIds: [] });
  await repo.correct({ slipId: 's', expectedRevision: 1, slipNumber: 'n', slipDate: '2026-10-01', taxPeriod: '2026-10-01', reason: 'reason' });
  await repo.void({ slipId: 's', expectedRevision: 2, reason: 'reason' });
  expect(m.recordSlip).toHaveBeenCalledOnce(); expect(m.correctSlip).toHaveBeenCalledOnce(); expect(m.voidSlip).toHaveBeenCalledOnce();
  expect(routeDomainWrite).not.toHaveBeenCalled(); expect(dispatchDomainCommand).not.toHaveBeenCalled();
});
it('AC-BUPOT-014 coverage batches invoice IDs by the server’s 100-row bound', async () => {
  await repo.coverage(Array.from({ length: 205 }, (_, i) => `i-${i}`));
  expect(m.listBills.mock.calls.map(([arg]) => arg.p_invoice_ids.length)).toEqual([100, 100, 5]);
  expect(m.listBills.mock.calls.every(([arg]) => arg.limit === 100)).toBe(true);
});
it('AC-BUPOT-014 advances the null-date cursor as typed and preserves Postgres code/detail', async () => {
  await repo.listBills({ cursor: { id: 'i', date: null, nullDate: true } });
  expect(m.listBills).toHaveBeenCalledWith(expect.objectContaining({ p_after_id: 'i', p_after_null_date: true, p_after_date: undefined }));
  const failure = Object.assign(new Error('refused'), { code: '23514', details: 'bupot-amount-mismatch' });
  m.recordSlip.mockRejectedValueOnce(failure);
  await expect(repo.record({ slipId: 's', vendorId: 'v', slipNumber: 'n', slipDate: '2026-10-01', taxPeriod: '2026-10-01', pphType: 'pph23', taxBase: '2.00', withheldAmount: '1.00', invoiceIds: ['i'], declaredInvoiceIds: [] })).rejects.toMatchObject({ code: '23514', details: 'bupot-amount-mismatch' });
});
