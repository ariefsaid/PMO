/** Procurement case and phase-file repository contracts. */
import type { CommandIntent } from './commandIntent';
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import type { ProcurementWithRefs, ProjectCommittedSpend, ProjectReservedSpend } from '@/src/lib/db/procurements';
import type {
  ProcurementDetail,
  ProcurementStatus,
  ProcurementReceiptRow,
  ProcurementInvoiceRow,
  CreateInvoiceInput,
  CaptureVendorInvoiceInput,
} from '@/src/lib/db/procurementLifecycle';
import type { PurchaseRequestRow, RfqRow, PurchaseOrderRow, PaymentRow } from '@/src/lib/db/procurementRecords';
import type {
  NewProcurementInput,
  AtomicProcurementInput,
  ProcurementHeaderPatch,
  ProcurementItemInput,
  ProcurementItemPatch,
  ProcurementItemRow,
  ProcurementDocumentInput,
  ProcurementDocumentRow,
  DocumentTarget,
} from '@/src/lib/db/procurementCrud';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { ProcPhase, ProcurementFileRow } from '@/src/lib/db/procurementFiles';

/**
 * The lean `list()` row: exactly the columns the default select returns (the row, the project / vendor /
 * requester name embeds, the SQL open commitment and the attached approval route). The wider embeds
 * (`pr_refs`, `status_events`, …) exist only when `list` is called with options.
 */
export type ProcurementListRow = Omit<ProcurementWithRefs, 'project' | 'pr_refs' | 'po_refs' | 'vi_refs' | 'status_events'
  | 'purchase_requests' | 'purchase_orders' | 'receipts' | 'procurement_invoices' | 'payments'> & {
  project: { name: string; short_name?: string | null; code: string | null } | null;
};

export interface ProcurementListOptions {
  withRefs?: boolean;
  withSharedDetails?: boolean;
}

export interface ProcurementRepository {
  itemValuesEditable(id: string): Promise<boolean>;
  list(): Promise<ProcurementListRow[]>;
  list(opts?: ProcurementListOptions): Promise<ProcurementWithRefs[]>;
  /** One project's procurements (refs + approval routes), filtered server-side. */
  listByProject(projectId: string): Promise<ProcurementWithRefs[]>;
  /** The SQL open-commitment position for one project (ADR-0093). */
  getProjectCommittedSpend(projectId: string): Promise<ProjectCommittedSpend>;
  /** Approved-but-not-yet-ordered demand for one project (ADR-0034). */
  getProjectReservedSpend(projectId: string): Promise<ProjectReservedSpend>;
  /**
   * Atomic vendor-invoice capture (transition + invoice + status event in one RPC). It is a case-aggregate
   * write — PMO-derived even on an externally-owned org (FR-ENA-101/073) — so it never routes external.
   */
  captureVendorInvoice(input: CaptureVendorInvoiceInput): Promise<ProcurementInvoiceRow>;
  listByVendor(vendorId: string): Promise<ProcurementWithRefs[]>;
  get(id: string): Promise<ProcurementDetail>;
  transition(id: string, to: ProcurementStatus, notes?: string): Promise<void>;
  createQuotation(
    procurementId: string,
    vendorId: string,
    totalAmount: number,
    receivedDate: string,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
  ): Promise<Tables<'procurement_quotations'>>;
  createReceipt(
    procurementId: string,
    status: 'Partial' | 'Complete',
    receiptDate: string,
    // task FIX-1 (Discover CRITICAL 1): optional so pre-existing 3-arg call sites/tests keep their
    // exact byte-for-byte shape; the supplier reference number is only forwarded on the PMO-owned
    // direct-DAL path — when externally-owned it is mirrored FROM the ERP doc (FR-ENA-114), never
    // sent as part of the outbound create body.
    referenceNumber?: string | null,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
  ): Promise<ProcurementReceiptRow>;
  /**
   * #505: a SINGLE object param, not the old positional list. `taxTreatment`/`taxAmount` are
   * REQUIRED members of `CreateInvoiceInput`, mirroring the NOT NULL columns 0196 added — a caller
   * that omits either fails to compile instead of failing at the RPC with P0001. Positional was no
   * longer expressible: TypeScript forbids a required parameter after an optional one.
   *
   * The supplier's `referenceNumber` and `invoiceDate` are forwarded to externally-owned invoices.
   * `amount` remains ERP-computed (`grand_total`, FR-ENA-115). Tax facts are ERP-owned on that path
   * and are not forwarded; the ERP's tax template determines them.
   */
  createInvoice(
    input: CreateInvoiceInput,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
  ): Promise<ProcurementInvoiceRow>;
  /** DD-EFK-1: edit the PMO-owned vendor e-Faktur facts through the guarded setter RPC. */
  setEfaktur(invoiceId: string, values: { efakturNumber: string | null; efakturDate: string | null }): Promise<void>;
  // ── CRUD slice (editing paths) ──
  /** Raise a new PR (Draft); requester stamped from the caller's identity. */
  create(input: NewProcurementInput, requestedById: string): Promise<Tables<'procurements'>>;
  createWithItems(input: AtomicProcurementInput): Promise<Tables<'procurements'>>;
  /** Edit the PR header (requester while Draft/Rejected; RLS is the authority). */
  updateHeader(id: string, patch: ProcurementHeaderPatch): Promise<void>;
  /** Set only vendor_id on a vendor-less request; RLS decides eligible roles/stages. */
  updateVendor(id: string, vendorId: string): Promise<void>;
  /** Add a line item (Draft-gated by RLS). */
  createItem(procurementId: string, input: ProcurementItemInput): Promise<ProcurementItemRow>;
  /** Edit a line item (Draft-gated by RLS). */
  updateItem(id: string, patch: ProcurementItemPatch): Promise<void>;
  /** Remove a line item (Draft-gated by RLS). */
  deleteItem(id: string): Promise<void>;
  /** Select a quotation (sets is_selected + syncs header + advances stage; RPC). */
  selectQuote(quotationId: string): Promise<void>;
  /** Raise the approved amount of a request awaiting payment to its billed amount (approve_procurement_amount).
   *  The server decides eligibility from the approval route and refuses the requester, the quote
   *  selector and the bill recorder; the approver of the higher amount may not pay it. */
  approveAmount(id: string, amount: number): Promise<void>;
  /** List the document-metadata register for a PR. */
  listDocuments(procurementId: string): Promise<ProcurementDocumentRow[]>;
  /** Add a document-metadata row (file upload deferred). */
  createDocument(
    procurementId: string,
    input: ProcurementDocumentInput,
  ): Promise<ProcurementDocumentRow>;
  createMicrosoftDocument(
    procurementId: string,
    reference: MicrosoftReferenceInput,
    metadata?: { referenceNumber?: string | null; date?: string | null },
    target?: DocumentTarget,
  ): Promise<ProcurementDocumentRow>;
  linkMicrosoftDocument(id: string, reference: MicrosoftReferenceInput): Promise<void>;
  unlinkMicrosoftDocument(id: string): Promise<void>;
  /** Clear a legacy plain link only (no Microsoft source); other metadata is retained. */
  clearDocumentLink(id: string): Promise<void>;
  /** Remove a document-metadata row. */
  deleteDocument(id: string): Promise<void>;
  // ── New ERP-canonical record creators (Slice 5.4) ──
  /** Create a purchase-request record via RPC (mints PR#). referenceNumber bounded at form layer. */
  createPurchaseRequest(
    procurementId: string,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
    /** #769: optional parent-group number (`external_ref`). PMO-owned path only — never forwarded to the ERP. */
    externalRef?: string | null,
  ): Promise<PurchaseRequestRow>;
  /** Create an RFQ record via RPC (mints RFQ#). */
  createRfq(
    procurementId: string,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
  ): Promise<RfqRow>;
  /** Create a purchase-order record via RPC (mints PO#). */
  createPurchaseOrder(
    procurementId: string,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
    /** #769: optional parent-group number (`external_ref`). PMO-owned path only — never forwarded to the ERP. */
    externalRef?: string | null,
  ): Promise<PurchaseOrderRow>;
  /** Create a payment record via RPC (mints PAY#). invoiceId is nullable (FR-PR-004b). */
  createPayment(
    procurementId: string,
    invoiceId: string | null,
    referenceNumber: string | null,
    status: string | null,
    date: string | null,
    amount: number | null,
    /** BLOCK 2: the per-INTENT command identity — pass the SAME value on every retry (see CommandIntent). */
    intent?: CommandIntent,
  ): Promise<PaymentRow>;
}

export interface ProcurementFileRepository {
  /** Non-archived files for a phase parent (quotation/receipt/invoice), newest first. */
  list(phase: ProcPhase, parentId: string): Promise<ProcurementFileRow[]>;
  /**
   * Prepare a signed upload URL + a minted file path (DAL validates the extension).
   * org_id is fetched server-side from the procurement row — never passed by the caller
   * (ADR-0017 seam; matches the documents.ts pattern).
   */
  prepareUpload(
    phase: ProcPhase,
    procurementId: string,
    fileName: string,
  ): Promise<{ signedUrl: string; path: string; fileId: string }>;
  /** Confirm an upload by inserting the child file row (org_id stamped by RLS). */
  confirmUpload(
    phase: ProcPhase,
    parentId: string,
    path: string,
    title: string | null,
    uploadedById: string | null,
  ): Promise<ProcurementFileRow>;
  /** Record a file the custody upload stored in SharePoint as a phase attachment (no `file_path`). */
  confirmMicrosoftUpload(
    phase: ProcPhase,
    parentId: string,
    reference: MicrosoftReferenceInput,
    title: string | null,
    uploadedById: string | null,
  ): Promise<ProcurementFileRow>;
  /** Soft-archive a file (stamps archived_at; ADR-0018). */
  archive(phase: ProcPhase, id: string): Promise<void>;
  /** Generate a signed download URL for a file. `opts.download` forces attachment; `opts.expiresIn` shortens the link. */
  getSignedUrl(filePath: string, opts?: { download?: boolean; expiresIn?: number }): Promise<string>;
  /** Delete a storage object (non-fatal orphan cleanup). */
  cleanupObject(filePath: string): Promise<void>;
}
