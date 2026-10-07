import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

const invoke = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
import { repositories } from './index';

function httpError(status: number, body: unknown) {
  const err = new Error('Edge Function returned a non-2xx status code') as Error & { context?: Response };
  err.context = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return err;
}

describe('repositories.revenue.downloadInvoicePdf', () => {
  beforeEach(() => invoke.mockReset());

  it('AC-PDF-015 invokes external-invoice-pdf with only the invoice id and returns the PDF Blob', async () => {
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    invoke.mockResolvedValue({ data: pdf, error: null });
    await expect(repositories.revenue.downloadInvoicePdf('si-1')).resolves.toBe(pdf);
    expect(invoke).toHaveBeenCalledWith('external-invoice-pdf', { body: { salesInvoiceId: 'si-1' } });
  });

  it('AC-PDF-015 a refusal surfaces the function code and fixed message', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(502, { error: 'ERP_NOT_PERMITTED', message: 'The ERP refused to print this invoice.' }),
    });
    await expect(repositories.revenue.downloadInvoicePdf('si-1')).rejects.toMatchObject({
      code: 'ERP_NOT_PERMITTED',
      message: 'The ERP refused to print this invoice.',
    });
  });

  it('AC-PDF-015 a success that is not a Blob is refused as ERP_UNREACHABLE', async () => {
    invoke.mockResolvedValue({ data: { not: 'a pdf' }, error: null });
    const err = await repositories.revenue.downloadInvoicePdf('si-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'ERP_UNREACHABLE' });
  });
});
