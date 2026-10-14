import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: vi.fn() } }));

import { AppError } from '@/src/lib/appError';
import { getProjectFinances, setSalesInvoiceProject } from './revenue';

const projectId = '02870000-0000-0000-0000-000000000001';
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

  it('AC-PFIN-014 reads one project through the checked RPC payload', async () => {
    h.rpc.mockResolvedValueOnce({ data: financePayload, error: null });
    await expect(getProjectFinances(projectId)).resolves.toEqual(financePayload);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('get_project_finances', { p_project_id: projectId });
  });

  it('AC-PFIN-014 maps RPC errors and rejects null, malformed, or mismatched project payloads', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'not allowed' } });
    await expect(getProjectFinances(projectId)).rejects.toMatchObject({ code: '42501' });
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(getProjectFinances(projectId)).rejects.toBeInstanceOf(AppError);
    h.rpc.mockResolvedValueOnce({ data: { ...financePayload, actuals: [] }, error: null });
    await expect(getProjectFinances(projectId)).rejects.toMatchObject({ code: 'invalid-project-finances' });
    h.rpc.mockResolvedValueOnce({ data: { ...financePayload, project_id: '02870000-0000-0000-0000-000000000002' }, error: null });
    await expect(getProjectFinances(projectId)).rejects.toMatchObject({ code: 'invalid-project-finances' });
  });
});
