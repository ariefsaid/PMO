/** Revenue (sales invoices / incoming payments) repository contract. */
import type { CommandIntent } from './commandIntent';
import type { SalesInvoiceRow, IncomingPaymentRow, RevenueByProjectRow } from '@/src/lib/db/revenue';
import type { ProjectFinances } from '@/src/lib/projectFinances';
import type { PageParams } from '@/src/lib/pagination';
import type { BillingKind } from '@/src/lib/billingKind';

export interface RevenueRepository {
  /** Create a Sales Invoice (Draft) — mints a PMO id, dispatches when revenue is externally-owned. The number is null
   *  for a PMO Draft (#784 DD-NAR-9 mints it on approval). */
  createInvoice(input: {
    customerId: string;
    projectId?: string | null;
    items: Array<{ item_code: string; qty: number; rate: number; description?: string }>;
    /** OD-BILL-1: the work order this invoice bills ("Invoice this work order"). */
    workOrderId?: string | null;
    /** #1471: how the project attribution counts; omitted = Contract billing. PMO metadata, never an ERP field. */
    billingKind?: BillingKind;
  }, intent?: CommandIntent): Promise<{ id: string; si_number: string | null }>;
  /** Create an Incoming Payment — mints a PMO id, dispatches when revenue is externally-owned. The number is null for a
   *  PMO receipt (#784: the RPC returns only the id; the list read carries its PMO number). */
  createPayment(input: {
    customerId: string;
    salesInvoiceId?: string | null;
    paidAmount: number;
    receivedAmount?: number;
    withheldAmount?: number;
    withholdingSlipNumber?: string | null;
    date: string;
  }, intent?: CommandIntent): Promise<{ id: string; ip_number: string | null }>;
  /** #767: record/clear the date the client received the invoice (Admin/Finance, RPC-enforced). */
  setReceivedDate(siId: string, receivedDate: string | null): Promise<void>;
  /** DD-EFK-1: edit the PMO-owned sales e-Faktur facts through the guarded setter RPC. */
  setEfaktur(siId: string, values: { efakturNumber: string | null; efakturDate: string | null }): Promise<void>;
  /** Submit a Sales Invoice (docstatus 0→1) — SoD-gated at RPC layer (slice 3). */
  submitInvoice(siId: string, intent?: CommandIntent): Promise<void>;
  /** Cancel a Sales Invoice (docstatus 1→2) — mirrors ERP cancel. */
  cancelInvoice(siId: string, intent?: CommandIntent): Promise<void>;
  /** #912: the ERP's own print-format PDF of a SUBMITTED, ERP-owned invoice (Admin/Finance; the edge
   *  function `external-invoice-pdf` enforces role, tenancy and docstatus). */
  downloadInvoicePdf(siId: string): Promise<Blob>;
  /** Cancel an Incoming Payment (docstatus 1→2) — mirrors ERP cancel. */
  cancelPayment(ipId: string, intent?: CommandIntent): Promise<void>;
  /** List sales invoices in the caller's org (RLS scopes org). */
  listInvoices(params?: { projectId?: string; status?: SalesInvoiceRow['status']; nativeOnly?: boolean } & PageParams): Promise<SalesInvoiceRow[]>;
  /** Get a single sales invoice by id. */
  getInvoice(id: string): Promise<SalesInvoiceRow | null>;
  /** List incoming payments in the caller's org (RLS scopes org). */
  listPayments(params?: { customerId?: string; salesInvoiceId?: string } & PageParams): Promise<IncomingPaymentRow[]>;
  /** Get a single incoming payment by id. */
  getPayment(id: string): Promise<IncomingPaymentRow | null>;
  /** Revenue rollup per project — SUM(amount) grouped by project_id. */
  getRevenueByProject(): Promise<RevenueByProjectRow[]>;
  /** PMO attribution for an existing adopted invoice; does not dispatch an ERP write. */
  setProject(siId: string, projectId: string, billingKind?: BillingKind): Promise<void>;
  /** #1471 FR-004: PMO-only billing-kind correction of an already-linked invoice; does not dispatch an ERP write. */
  setBillingKind(siId: string, billingKind: BillingKind): Promise<void>;
  /** Checked project-scoped finance payload from the invoker read RPC. */
  getProjectFinances(projectId: string): Promise<ProjectFinances>;
  /** Server-authoritative, caller-org ERP ledger basis signal. */
  getOrgReadsErpLedger(): Promise<boolean>;

}
