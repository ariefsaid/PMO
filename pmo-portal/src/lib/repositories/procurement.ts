/** Procurement case and phase-file repository implementations, including the externally-owned record creators. */
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  listProcurements,
  listProcurementsByVendor,
  listProcurementsByProject,
  getProjectCommittedSpend,
  getProjectReservedSpend,
} from '@/src/lib/db/procurements';
import { approveProcurementAmount } from '@/src/lib/db/procurementPaymentCeiling';
import {
  createPurchaseRequest,
  createRfq,
  createPurchaseOrder,
  createPayment,
  type PurchaseRequestRow,
  type RfqRow,
  type PurchaseOrderRow,
  type PaymentRow,
} from '@/src/lib/db/procurementRecords';
import {
  getProcurementDetail,
  transitionProcurement,
  createQuotation,
  createReceipt,
  createInvoice,
  captureVendorInvoice,
  setProcurementInvoiceEfaktur,
  type ProcurementReceiptRow,
  type ProcurementInvoiceRow,
} from '@/src/lib/db/procurementLifecycle';
import type { Tables } from '@/src/lib/supabase/database.types';
import {
  createProcurement,
  createProcurementWithItems,
  updateProcurementHeader,
  updateProcurementVendor,
  createProcurementItem,
  updateProcurementItem,
  procurementItemValuesEditable,
  deleteProcurementItem,
  selectProcurementQuote,
  listProcurementDocuments,
  createProcurementDocument,
  createMicrosoftProcurementDocument,
  linkMicrosoftProcurementDocument,
  unlinkMicrosoftProcurementDocument,
  clearProcurementDocumentLink,
  deleteProcurementDocument,
} from '@/src/lib/db/procurementCrud';
import {
  listProcurementFiles,
  prepareUpload as prepareProcurementFileUpload,
  confirmUpload as confirmProcurementFileUpload,
  confirmMicrosoftUpload as confirmProcurementMicrosoftUpload,
  archiveProcurementFile,
  getSignedDownloadUrl as getProcurementFileSignedUrl,
  cleanupStorageObject as cleanupProcurementFileObject,
} from '@/src/lib/db/procurementFiles';
import { wrap } from './repositoryErrors';
import { dispatchCreate } from './repositoryDispatch';
import type { ProcurementFileRepository, ProcurementListOptions, ProcurementRepository } from './contracts/procurement';

export const procurementRepository: ProcurementRepository = {
  itemValuesEditable: (id) => wrap(() => procurementItemValuesEditable(id)),
  // Options are forwarded only when supplied, so a bare call keeps its exact zero-arg DAL shape.
  list: ((opts?: ProcurementListOptions) => wrap(() => (opts ? listProcurements(opts) : listProcurements()))) as ProcurementRepository['list'],
  listByProject: (projectId) => wrap(() => listProcurementsByProject(projectId)),
  getProjectCommittedSpend: (projectId) => wrap(() => getProjectCommittedSpend(projectId)),
  getProjectReservedSpend: (projectId) => wrap(() => getProjectReservedSpend(projectId)),
  captureVendorInvoice: (input) => wrap(() => captureVendorInvoice(input)),
  listByVendor: (vendorId) => wrap(() => listProcurementsByVendor(vendorId)),
  get: (id) => wrap(() => getProcurementDetail(id)),
  // Task 4.9 (finding-3 path fix): the case-AGGREGATE status transition is PMO-derived, never an ERP
  // command (`to` is a PMO `ProcurementStatus` like 'Approved' — the erpnext adapter has no concept of
  // it, FR-ENA-101/073). This ALWAYS stays on the direct DAL path, even when `procurement` is
  // externally-owned — unlike every other method below, it carries no routeDomainWrite guard at all.
  transition: (id, to, notes) => wrap(() => transitionProcurement(id, to, notes)),
  createQuotation: (procurementId, vendorId, totalAmount, receivedDate, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, vendorId, totalAmount, receivedDate, erp_doc_kind: 'quotation' },
          intent,
        ).then((res) => res.canonical as unknown as Tables<'procurement_quotations'>)
      : wrap(() => createQuotation(procurementId, vendorId, totalAmount, receivedDate)),
  // task FIX-1: referenceNumber is a PMO-direct-DAL-only param (see types.ts) — appended to the DAL
  // call ONLY when the caller actually supplied one, so a bare 3-arg call keeps its exact pre-existing
  // shape (index.test.ts's byte-for-byte assertion). Never forwarded on the external-dispatch payload
  // (FR-ENA-114 — it is mirrored back from the ERP doc, not client-supplied at creation).
  createReceipt: (procurementId, status, receiptDate, referenceNumber, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, status, receiptDate, erp_doc_kind: 'goods-receipt' },
          intent,
        ).then((res) => res.canonical as unknown as ProcurementReceiptRow)
      : wrap(() =>
          referenceNumber !== undefined
            ? createReceipt(procurementId, status, receiptDate, referenceNumber)
            : createReceipt(procurementId, status, receiptDate),
        ),
  // #505: ONE object param (see ProcurementRepository.createInvoice). The old `referenceNumber !==
  // undefined || amount !== undefined` arity dance is gone with the positional signature — the DAL
  // now receives the caller's input verbatim, so an absent optional stays absent by construction.
  createInvoice: (input, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          {
            procurementId: input.procurementId,
            status: input.status,
            invoiceDate: input.invoiceDate,
            referenceNumber: input.referenceNumber,
            // ⛔ #505 — THE TAX FACTS ARE DELIBERATELY NOT FORWARDED, and this is a correction of
            // what an earlier round of this change did. They WERE sent here, with a comment claiming
            // it stopped the flipped-org path "recording an amount with no marker". Nothing consumed
            // them: `piToBody` sends `{supplier, items}` only, so the round trip was user states
            // *exclusive / 11,000* → ERPNext receives no taxes → `grand_total` = net → the mirror
            // writes `amount` = net with `tax_treatment = 'inclusive'`. Internally consistent,
            // confidently wrong, unrecoverable — this issue's own defect, on the other branch of the
            // same `if`.
            //
            // On a flipped org the ERP computes the tax from its own template and OWNS the answer;
            // `upsertInvoiceMirror` writes 'inclusive' as a fact about the grand_total it just set.
            // So the form does not ask (see `taxIsPmoAuthored`), and nothing else is forwarded.
            //
            // #520: the ONE tax input this path takes is the ERPNext Purchase Taxes and Charges
            // Template the user chose — and it IS consumed: the dispatch validates it against the
            // ERP company, resolves its rows server-side and sends them (`resolvePurchaseTaxRows`).
            // No choice → nothing sent, and ERPNext applies its own default.
            ...(input.taxTemplate?.trim() ? { taxTemplate: input.taxTemplate.trim() } : {}),
            // #876 slice 2 (DD-VWH-13/14) — or the VAT / PPh AMOUNTS the user entered. The dispatch turns them into fixed
            // ERPNext rows on the org's tax accounts and refuses a command carrying both a template and amounts. The
            // native tax facts above (and a standalone `withheldAmount` / `withheldPphType`) stay unforwarded.
            ...(input.erpTaxAmounts
              ? { vatAmount: input.erpTaxAmounts.vatAmount, withheldAmount: input.erpTaxAmounts.withheldAmount, pphType: input.erpTaxAmounts.pphType }
              : {}),
            erp_doc_kind: 'purchase-invoice',
          },
          intent,
        ).then((res) => res.canonical as unknown as ProcurementInvoiceRow)
      : wrap(() => createInvoice(input)),
  // DD-EFK-1: e-Faktur facts are PMO-owned, so this setter always stays direct even for external ERP domains.
  setEfaktur: (invoiceId, values) => wrap(() => setProcurementInvoiceEfaktur(invoiceId, values.efakturNumber, values.efakturDate)),
  create: (input, requestedById) => wrap(() => createProcurement(input, requestedById)),
  createWithItems: (input) => wrap(() => createProcurementWithItems(input)),
  updateHeader: (id, patch) => wrap(() => updateProcurementHeader(id, patch)),
  updateVendor: (id, vendorId) => wrap(() => updateProcurementVendor(id, vendorId)),
  createItem: (procurementId, input) => wrap(() => createProcurementItem(procurementId, input)),
  updateItem: (id, patch) => wrap(() => updateProcurementItem(id, patch)),
  deleteItem: (id) => wrap(() => deleteProcurementItem(id)),
  selectQuote: (quotationId) => wrap(() => selectProcurementQuote(quotationId)),
  // 0349: approve the billed amount when it exceeds the approved amount (server enforces eligibility + SoD).
  approveAmount: (id, amount) => wrap(() => approveProcurementAmount(id, amount)),
  listDocuments: (procurementId) => wrap(() => listProcurementDocuments(procurementId)),
  createDocument: (procurementId, input) =>
    wrap(() => createProcurementDocument(procurementId, input)),
  createMicrosoftDocument: (procurementId, reference, metadata, target) =>
    wrap(() => createMicrosoftProcurementDocument(procurementId, reference, metadata, target)),
  linkMicrosoftDocument: (id, reference) => wrap(() => linkMicrosoftProcurementDocument(id, reference)),
  unlinkMicrosoftDocument: (id) => wrap(() => unlinkMicrosoftProcurementDocument(id)),
  clearDocumentLink: (id) => wrap(() => clearProcurementDocumentLink(id)),
  deleteDocument: (id) => wrap(() => deleteProcurementDocument(id)),
  // ── New ERP-canonical record creators (Slice 5.4; P2 routes them per-domain, task 1.10) ──
  createPurchaseRequest: (procurementId, referenceNumber, status, date, amount, intent, externalRef) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, referenceNumber, status, date, amount, erp_doc_kind: 'purchase-request' },
          intent,
        ).then((res) => res.canonical as unknown as PurchaseRequestRow)
      : wrap(() =>
          externalRef
            ? createPurchaseRequest(procurementId, referenceNumber, status, date, amount, undefined, undefined, undefined, externalRef)
            : createPurchaseRequest(procurementId, referenceNumber, status, date, amount),
        ),
  createRfq: (procurementId, referenceNumber, status, date, amount, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, referenceNumber, status, date, amount, erp_doc_kind: 'rfq' },
          intent,
        ).then((res) => res.canonical as unknown as RfqRow)
      : wrap(() => createRfq(procurementId, referenceNumber, status, date, amount)),
  createPurchaseOrder: (procurementId, referenceNumber, status, date, amount, intent, externalRef) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, referenceNumber, status, date, amount, erp_doc_kind: 'purchase-order' },
          intent,
        ).then((res) => res.canonical as unknown as PurchaseOrderRow)
      : wrap(() =>
          externalRef
            ? createPurchaseOrder(procurementId, referenceNumber, status, date, amount, undefined, undefined, undefined, externalRef)
            : createPurchaseOrder(procurementId, referenceNumber, status, date, amount),
        ),
  // DD-VPAY-1 (#910, AC-VPAY-005): the seam is where the camelCase form input becomes the ERP wire
  // record — the same place the revenue twin does it. The external wire record carries EXACTLY
  // `{ procurementId, invoiceId, paid_amount, date, erp_doc_kind: 'payment' }` (+ the BLOCK-2 intent
  // as the command identity): `amount` → `paid_amount` (the body builder reads paid_amount), and
  // `referenceNumber`/`status` are dropped — the PE's docstatus is the only status truth (DD-VPAY-8)
  // and PMO's "External ref" never reaches ERPNext (OQ-VPAY-4, the reference_no anchor carries the
  // idempotency key). The native route below stays byte-for-byte.
  createPayment: (procurementId, invoiceId, referenceNumber, status, date, amount, intent) =>
    routeDomainWrite('procurement') === 'external'
      ? dispatchCreate(
          'procurement',
          { procurementId, invoiceId, paid_amount: amount, date, erp_doc_kind: 'payment' },
          intent,
        ).then((res) => res.canonical as unknown as PaymentRow)
      : wrap(() => createPayment(procurementId, invoiceId, referenceNumber, status, date, amount)),
};

export const procurementFilesRepository: ProcurementFileRepository = {
  list: (phase, parentId) => wrap(() => listProcurementFiles(phase, parentId)),
  prepareUpload: (phase, procurementId, fileName) =>
    wrap(() => prepareProcurementFileUpload(phase, procurementId, fileName)),
  confirmUpload: (phase, parentId, path, title, uploadedById) =>
    wrap(() => confirmProcurementFileUpload(phase, parentId, path, title, uploadedById)),
  confirmMicrosoftUpload: (phase, parentId, reference, title, uploadedById) =>
    wrap(() => confirmProcurementMicrosoftUpload(phase, parentId, reference, title, uploadedById)),
  archive: (phase, id) => wrap(() => archiveProcurementFile(phase, id)),
  getSignedUrl: (filePath, opts) => wrap(() => getProcurementFileSignedUrl(filePath, opts)),
  cleanupObject: (filePath) => wrap(() => cleanupProcurementFileObject(filePath)),
};
