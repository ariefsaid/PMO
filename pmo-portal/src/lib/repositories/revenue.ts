/** Revenue repository implementation: native vs externally-owned routing, SoD-ordered transitions, ERP invoice PDF. */
import { salesInvoiceCreateFields } from '@/src/lib/adapterSeam/erpnext/salesInvoiceCommand';
import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';
import { invokeWithTimeout } from '@/src/lib/supabase/invokeWithTimeout';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import {
  listSalesInvoices,
  getSalesInvoice,
  listIncomingPayments,
  getIncomingPayment,
  getRevenueByProject,
  submitSalesInvoiceSod,
  setSalesInvoiceReceivedDate,
  setSalesInvoiceEfaktur,
  setSalesInvoiceProject,
  setSalesInvoiceBillingKind,
  getProjectFinances,
  getOrgReadsErpLedger,
  proposeInvoicePairs,
  acceptInvoicePairs,
  unpairInvoice,
  listUnpairedNativeInvoices,
  listAcceptedInvoicePairs,
} from '@/src/lib/db/revenue';
import {
  nativeReadOnly,
  createNativeInvoice,
  createNativePayment,
  approveNativeInvoice,
  cancelNativeInvoice,
  cancelNativePayment,
} from './revenueNative';
import { wrap, throwInvokeError } from './repositoryErrors';
import { keyFor, dispatchCreate } from './repositoryDispatch';
import type { RevenueRepository } from './contracts/revenue';

/** #912: the edge function makes two ERP calls bounded at 20 s each; leave room for both. */
const INVOICE_PDF_INVOKE_TIMEOUT_MS = 45_000;

export const revenueRepository: RevenueRepository = {
  // Read methods (ADR-0017)
  listInvoices: (params) => wrap(() => listSalesInvoices(params)),
  getInvoice: (id) => wrap(() => getSalesInvoice(id)),
  listPayments: (params) => wrap(() => listIncomingPayments(params)),
  getPayment: (id) => wrap(() => getIncomingPayment(id)),
  getRevenueByProject: () => wrap(() => getRevenueByProject()),
  setProject: (siId, projectId, billingKind) =>
    wrap(() => (billingKind === undefined ? setSalesInvoiceProject(siId, projectId) : setSalesInvoiceProject(siId, projectId, billingKind))),
  setBillingKind: (siId, billingKind) => wrap(() => setSalesInvoiceBillingKind(siId, billingKind)),
  getProjectFinances: (projectId) => wrap(() => getProjectFinances(projectId)),
  getOrgReadsErpLedger: () => wrap(() => getOrgReadsErpLedger()),
  proposeInvoicePairs: () => wrap(() => proposeInvoicePairs()),
  acceptInvoicePairs: (pairs) => wrap(() => acceptInvoicePairs(pairs)),
  unpairInvoice: (pmoInvoiceId) => wrap(() => unpairInvoice(pmoInvoiceId)),
  listUnpairedNativeInvoices: () => wrap(() => listUnpairedNativeInvoices()),
  listAcceptedInvoicePairs: () => wrap(() => listAcceptedInvoicePairs()),
  // Write methods — route through dispatch when externally-owned
  createInvoice: (input, intent) =>
    routeDomainWrite('revenue') === 'external'
      ? dispatchCreate('revenue', salesInvoiceCreateFields(input), intent)
          .then((res) => ({ id: String(res.canonical.id), si_number: String(res.canonical.si_number ?? '') }))
      : createNativeInvoice(input),
  createPayment: (input, intent) =>
    routeDomainWrite('revenue') === 'external'
      ? dispatchCreate(
          'revenue',
          // Luna BLOCK 5 (MONEY-CRITICAL): map the camelCase input to the snake_case command record the
          // dispatch/body (peReceiveToBody reads paid_amount/received_amount/references) AND the recovery
          // composite-probe payload all read. references[] is resolved downstream by resolveRevenueRefs
          // (the resolved SI ERP name + allocated_amount) — the repo only knows the PMO salesInvoiceId.
          {
            erp_doc_kind: 'incoming-payment',
            customerId: input.customerId,
            salesInvoiceId: input.salesInvoiceId ?? null,
            paid_amount: input.paidAmount,
            received_amount: input.receivedAmount ?? input.paidAmount,
            ...(input.withheldAmount !== undefined ? { withheld_amount: input.withheldAmount } : {}),
            ...(input.withholdingSlipNumber !== undefined ? { withholding_slip_number: input.withholdingSlipNumber } : {}),
            date: input.date,
          },
          intent,
        ).then((res) => ({ id: String(res.canonical.id), ip_number: String(res.canonical.ip_number ?? '') }))
      : createNativePayment(input),
  setReceivedDate: (siId, receivedDate) => wrap(() => setSalesInvoiceReceivedDate(siId, receivedDate)),
  // DD-EFK-1: PMO-owned e-Faktur update never routes to ERPNext or creates an outbox command.
  setEfaktur: (siId, values) => wrap(() => setSalesInvoiceEfaktur(siId, values.efakturNumber, values.efakturDate)),
  submitInvoice: (siId, intent) =>
    routeDomainWrite('revenue') === 'external'
      ? wrap(async () => {
          // #784 AC-NAR-004: a PMO invoice is history once the ERP owns revenue — refused before the SoD check runs.
          const si = await getSalesInvoice(siId);
          if (si?.pmo_native) throw nativeReadOnly();
          await submitSalesInvoiceSod(siId);   // SoD: server-enforced approver≠author (42501 on self-approval) BEFORE any ERP submit
          if (!si || !si.si_number) throw new AppError('sales invoice not found or missing si_number', 'not-found');
          await dispatchDomainCommand(
            'revenue',
            'transition',
            { id: siId, erp_doc_kind: 'sales-invoice', verb: 'submit', externalRecordId: si.si_number },
            keyFor(intent),
          );
        })
      // #784 (FR-NAR-005): approve in PMO.
      : approveNativeInvoice(siId),
  cancelInvoice: (siId, intent) =>
    routeDomainWrite('revenue') === 'external'
      ? wrap(async () => {
          const si = await getSalesInvoice(siId);
          if (si?.pmo_native) throw nativeReadOnly();
          if (!si || !si.si_number) throw new AppError('sales invoice not found or missing si_number', 'not-found');
          await dispatchDomainCommand(
            'revenue',
            'transition',
            { id: siId, erp_doc_kind: 'sales-invoice', verb: 'cancel', externalRecordId: si.si_number },
            keyFor(intent),
          );
        })
      : cancelNativeInvoice(siId),
  downloadInvoicePdf: (siId) =>
    wrap(async () => {
      const { data, error } = await invokeWithTimeout(
        supabase.functions.invoke<Blob>('external-invoice-pdf', { body: { salesInvoiceId: siId } }),
        INVOICE_PDF_INVOKE_TIMEOUT_MS,
      );
      if (error) await throwInvokeError(error);
      if (!(data instanceof Blob)) throw new AppError('The ERP did not return a PDF', 'ERP_UNREACHABLE');
      return data;
    }),
  cancelPayment: (ipId, intent) =>
    routeDomainWrite('revenue') === 'external'
      ? wrap(async () => {
          const ip = await getIncomingPayment(ipId);
          if (ip?.pmo_native) throw nativeReadOnly();
          if (!ip || !ip.ip_number) throw new AppError('incoming payment not found or missing ip_number', 'not-found');
          await dispatchDomainCommand(
            'revenue',
            'transition',
            { id: ipId, erp_doc_kind: 'incoming-payment', verb: 'cancel', externalRecordId: ip.ip_number },
            keyFor(intent),
          );
        })
      : cancelNativePayment(ipId),
};
