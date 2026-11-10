import type { TFunction } from 'i18next';
import { canAttributeInvoice } from '@/src/lib/invoiceProjectAssignment';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { RowMenuItem } from '@/src/components/ui';

type MayFn = ReturnType<typeof import('@/src/auth/usePermission').usePermission>;

export interface InvoiceRowMenuDeps {
  t: TFunction;
  may: MayFn;
  /** The PDF download helper (in-flight ids + download). */
  pdfDownload: { inFlightIds: ReadonlySet<string>; download: (inv: SalesInvoiceRow) => Promise<void> };
  native: boolean;
  odooOffline: boolean;
  canCancel: boolean;
  canRecordReceipt: boolean;
  canRecordEfaktur: boolean;
  canApproveDraft: (inv: SalesInvoiceRow) => boolean;
  openRecord: (id: string) => void;
  setProjectTarget: (inv: SalesInvoiceRow) => void;
  setReceiptTarget: (inv: SalesInvoiceRow) => void;
  setEfakturTarget: (inv: SalesInvoiceRow) => void;
  setCancelTarget: (inv: SalesInvoiceRow) => void;
  setSubmitTarget: (inv: SalesInvoiceRow) => void;
}

/** The receivables row menu — verbatim from the list page, as a builder over its gates. */
export function buildInvoiceRowMenu(deps: InvoiceRowMenuDeps) {
  const {
    t, may, pdfDownload, native, odooOffline, canCancel, canRecordReceipt, canRecordEfaktur,
    canApproveDraft, openRecord, setProjectTarget, setReceiptTarget, setEfakturTarget, setCancelTarget, setSubmitTarget,
  } = deps;
  return (inv: SalesInvoiceRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [{
      label: t('financeCopy.viewInvoice', 'View invoice'),
      onClick: () => openRecord(inv.id),
    }];
    // #784 AC-NAR-004 (DD-NAR-11): a PMO invoice from before the ERP took revenue over is history — no approve or cancel.
    const frozen = Boolean(inv.pmo_native) && !native;
    // #912 (OD-INV-PDF-1, AC-PDF-003): the ERP's own PDF of a submitted invoice — what the client receives.
    // `can()` is UX only; external-invoice-pdf re-checks role, tenancy and the LIVE ERP docstatus.
    // AC-PDF-011: while THIS invoice's download runs, the item disables itself under the busy
    // label — a repeat click is impossible, not silent.
    if (may('download_pdf', 'salesInvoice', { record: { status: inv.status, erp_docstatus: inv.erp_docstatus } }))
      items.push({
        label: pdfDownload.inFlightIds.has(inv.id)
          ? t('financeCopy.invoicePdf.preparing', 'Preparing PDF…')
          : t('financeCopy.invoicePdf.download', 'Download PDF'),
        disabled: pdfDownload.inFlightIds.has(inv.id),
        onClick: () => void pdfDownload.download(inv),
      });
    if (may('assign_project', 'salesInvoice') && canAttributeInvoice(inv)) {
      items.push({
        label: inv.project_id
          ? t('invoiceProject.change', 'Change project')
          : t('invoiceProject.assign', 'Assign project'),
        onClick: () => setProjectTarget(inv),
      });
    } else if (may('assign_project', 'salesInvoice') && inv.project_id) {
      // #1471 FR-004: a native or PMO-authored linked invoice keeps its project; only its billing kind is correctable.
      items.push({ label: t('finance:billingKind.change', 'Change billing kind'), onClick: () => setProjectTarget(inv) });
    }
    // #767 AC-DUE-001: receipt is learned after submission, so this is offered in any non-cancelled
    // state to the revenue write set (the RPC enforces it; `can()` is UX only).
    // M-7: not on a Draft — the client cannot have received an invoice that has not been issued.
    // #784 (DD-NAR-11): not on a frozen row — once an ERP owns revenue, a PMO invoice's fields are
    // the ERP's history; `set_sales_invoice_received_date` refuses it server-side too.
    if (canRecordReceipt && !frozen && inv.status !== 'Cancelled' && inv.status !== 'Draft')
      items.push({ label: t('financeCopy.recordReceivedDate', "Record received date"), onClick: () => setReceiptTarget(inv) });
    // FIN-S3: a Draft has no issued tax invoice yet, so there is nothing to record.
    // An e-Faktur is a VAT document: a sale outside VAT (project not subject to VAT) has none to record (AC-OCI-081).
    // A zero-rated invoice on a VAT-subject project still needs one, so tax_amount 0 does not hide it.
    if (canRecordEfaktur && inv.project_subject_to_vat !== false && inv.status !== 'Cancelled' && inv.status !== 'Draft')
      items.push({ label: t('efaktur.record', 'Record e-Faktur'), onClick: () => setEfakturTarget(inv) });
    // A Paid PMO invoice is not cancellable (FR-NAR-009); an ERP one follows the ERP.
    if (!odooOffline && canCancel && !frozen && inv.status !== 'Cancelled' && !(inv.pmo_native && inv.status === 'Paid'))
      items.push({ label: t('financeCopy.cancel', "Cancel"), onClick: () => setCancelTarget(inv), danger: true });
    // Submit action: only for DRAFT status, gated by submit_sales_invoice permission with record
    // context (SoD). The oracle is the APPEND-ONLY author SET (`sales_invoice_authors`, migration
    // 0113) union the legacy scalar — the same one `submit_sales_invoice` enforces. Passing only the
    // last-writer-wins scalar showed an EARLIER body writer an enabled "Submit" that 403'd on click
    // (round-6 re-audit NIT 1). `can()` also fails closed on an unattributable invoice, so the
    // separate author-not-null guard is no longer needed here.
    // #784: a PMO Draft is APPROVED in PMO by a second person (DD-NAR-5) — the same predicate.
    if (
      !odooOffline && !frozen
      && canApproveDraft(inv)
    ) {
      items.push({
        label: inv.pmo_native ? t('financeCopy.approve', 'Approve') : t('financeCopy.submit', "Submit"),
        onClick: () => inv.pmo_native ? openRecord(inv.id) : setSubmitTarget(inv),
      });
    }
    return items;
  };
}
