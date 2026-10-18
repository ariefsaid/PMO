import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: vi.fn() } }));

import { AppError } from '@/src/lib/appError';
import { getProjectFinances, setSalesInvoiceProject } from './revenue';

const projectId = '02900000-0000-0000-0000-000000000001';
const financePayload = {
  project_id: projectId,
  contract_invoiced: null,
  remaining_to_invoice: null,
  invoices: [],
  budget: null,
  actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] },
};

describe('project finance DAL', () => {
  beforeEach(() => h.rpc.mockReset());

  it('AC-PFIN-010 assigns an invoice project with only the authorized RPC arguments', async () => {
    h.rpc.mockResolvedValueOnce({ error: null });
    await expect(setSalesInvoiceProject('invoice-1', 'project-1')).resolves.toBeUndefined();
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('assign_sales_invoice_project', {
      p_si_id: 'invoice-1', p_project_id: 'project-1',
    });
  });

  it('AC-PFIN-014 reads one project through the checked RPC payload and reports legacy cash as not-reported', async () => {
    h.rpc.mockResolvedValueOnce({ data: financePayload, error: null });
    await expect(getProjectFinances(projectId)).resolves.toEqual({ ...financePayload,
      cash_received: { state: 'unavailable', buckets: [], reason: 'not-reported' },
    });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('get_project_finances', { p_project_id: projectId });
  });

  it('AC-UWC-009 normalizes known and incomplete cash without changing the legacy finance readings', async () => {
    const payload = { ...financePayload,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '25.00', outstanding: '75.00',
        missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '90.00', missing_work: 0 }],
      actuals: { currency: 'USD', as_of: '2026-10-16T00:00:00Z', total: '50.00', excludes_restricted_rows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '50.00' }] },
    };
    const known = { state: 'known', buckets: [{ currency: 'USD', amount: '0.00' }, { currency: 'IDR', amount: '7.50' }], receipt_count: 1 };
    h.rpc.mockResolvedValueOnce({ data: { ...payload, cash_received: known }, error: null });
    const knownResult = await getProjectFinances(projectId);
    expect(knownResult.cash_received).toEqual(known);
    expect(knownResult.invoices).toEqual(payload.invoices);
    expect(knownResult.actuals).toEqual(payload.actuals);

    const incomplete = { state: 'incomplete', buckets: [], receipt_count: 2, reasons: ['allocation-unreported'] };
    h.rpc.mockResolvedValueOnce({ data: { ...payload, cash_received: incomplete }, error: null });
    const incompleteResult = await getProjectFinances(projectId);
    expect(incompleteResult.cash_received).toEqual(incomplete);
    expect(incompleteResult.invoices).toEqual(payload.invoices);
    expect(incompleteResult.actuals).toEqual(payload.actuals);
  });

  it('AC-UWC-009 rejects only malformed present cash and preserves valid settlement and Actual fields', async () => {
    const payload = { ...financePayload,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: '25.00', outstanding: '75.00',
        missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '90.00', missing_work: 0 }],
      actuals: { currency: 'USD', as_of: '2026-10-16T00:00:00Z', total: '50.00', excludes_restricted_rows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '50.00' }] },
    };
    h.rpc.mockResolvedValueOnce({ data: { ...payload, cash_received: {
      state: 'known', buckets: [{ currency: 'USD', amount: '-1.00' }], receipt_count: 1,
    } }, error: null });
    const result = await getProjectFinances(projectId);
    expect(result.cash_received).toEqual({ state: 'unavailable', buckets: [], reason: 'invalid-reading' });
    expect(result.invoices).toEqual(payload.invoices);
    expect(result.actuals).toEqual(payload.actuals);
  });

  it('AC-PFIN-014 maps RPC errors and rejects null, malformed, or mismatched project payloads', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'not allowed' } });
    await expect(getProjectFinances(projectId)).rejects.toMatchObject({ code: '42501' });
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(getProjectFinances(projectId)).rejects.toBeInstanceOf(AppError);
    h.rpc.mockResolvedValueOnce({ data: { ...financePayload, actuals: [] }, error: null });
    await expect(getProjectFinances(projectId)).rejects.toMatchObject({ code: 'invalid-project-finances' });
    h.rpc.mockResolvedValueOnce({ data: { ...financePayload, project_id: '02900000-0000-0000-0000-000000000002' }, error: null });
    await expect(getProjectFinances(projectId)).rejects.toMatchObject({ code: 'invalid-project-finances' });
  });
});
