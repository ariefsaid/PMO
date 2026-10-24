type T = (key: string, fallback: string) => string;

/** FR-PFE-023 refusal codes → plain sentences (finance namespace). Unknown text (the SoD guard, other server sentences) passes through. */
export function erpLinkReasonText(reason: string | null, t: T): string {
  switch (reason) {
    case null:
    case '':
      return t('finance:erpLinks.reason.unknown', 'This document could not be linked.');
    case 'erp_name_missing': return t('finance:erpLinks.reason.nameMissing', 'The ERPNext document number is missing.');
    case 'invalid_id': return t('finance:erpLinks.reason.invalidId', 'The purchase or project could not be read. Refresh and try again.');
    case 'document_not_found': return t('finance:erpLinks.reason.notFound', 'This ERPNext document is not in PMO yet. Wait for the next sync.');
    case 'document_ambiguous': return t('finance:erpLinks.reason.ambiguous', 'Several ERPNext documents have this number. Add the document type.');
    case 'document_cancelled': return t('finance:erpLinks.reason.cancelled', 'This document is cancelled in ERPNext.');
    case 'document_recorded_by_pmo': return t('finance:erpLinks.reason.pmoOwned', 'PMO created this document; it is already on its purchase.');
    case 'document_linked_to_another_purchase': return t('finance:erpLinks.reason.linkedElsewhere', 'This document already belongs to another purchase.');
    case 'purchase_not_found': return t('finance:erpLinks.reason.purchaseNotFound', 'Purchase not found.');
    case 'purchase_closed': return t('finance:erpLinks.reason.purchaseClosed', 'This purchase is cancelled or rejected.');
    case 'project_not_found': return t('finance:erpLinks.reason.projectNotFound', 'Project not found.');
    case 'supplier_mismatch': return t('finance:erpLinks.reason.supplier', 'The supplier differs from this purchase’s supplier.');
    case 'project_mismatch': return t('finance:erpLinks.reason.project', 'This document is recorded against other projects. Open one of its projects to add it there.');
    case 'currency_mismatch': return t('finance:erpLinks.reason.currency', 'The document’s currency differs from this purchase.');
    case 'gate_request_before_order': return t('finance:erpLinks.reason.gateRequest', 'Your organization requires a purchase request before an order.');
    case 'gate_approval_before_order': return t('finance:erpLinks.reason.gateApprovalOrder', 'Your organization requires an approval before an order.');
    case 'gate_receipt_before_invoice': return t('finance:erpLinks.reason.gateReceipt', 'Your organization requires a goods receipt before a vendor invoice.');
    case 'gate_approval_before_payment': return t('finance:erpLinks.reason.gateApprovalPayment', 'Your organization requires an approval before payment.');
    case 'document_spans_projects': return t('finance:erpLinks.reason.spansProjects', 'This invoice is recorded against several projects. Link it from ERPNext per project, or record it in PMO.');
    case 'sharepoint_host_not_allowed': return t('finance:erpLinks.reason.sharepointHost', 'The file is not on your organization’s SharePoint site.');
    case 'm365_not_configured': return t('finance:erpLinks.reason.m365NotConfigured', 'Choose your organization’s default SharePoint library first.');
    default: return reason;
  }
}

/** The four ERPNext purchase document types in plain words (FR-PFE-040: receipts and payments join orders and invoices). */
export function erpDoctypeLabel(t: T, doctype: string): string {
  switch (doctype) {
    case 'Purchase Order': return t('finance:erpPurchases.type.order', 'Purchase order');
    case 'Purchase Receipt': return t('finance:erpPurchases.type.receipt', 'Goods receipt');
    case 'Purchase Invoice': return t('finance:erpPurchases.type.invoice', 'Supplier invoice');
    case 'Payment Entry': return t('finance:erpPurchases.type.payment', 'Supplier payment');
    default: return doctype;
  }
}

/**
 * Decision 3 (#1319 review): the amount PMO shows for an ERPNext document is its PRE-TAX total — the basis open commitment
 * uses. A Payment Entry has no pre-tax total; its paid amount is its total (FR-PFE-040). Unknown stays unknown (null), never 0.
 */
export function erpPreTaxAmount(r: { doctype: string; netTotal: number | null; grandTotal: number | null }): number | null {
  if (r.netTotal !== null) return r.netTotal;
  return r.doctype === 'Payment Entry' ? r.grandTotal : null;
}
