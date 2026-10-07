import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { submitSalesInvoiceSod } from './revenue';

describe('submitSalesInvoiceSod (#784) — the ERP-path submit refusals carry their machine-readable code', () => {
  it('#784 a PMO invoice refused by the ERP submit reads as pmo-native, not a bare SQLSTATE', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'raised in PMO', code: 'P0001', details: 'pmo-native' } });
    await expect(submitSalesInvoiceSod('si-1')).rejects.toMatchObject({ code: 'pmo-native', message: 'raised in PMO' });
  });
  it('#784 an SoD refusal keeps its own code; an unknown detail keeps the SQLSTATE', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'approver must differ', code: '42501', details: 'sod-self-approval' } });
    await expect(submitSalesInvoiceSod('si-1')).rejects.toMatchObject({ code: 'sod-self-approval' });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x', code: '42501', details: null } });
    await expect(submitSalesInvoiceSod('si-1')).rejects.toMatchObject({ code: '42501' });
  });
});
