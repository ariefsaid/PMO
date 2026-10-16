import { AppError } from '@/src/lib/appError';
import { invokeWithTimeout } from '@/src/lib/supabase/invokeWithTimeout';
import { supabase } from '@/src/lib/supabase/client';
import type { SalesInvoiceEvidence } from '@/src/lib/adapterSeam/erpnext/invoiceEvidence';

const INVOKE_TIMEOUT_MS = 45_000;

async function throwEvidenceError(error: unknown): Promise<never> {
  const response = (error as { context?: Response } | null | undefined)?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const body = await response.clone().json() as { error?: string; message?: string };
      if (typeof body.message === 'string' && body.message.trim()) throw new AppError(body.message, body.error);
    } catch (parsed) {
      if (parsed instanceof AppError) throw parsed;
    }
  }
  const message = error instanceof Error ? error.message : 'Invoice evidence is unavailable';
  throw new AppError(message, 'ERP_UNREACHABLE');
}

/** Caller-authorized, allowlisted ERP line and billing-contact read for one linked PMO invoice. */
export async function getSalesInvoiceEvidence(invoiceId: string): Promise<SalesInvoiceEvidence> {
  const { data, error } = await invokeWithTimeout(
    supabase.functions.invoke<SalesInvoiceEvidence>('external-invoice-evidence', {
      body: { salesInvoiceId: invoiceId },
    }),
    INVOKE_TIMEOUT_MS,
  );
  if (error) await throwEvidenceError(error);
  if (!data || typeof data !== 'object') throw new AppError('Invoice evidence is unavailable', 'ERP_UNREACHABLE');
  return data;
}
