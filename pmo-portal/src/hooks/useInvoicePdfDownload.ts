import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useToast } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { triggerBlobDownload } from '@/src/lib/download';
import { safePdfFilename } from '@/src/lib/invoicePdfFilename';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** #912 (AC-PDF-011): external-invoice-pdf refusal code → localized remedy. Each key sits in its own
 *  literal `t()` call so the extractor, the i18n completeness gate and the catalogue test (AC-PDF-014)
 *  all see it. */
const FAILURE_COPY: Record<string, (t: TFunction) => string> = {
  ERP_NOT_PERMITTED: (t) => t('financeCopy.invoicePdf.notPermitted', 'The ERP refused to print this invoice. Ask your administrator to give the integration user Print access to Sales Invoices.'),
  ERP_DOCUMENT_MISSING: (t) => t('financeCopy.invoicePdf.documentMissing', 'The ERP no longer has this invoice. Refresh the list and try again.'),
  NOT_SUBMITTED: (t) => t('financeCopy.invoicePdf.notSubmitted', 'Only a submitted invoice can be downloaded. Refresh the list — this invoice may have been cancelled.'),
  NOT_ERP_INVOICE: (t) => t('financeCopy.invoicePdf.notErpInvoice', 'This invoice was not issued through the ERP, so there is no ERP PDF.'),
  ERP_NOT_CONNECTED: (t) => t('financeCopy.invoicePdf.notConnected', 'The ERP connection is not active. Ask your administrator to check Integrations.'),
  NOT_FOUND: (t) => t('financeCopy.invoicePdf.notFound', 'This invoice is no longer available. Refresh the list.'),
  FORBIDDEN: (t) => t('financeCopy.invoicePdf.forbidden', 'You do not have access to download this invoice.'),
  UNAUTHORIZED: (t) => t('financeCopy.invoicePdf.sessionExpired', 'Your session expired — sign in again.'),
};
const unreachableCopy = (t: TFunction) => t('financeCopy.invoicePdf.unreachable', 'The ERP did not answer. Try again in a moment.');

/** Downloads the ERP's PDF of an invoice; one request per invoice at a time. */
export function useInvoicePdfDownload() {
  const { t } = useTranslation();
  const { toast } = useToast();
  // Lazily created once — `useRef(new Set())` would build (and discard) a Set on every render.
  const inFlight = useRef<Set<string> | null>(null);

  const download = useCallback(
    async (invoice: Pick<SalesInvoiceRow, 'id' | 'si_number'>) => {
      const pending = (inFlight.current ??= new Set<string>());
      if (pending.has(invoice.id)) return;
      pending.add(invoice.id);
      toast(t('financeCopy.invoicePdf.preparing', 'Preparing PDF…'), undefined, 'info');
      try {
        const pdf = await repositories.revenue.downloadInvoicePdf(invoice.id);
        triggerBlobDownload(pdf, safePdfFilename(invoice.si_number ?? ''));
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        const remedy = (typeof code === 'string' && Object.hasOwn(FAILURE_COPY, code) ? FAILURE_COPY[code] : unreachableCopy)(t);
        toast(t('financeCopy.invoicePdf.failed', "Couldn't download the PDF"), remedy, 'warning');
      } finally {
        pending.delete(invoice.id);
      }
    },
    [t, toast],
  );

  return { download };
}
