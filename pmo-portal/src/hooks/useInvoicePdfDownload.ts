import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { triggerBlobDownload } from '@/src/lib/download';
import { safePdfFilename } from '@/src/lib/invoicePdfFilename';
import { useEffectiveRole } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** #912 (AC-PDF-011): external-invoice-pdf refusal code → localized remedy. Each key sits in its own
 *  literal `t()` call so the extractor, the i18n completeness gate and the catalogue test (AC-PDF-014)
 *  all see it. The `admin` flag says where the fix lives: an Admin is told where to go fix it, anyone
 *  else is told who to ask. */
type FailureCopy = (t: TFunction, admin: boolean) => string;
const FAILURE_COPY: Record<string, FailureCopy> = {
  ERP_NOT_PERMITTED: (t, admin) => admin
    ? t('financeCopy.invoicePdf.notPermittedAdmin', 'The ERP refused to print this invoice. Open Administration → Integrations to check the connection, and in ERPNext give the integration user Print access to Sales Invoices.')
    : t('financeCopy.invoicePdf.notPermitted', 'The ERP refused to print this invoice. Ask your administrator to give the integration user Print access to Sales Invoices.'),
  ERP_DOCUMENT_MISSING: (t) => t('financeCopy.invoicePdf.documentMissing', 'The ERP no longer has this invoice.'),
  NOT_SUBMITTED: (t) => t('financeCopy.invoicePdf.notSubmitted', 'Only a submitted invoice can be downloaded — this invoice may have been cancelled.'),
  NOT_ERP_INVOICE: (t) => t('financeCopy.invoicePdf.notErpInvoice', 'This invoice was not issued through the ERP, so there is no ERP PDF.'),
  ERP_NOT_CONNECTED: (t, admin) => admin
    ? t('financeCopy.invoicePdf.notConnectedAdmin', 'The ERP connection is not active. Open Administration → Integrations and reconnect the ERP.')
    : t('financeCopy.invoicePdf.notConnected', 'The ERP connection is not active. Ask your administrator to check Integrations.'),
  NOT_FOUND: (t) => t('financeCopy.invoicePdf.notFound', 'This invoice is no longer available.'),
  FORBIDDEN: (t) => t('financeCopy.invoicePdf.forbidden', 'You do not have access to download this invoice.'),
  UNAUTHORIZED: (t) => t('financeCopy.invoicePdf.sessionExpired', 'Your session expired — sign in again.'),
};
const unreachableCopy = (t: TFunction) => t('financeCopy.invoicePdf.unreachable', 'PMO could not reach the download service. Try again in a moment.');

/** Refusal codes that mean the PMO mirror is stale relative to the ERP (cancelled, deleted, moved):
 *  the sales-invoices list re-reads itself instead of telling the user to refresh by hand. */
const STALE_LIST_CODES = new Set(['NOT_SUBMITTED', 'ERP_DOCUMENT_MISSING', 'NOT_FOUND']);

/** Downloads the ERP's PDF of an invoice; one request per invoice at a time. */
export function useInvoicePdfDownload() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { realRole } = useEffectiveRole();
  // Lazily created once — `useRef(new Set())` would build (and discard) a Set on every render.
  const pending = useRef<Set<string> | null>(null);
  // Mirrors `pending` reactively so the row menu can disable the item while THIS invoice's
  // download runs (AC-PDF-011) — a repeat click is impossible, not silent.
  const [inFlightIds, setInFlightIds] = useState<ReadonlySet<string>>(() => new Set());

  const download = useCallback(
    async (invoice: Pick<SalesInvoiceRow, 'id' | 'si_number'>) => {
      const pendingSet = (pending.current ??= new Set<string>());
      if (pendingSet.has(invoice.id)) return;
      pendingSet.add(invoice.id);
      setInFlightIds(new Set(pendingSet));
      // The toast API has no persistent option (ToastProvider auto-dismisses each toast on a fixed
      // timer), so this preparing toast may expire while a slow download runs: the DISABLED row
      // item is the in-flight signal, and the outcome toast below replaces this one when it lands.
      toast(t('financeCopy.invoicePdf.preparing', 'Preparing PDF…'), undefined, 'info');
      try {
        const pdf = await repositories.revenue.downloadInvoicePdf(invoice.id);
        const name = safePdfFilename(invoice.si_number ?? '');
        triggerBlobDownload(pdf, name);
        toast(t('financeCopy.invoicePdf.downloaded', 'PDF downloaded — {{name}}', { name }), undefined, 'success');
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        const copy = typeof code === 'string' && Object.hasOwn(FAILURE_COPY, code) ? FAILURE_COPY[code] : unreachableCopy;
        toast(t('financeCopy.invoicePdf.failed', "Couldn't download the PDF"), copy(t, realRole === 'Admin'), 'warning');
        if (typeof code === 'string' && STALE_LIST_CODES.has(code)) {
          void qc.invalidateQueries({ queryKey: ['salesInvoices'] });
        }
      } finally {
        pendingSet.delete(invoice.id);
        setInFlightIds(new Set(pendingSet));
      }
    },
    [t, toast, qc, realRole],
  );

  return { download, inFlightIds };
}
