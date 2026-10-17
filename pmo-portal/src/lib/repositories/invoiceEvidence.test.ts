import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/src/lib/appError';

const invoke = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } } }));
import { getSalesInvoiceEvidence } from './invoiceEvidence';

function httpError(status: number, body: unknown) {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & { context?: Response };
  error.context = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return error;
}

describe('getSalesInvoiceEvidence', () => {
  beforeEach(() => invoke.mockReset());

  it('S-17 invokes the dedicated evidence leaf with only the PMO invoice id', async () => {
    const evidence = { lines: [], contact: null };
    invoke.mockResolvedValue({ data: evidence, error: null });
    await expect(getSalesInvoiceEvidence('synthetic-invoice-id')).resolves.toEqual(evidence);
    expect(invoke).toHaveBeenCalledWith('external-invoice-evidence', {
      body: { salesInvoiceId: 'synthetic-invoice-id' },
    });
  });

  it('S-17 preserves the fixed server refusal message for retryable ERP failures', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(502, { error: 'ERP_UNREACHABLE', message: 'Invoice evidence is temporarily unavailable.' }),
    });
    await expect(getSalesInvoiceEvidence('synthetic-invoice-id')).rejects.toMatchObject({
      code: 'ERP_UNREACHABLE', message: 'Invoice evidence is temporarily unavailable.',
    });
  });

  it('rejects an unexpected success body without treating it as evidence', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    const error = await getSalesInvoiceEvidence('synthetic-invoice-id').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'ERP_UNREACHABLE' });
  });
});
