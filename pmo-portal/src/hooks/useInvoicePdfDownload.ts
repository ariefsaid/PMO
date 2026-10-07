import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { triggerBlobDownload } from '@/src/lib/download';
import { safePdfFilename } from '@/src/lib/invoicePdfFilename';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** #912 (AC-PDF-011): external-invoice-pdf refusal code → localized remedy. Literal keys so the
 *  catalogue test (AC-PDF-014) can see every one. */
const FAILURE_COPY: Record<string, readonly [string, string]> = {
  ERP_NOT_PERMITTED: ['financeCopy.invoicePdf.notPermitted', 'The ERP refused to print this invoice. Ask your administrator to give the integration user Print access to Sales Invoices.'],
  ERP_DOCUMENT_MISSING: ['financeCopy.invoicePdf.documentMissing', 'The ERP no longer has this invoice. Refresh the list and try again.'],
  NOT_SUBMITTED: ['financeCopy.invoicePdf.notSubmitted', 'Only a submitted invoice can be downloaded. Refresh the list — this invoice may have been cancelled.'],
  NOT_ERP_INVOICE: ['financeCopy.invoicePdf.notErpInvoice', 'This invoice was not issued through the ERP, so there is no ERP PDF.'],
  ERP_NOT_CONNECTED: ['financeCopy.invoicePdf.notConnected', 'The ERP connection is not active. Ask your administrator to check Integrations.'],
  NOT_FOUND: ['financeCopy.invoicePdf.notFound', 'This invoice is no longer available. Refresh the list.'],
  FORBIDDEN: ['financeCopy.invoicePdf.forbidden', 'You do not have access to download this invoice.'],
};
const UNREACHABLE_COPY = ['financeCopy.invoicePdf.unreachable', 'The ERP did not answer. Try again in a moment.'] as const;

/** Downloads the ERP's PDF of an invoice; one request per invoice at a time. */
export function useInvoicePdfDownload() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const inFlight = useRef(new Set<string>());

  const download = useCallback(
    async (invoice: Pick<SalesInvoiceRow, 'id' | 'si_number'>) => {
      if (inFlight.current.has(invoice.id)) return;
      inFlight.current.add(invoice.id);
      try {
        const pdf = await repositories.revenue.downloadInvoicePdf(invoice.id);
        triggerBlobDownload(pdf, safePdfFilename(invoice.si_number ?? ''));
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        const [key, fallback] = (typeof code === 'string' ? FAILURE_COPY[code] : undefined) ?? UNREACHABLE_COPY;
        toast(t('financeCopy.invoicePdf.failed', "Couldn't download the PDF"), t(key, fallback), 'warning');
      } finally {
        inFlight.current.delete(invoice.id);
      }
    },
    [t, toast],
  );

  return { download };
}
