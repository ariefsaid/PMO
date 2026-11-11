import { AppError } from '@/src/lib/appError';
import { invokeWithTimeout } from '@/src/lib/supabase/invokeWithTimeout';
import { supabase } from '@/src/lib/supabase/client';
import { throwInvokeError } from './repositoryErrors';
import type { SalesInvoiceEvidence } from '@/src/lib/adapterSeam/erpnext/invoiceEvidence';

const INVOKE_TIMEOUT_MS = 45_000;

const evidenceFallback = (error: unknown) =>
  new AppError(error instanceof Error ? error.message : 'Invoice evidence is unavailable', 'ERP_UNREACHABLE');

/** Caller-authorized, allowlisted ERP line and billing-contact read for one linked PMO invoice. */
export async function getSalesInvoiceEvidence(invoiceId: string): Promise<SalesInvoiceEvidence> {
  const { data, error } = await invokeWithTimeout(
    supabase.functions.invoke<SalesInvoiceEvidence>('external-invoice-evidence', {
      body: { salesInvoiceId: invoiceId },
    }),
    INVOKE_TIMEOUT_MS,
  );
  if (error) await throwInvokeError(error, undefined, evidenceFallback);
  if (!data || typeof data !== 'object') throw new AppError('Invoice evidence is unavailable', 'ERP_UNREACHABLE');
  return data;
}
