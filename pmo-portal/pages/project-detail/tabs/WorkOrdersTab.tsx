import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Button,
  ConfirmDialog,
  GateNotice,
  ListState,
  StatusPill,
  useToast,
  type StatusVariant,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency, formatCurrencyCents, formatNumberExact, currencySymbol } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  isOverCommitmentRefusal,
  type WorkOrderRow,
  type WorkOrderStatus,
} from '@/src/lib/db/workOrders';
import { useProjectWorkOrders, useWorkOrderMutations } from '@/src/hooks/useWorkOrders';
import WorkOrderFormModal from '../WorkOrderFormModal';
import WorkOrderValueModal from '../WorkOrderValueModal';
import InvoiceWorkOrderModal from '../InvoiceWorkOrderModal';
import { useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { useBoqItems, useProgressBillingMutations, useProjectBilling, useProjectClaims } from '@/src/hooks/useProgressBilling';
import { useDocuments } from '@/src/hooks/useDocuments';
import {
  useWorkOrderAcceptanceMutations, useWorkOrderAcceptances, useProjectWorkOrderLines,
} from '@/src/hooks/useWorkOrderAcceptances';
import type { WorkOrderAcceptanceWithLines, WorkOrderLineRow } from '@/src/lib/db/workOrderAcceptances';
import WorkOrderLinesModal from '../WorkOrderLinesModal';
import WorkOrderAcceptanceModal from '../WorkOrderAcceptanceModal';
import WorkOrderAcceptances from '../WorkOrderAcceptances';
import ProgressClaimModal from '../ProgressClaimModal';
import ClaimEvidenceModal from '../ClaimEvidenceModal';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { ProgressClaimWithInvoice } from '@/src/lib/db/progressBilling';
import { claimNet, summarizeBilling } from '@/src/lib/progressBilling';
import { summarizeInvoiceSettlement } from '../ContractCascade';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { useRevenueRouteReady } from '@/src/hooks/useOwnershipCacheSync';
import { canInvoiceWorkOrder } from '@/src/lib/workOrderBilling';

/**
 * The work-order surface for one project (#566) — the client's inbound POs and the drawdown they
 * make against the project's committed ceiling (OD-WO-2 / OD-CR-13).
 *
 * ⚑ NOTHING HERE WRITES ON A SINGLE CLICK, and for the status moves that is more than the house
 * rule: `Issued`, `Closed` and `Cancelled` are one-way. `Closed` and `Cancelled` are TERMINAL, and
 * an issued work order's whole body freezes (DD-WO-5) because `issued_at` is the stamp a later ERP
 * push derives its idempotency key from. There is no undo to fall back on, so each one asks first.
 *
 * ⚑ THE OVER-COMMITMENT PATH IS SERVER-LED AND NEVER AUTO-RETRIED. Issuing goes out with NO
 * acknowledgement. If the total would breach the ceiling the RPC refuses and names the figures; we
 * put THAT sentence in front of the user and offer a second, separately-confirmed action that
 * sends the acknowledgement. Re-sending automatically would turn a stamp that means "a person
 * looked at an over-commitment and chose it" into a checkbox the client always ticks — the exact
 * degradation `DD-WO-10` refuses on the server side.
 */

export interface WorkOrdersTabProps {
  projectId: string;
  /** The project's currency. Work orders are pinned to it by a trigger, so they never disagree. */
  currency: string;
  /** The project's client — the invoice customer (OD-BILL-1). No client, no "Invoice" button. */
  clientId?: string | null;
  /** A work order to bring into view on arrival (`?wo=` from a dashboard link): highlighted, scrolled to, focused. */
  focusWorkOrderId?: string | null;
  /** Decides who may prepare a BAST (the project's own PM or Finance rank). */
  projectManagerId?: string | null;
  /** Standalone legacy surface may explain partial-payment timing; ContractCascade owns the note on its page. */
  showSettlementNote?: boolean;
}

type InvoiceWithWorkOrder = SalesInvoiceRow & { work_order_id?: string | null };

/** `YYYY-MM-DD` in the browser's zone — only the BAST date dialog's default. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const ROLE_RANK: Record<string, number> = {
  Engineer: 10,
  'Project Manager': 20,
  Finance: 30,
  Executive: 40,
  Admin: 50,
};

/** A pending status move awaiting its confirm. */
interface PendingTransition {
  row: WorkOrderRow;
  to: WorkOrderStatus;
}

const WorkOrdersTab: React.FC<WorkOrdersTabProps> = ({ projectId, currency, clientId = null, focusWorkOrderId = null, projectManagerId = null, showSettlementNote = true }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const { data, isPending, isError, refetch } = useProjectWorkOrders(projectId);
  const { create, update, setValue, transition } = useWorkOrderMutations(projectId);

  // `undefined` = closed · `null` = create a draft · a row = edit that draft's body.
  const [formFor, setFormFor] = useState<WorkOrderRow | null | undefined>(undefined);
  const [valueFor, setValueFor] = useState<WorkOrderRow | null>(null);
  const [pending, setPending] = useState<PendingTransition | null>(null);
  /** The server's own over-ceiling refusal, held until the user answers it. */
  const [overCommit, setOverCommit] = useState<{ row: WorkOrderRow; message: string } | null>(null);

  const rows = useMemo(() => data ?? [], [data]);
  const prefix = currencySymbol(currency);

  // ── ADR-0091: contract lines (allocations) and BAST per work order. One project-scoped read of each, grouped
  //    here — never one query per row. Every write persists alone; nothing is closed optimistically.
  const boq = useBoqItems(projectId);
  const projectBilling = useProjectBilling(projectId);
  const lines = useProjectWorkOrderLines(projectId);
  const acceptancesQuery = useWorkOrderAcceptances(projectId);
  const documents = useDocuments(projectId);
  const quantityMutations = useWorkOrderAcceptanceMutations(projectId);
  const billingMutations = useProgressBillingMutations(projectId);
  const claimsQuery = useProjectClaims(projectId);
  const boqRows = useMemo(() => boq.data ?? [], [boq.data]);
  const claimRows = claimsQuery.data ?? [];
  const summary = projectBilling.data ? summarizeBilling(projectBilling.data) : null;
  const allocationsByWo = useMemo(() => {
    const grouped = new Map<string, WorkOrderLineRow[]>();
    for (const row of lines.data ?? []) grouped.set(row.work_order_id, [...(grouped.get(row.work_order_id) ?? []), row]);
    return grouped;
  }, [lines.data]);
  const acceptancesByWo = useMemo(() => {
    const grouped = new Map<string, WorkOrderAcceptanceWithLines[]>();
    for (const row of acceptancesQuery.data ?? []) grouped.set(row.work_order_id, [...(grouped.get(row.work_order_id) ?? []), row]);
    return grouped;
  }, [acceptancesQuery.data]);
  const [linesFor, setLinesFor] = useState<WorkOrderRow | null>(null);
  const [bastFor, setBastFor] = useState<{ row: WorkOrderRow; draft: WorkOrderAcceptanceWithLines | null } | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<WorkOrderAcceptanceWithLines | null>(null);
  const [confirmFor, setConfirmFor] = useState<{ acceptance: WorkOrderAcceptanceWithLines; error: string | null } | null>(null);
  /** The down payment still held after a final BAST closed an order (FR-CQ-012) — persistent until reload. */
  const [dpHeldAfterClose, setDpHeldAfterClose] = useState<number | null>(null);
  const showQuantities = boqRows.length > 0 || (lines.data ?? []).length > 0;
  // Close is replaced by the final BAST for any work order that has contract lines (DD-CQ-9); while the
  // allocations are unknown it is withheld rather than guessed.
  const closeByBast = (id: string): boolean => lines.isPending || lines.isError || allocationsByWo.has(id);
  const dpNotice = dpHeldAfterClose ?? (
    projectBilling.data && projectBilling.data.dpBilled - projectBilling.data.dpRecovered > 0
      && rows.some((r) => r.status === 'Closed' && (acceptancesByWo.get(r.id) ?? []).some((a) => a.status === 'Confirmed' && a.is_final))
      ? projectBilling.data.dpBilled - projectBilling.data.dpRecovered : null
  );

  // ── OD-BILL-1 (#913): billing by work order. Read = the revenue read set; Invoice = the invoice-create authority
  //    (Admin/Finance — the same `can()` the native create's RPC enforces) with a client to invoice, in EITHER revenue
  //    mode: the dialog branches its copy and the repository routes the write. Require the synced repository route to
  //    agree with `useRevenueMode` before exposing the action. UX only — the database refuses
  //    past-the-value invoices before any write (0262), ERP or native.
  const revenueMode = useRevenueMode();
  const revenueRouteReady = useRevenueRouteReady(revenueMode);
  const canViewBilling = may('view', 'salesInvoice');
  const canInvoice = may('create', 'salesInvoice') && revenueRouteReady && Boolean(clientId);
  const erp = useErpItemOptions('sales');
  const invoicesQuery = useSalesInvoices(projectId, { enabled: canViewBilling });
  const invoiceRows = useMemo(() => (invoicesQuery.data ?? []) as InvoiceWithWorkOrder[], [invoicesQuery.data]);
  const invoicesByWo = useMemo(() => {
    const grouped = new Map<string, InvoiceWithWorkOrder[]>();
    for (const invoice of invoiceRows) {
      if (!invoice.work_order_id) continue;
      grouped.set(invoice.work_order_id, [...(grouped.get(invoice.work_order_id) ?? []), invoice]);
    }
    return grouped;
  }, [invoiceRows]);
  const billing = useWorkOrderBilling(projectId, canViewBilling);
  const billingById = useMemo(
    () => new Map((billing.data ?? []).map((b) => [b.workOrderId, b] as const)),
    [billing.data],
  );
  const [invoiceFor, setInvoiceFor] = useState<{ row: WorkOrderRow; remaining: number } | null>(null);
  const [createdInvoice, setCreatedInvoice] = useState<{ id: string; native: boolean } | null>(null);
  const [claimFor, setClaimFor] = useState<WorkOrderRow | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [raiseFor, setRaiseFor] = useState<{ claim: ProgressClaimWithInvoice; idempotencyKey: string } | null>(null);
  const [withdrawClaimFor, setWithdrawClaimFor] = useState<ProgressClaimWithInvoice | null>(null);
  const claimScopeReady = !lines.isPending && !lines.isError;
  const canBill = may('create', 'progressClaim') && erp.connected && Boolean(clientId) && claimScopeReady && Boolean(summary);
  const liveDownPayment = claimRows.some((claim) => claim.kind === 'down_payment' && !claim.withdrawn_at && claim.invoice?.status !== 'Cancelled');

  // ── Arriving from a dashboard link (`?wo=`): bring that work order into view once its row exists.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!focusWorkOrderId || focusedOnce.current || !rows.some((r) => r.id === focusWorkOrderId)) return;
    const anchor = document.querySelector<HTMLElement>(`[data-wo-anchor="${CSS.escape(focusWorkOrderId)}"]`);
    if (!anchor) return;
    focusedOnce.current = true;
    anchor.scrollIntoView({ block: 'center' });
    anchor.focus({ preventScroll: true });
  }, [focusWorkOrderId, rows]);

  const treatmentLabel = (treatment: string): string => treatment === 'inclusive'
    ? t('projectDetail.workOrders.tax.inclusive', 'incl. PPN')
    : t('projectDetail.workOrders.tax.exclusive', 'excl. PPN');

  const basisNote = (row: WorkOrderRow): string => {
    const numerator = row.tax_base_numerator ?? 1;
    const denominator = row.tax_base_denominator ?? 1;
    if (row.tax_rate != null && numerator === denominator) return treatmentLabel(row.tax_treatment);
    return `${treatmentLabel(row.tax_treatment)}${row.tax_rate != null ? `\u00a0${row.tax_rate}%` : ` · ${t('tax.details.unknownRate', 'rate not recorded')}`} · DPP\u00a0${numerator}/${denominator}`;
  };
  const valueWithBasis = (row: WorkOrderRow): string => `${formatCurrency(row.order_value, row.currency)} ${basisNote(row)}`;

  const fail = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  const runCreate = async (input: Parameters<typeof create.mutateAsync>[0]['input']) => {
    await create.mutateAsync({ input });
    toast(t('projectDetail.workOrders.toast.created', 'Draft work order created'), input.title, 'success');
    setFormFor(undefined);
  };

  const runUpdate = async (id: string, patch: Parameters<typeof update.mutateAsync>[0]['patch']) => {
    await update.mutateAsync({ id, patch });
    toast(t('projectDetail.workOrders.toast.updated', 'Work order updated'), patch.title, 'success');
    setFormFor(undefined);
  };

  const runSetValue = async (input: Parameters<typeof setValue.mutateAsync>[0]) => {
    await setValue.mutateAsync(input);
    toast(t('projectDetail.workOrders.toast.valueSet', 'Work order value set'), formatCurrency(input.value, currency), 'success');
    setValueFor(null);
  };

  /** The confirmed status move. An over-ceiling refusal is re-offered; it is never retried automatically. */
  const runTransition = async ({ row, to }: PendingTransition) => {
    try {
      await transition.mutateAsync({ id: row.id, to });
      toast(t('projectDetail.workOrders.toast.transitioned', 'Work order updated'), row.title, 'success');
      setPending(null);
    } catch (err) {
      setPending(null);
      if (to === 'Issued' && isOverCommitmentRefusal(err)) {
        setOverCommit({ row, message: err instanceof Error ? err.message : '' });
        return;
      }
      fail(err);
    }
  };

  const runAcknowledgedIssue = async (row: WorkOrderRow) => {
    try {
      await transition.mutateAsync({ id: row.id, to: 'Issued', overCommitAck: true });
      toast(t('projectDetail.workOrders.toast.issuedOverCeiling', 'Work order issued over the ceiling'), t('projectDetail.workOrders.toast.issuedOverCeilingSub', 'Your acknowledgement is recorded against this work order.'), 'success');
    } catch (err) {
      fail(err);
    } finally {
      setOverCommit(null);
    }
  };

  const runPrepare = async (input: Omit<Parameters<typeof quantityMutations.prepare.mutateAsync>[0], 'workOrderId'>) => {
    if (!bastFor) return;
    await quantityMutations.prepare.mutateAsync({ ...input, workOrderId: bastFor.row.id });
    toast(
      bastFor.draft
        ? t('projectTabs:contractQuantities.workOrders.acceptances.toast.updated', 'BAST draft updated')
        : t('projectTabs:contractQuantities.workOrders.acceptances.toast.prepared', 'BAST prepared'),
      t('projectTabs:contractQuantities.workOrders.acceptances.toast.preparedSub', 'Someone else confirms it before it counts.'),
      'success',
    );
    setBastFor(null);
  };

  const runWithdrawBast = async () => {
    if (!withdrawFor) return;
    try {
      await quantityMutations.withdraw.mutateAsync(withdrawFor.id);
      toast(t('projectTabs:contractQuantities.workOrders.acceptances.toast.withdrawn', 'BAST withdrawn'), undefined, 'success');
    } catch (err) {
      fail(err);
    } finally {
      setWithdrawFor(null);
    }
  };

  const runConfirmBast = async () => {
    if (!confirmFor) return;
    try {
      const result = await quantityMutations.confirm.mutateAsync(confirmFor.acceptance.id);
      if (confirmFor.acceptance.is_final && result && result.dpHeld > 0) setDpHeldAfterClose(result.dpHeld);
      toast(
        result && result.closingValue !== null
          ? t('projectTabs:contractQuantities.workOrders.acceptances.toast.closed', 'Final BAST confirmed — closed at {{amount}}', { amount: formatCurrency(result.closingValue, currency), interpolation: { escapeValue: false } })
          : t('projectTabs:contractQuantities.workOrders.acceptances.toast.confirmed', 'BAST confirmed'),
        undefined,
        'success',
      );
      setConfirmFor(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
      setConfirmFor({ acceptance: confirmFor.acceptance, error: detail ? `${headline} ${detail}` : headline });
    }
  };

  const failClaim = (err: unknown, overrides?: Record<string, string>) => {
    const { headline, detail } = classifyMutationError(err, overrides);
    toast(headline, detail, 'warning');
  };

  const saveClaim = async (input: Omit<import('@/src/lib/db/progressBilling').ProgressClaimInput, 'projectId'>) => {
    const id = await billingMutations.createClaim.mutateAsync(input);
    toast(t('projectDetail.billing.claims.toast.created', 'Billing claim created'), undefined, 'success');
    setClaimFor(null);
    if (typeof id === 'string') setEvidenceFor(id);
  };

  const attachEvidence = async (documentId: string) => {
    if (!evidenceFor) return;
    try {
      await billingMutations.attachEvidence.mutateAsync({ claimId: evidenceFor, documentId });
      toast(t('projectDetail.billing.claims.toast.evidenceAttached', 'Evidence attached'), undefined, 'success');
      setEvidenceFor(null);
    } catch (err) {
      failClaim(err);
    }
  };

  const runRaiseClaimInvoice = async () => {
    if (!raiseFor || !clientId) return;
    try {
      await billingMutations.raiseInvoice.mutateAsync({
        claimId: raiseFor.claim.id,
        customerId: clientId,
        intent: { id: raiseFor.claim.id, idempotencyKey: raiseFor.idempotencyKey },
      });
      toast(t('projectDetail.billing.claims.toast.raised', 'Invoice raised in the ERP'), undefined, 'success');
    } catch (err) {
      failClaim(err, {
        '55000': t('projectDetail.billing.claims.errors.claimWithdrawn', "This claim was withdrawn — its invoice can't be raised."),
      });
    } finally {
      setRaiseFor(null);
    }
  };

  const runWithdrawClaim = async () => {
    if (!withdrawClaimFor) return;
    try {
      await billingMutations.withdrawClaim.mutateAsync(withdrawClaimFor.id);
      toast(t('projectDetail.billing.claims.toast.withdrawn', 'Claim withdrawn'), undefined, 'success');
    } catch (err) {
      failClaim(err);
    } finally {
      setWithdrawClaimFor(null);
    }
  };

  const confirmCopy = (p: PendingTransition) => {
    if (p.to === 'Issued') {
      return {
        title: t('projectDetail.workOrders.confirm.issue.title', 'Issue this work order?'),
        description: t(
          'projectDetail.workOrders.confirm.issue.body',
          'It gets our WO number, starts drawing down the project’s contract, and its content is frozen from then on. Amending an issued work order means cancelling it and raising a replacement.',
        ),
        confirmLabel: t('projectDetail.workOrders.confirm.issue.confirm', 'Issue work order'),
        tone: 'default' as const,
      };
    }
    if (p.to === 'Closed') {
      return {
        title: t('projectDetail.workOrders.confirm.close.title', 'Close this work order?'),
        description: t(
          'projectDetail.workOrders.confirm.close.body',
          'Closing is final. The value stays in the drawdown — closed work orders count as committed, exactly as issued ones do.',
        ),
        confirmLabel: t('projectDetail.workOrders.confirm.close.confirm', 'Close work order'),
        tone: 'default' as const,
      };
    }
    return {
      title: t('projectDetail.workOrders.confirm.cancel.title', 'Cancel this work order?'),
      description: t(
        'projectDetail.workOrders.confirm.cancel.body',
        'Cancelling is final and cannot be undone — it is how a work order is withdrawn, since there is no delete. Its value stops counting towards the drawdown.',
      ),
      confirmLabel: t('projectDetail.workOrders.confirm.cancel.confirm', 'Cancel work order'),
      tone: 'destructive' as const,
    };
  };

  const liveOrders = rows.filter((row) => row.status === 'Issued' || row.status === 'Closed')
    .sort((a, b) => (a.wo_number ?? '').localeCompare(b.wo_number ?? ''));
  const draftOrders = rows.filter((row) => row.status === 'Draft')
    .sort((a, b) => (a.wo_number ?? a.title).localeCompare(b.wo_number ?? b.title));
  const submittedInvoices = invoiceRows.filter((invoice) => invoice.status !== 'Draft' && invoice.status !== 'Cancelled');
  const partialBalanceUnknown = submittedInvoices.some((invoice) => invoice.amount === null || invoice.erp_outstanding_amount === null);
  const invoiceById = new Map(invoiceRows.map((invoice) => [invoice.id, invoice]));
  const lineReadsPending = boq.isPending || projectBilling.isPending || lines.isPending;
  const lineReadsFailed = boq.isError || projectBilling.isError || lines.isError;
  const invoiceReadReady = !canViewBilling || (!invoicesQuery.isPending && !invoicesQuery.isError);

  return (
    <div className="space-y-8">
      {canViewBilling && invoicesQuery.isError && !claimRows.some((claim) => Boolean(claim.work_order_id)) && (
        <ListState variant="error" title={t('projectDetail.cascade.invoiceError', "Couldn't load invoices")} onRetry={() => void invoicesQuery.refetch()} />
      )}
      {dpNotice !== null && (
        <div role="status" data-testid="wo-dp-held-notice" className="border-b border-border pb-3 text-[13px] text-muted-foreground">
          {t('projectTabs:contractQuantities.workOrders.closing.dpHeld',
            '{{amount}} of the down payment is still held after closing. Finance should recover the rest with the next progress claim, or refund it explicitly — closing does not clear it.',
            { amount: formatCurrency(dpNotice, currency), interpolation: { escapeValue: false } })}
        </div>
      )}

      {canViewBilling && createdInvoice && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <p className="text-sm text-muted-foreground">
            {createdInvoice.native
              ? t('projectDetail.workOrders.billing.draftHandoffNative', 'Draft created. A different Finance or Admin user must approve it.')
              : t('projectDetail.workOrders.billing.draftHandoffErp', 'Draft created. A different Finance or Admin user must submit it.')}
          </p>
          <Link className="inline-flex min-h-8 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/sales-invoices/${encodeURIComponent(createdInvoice.id)}`}>
            {t('projectDetail.workOrders.billing.openDraft', 'Open draft')}
          </Link>
        </div>
      )}

      <section aria-labelledby="pd-customer-orders" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <h2 id="pd-customer-orders" className="text-sm font-semibold text-foreground">
            {t('projectDetail.contract.orders', 'Customer orders')}
          </h2>
          {may('create', 'workOrder') && (
            <Button variant="outline" size="sm" onClick={() => setFormFor(null)}>
              {t('projectDetail.workOrders.action.newCustomerOrder', 'New customer order')}
            </Button>
          )}
        </div>

        {isPending ? (
          <ListState variant="loading" rows={4} />
        ) : isError ? (
          <ListState
            variant="error"
            title={t('projectDetail.workOrders.error.title', 'Couldn’t load the work orders')}
            sub={t('projectDetail.workOrders.error.sub', 'The client’s purchase orders for this project could not be read. Retry, or reopen the project.')}
            onRetry={() => refetch()}
          />
        ) : (
          <>
            {!showQuantities && liveOrders.length === 0 && draftOrders.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">
                {t('projectDetail.contract.empty', 'No contract lines or customer orders yet.')}
              </p>
            )}
            {showQuantities && liveOrders.length === 0 && draftOrders.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">
                {t('projectDetail.contract.noOrders', 'No customer orders yet.')}
              </p>
            )}

            {draftOrders.length > 0 && (
              <section aria-labelledby="pd-draft-orders" className="mb-6">
                <h3 id="pd-draft-orders" className="mb-2 text-xs font-medium text-muted-foreground">
                  {t('projectDetail.workOrders.drafts', 'Draft orders')}
                </h3>
                <ul className="divide-y divide-border/70">
                  {draftOrders.map((row) => {
                    const canEdit = may('edit', 'workOrder', { record: { status: row.status } });
                    const canSetValue = may('setValue', 'workOrder', { record: { status: row.status } });
                    const canTransition = may('transition', 'workOrder');
                    const author = row.value_author;
                    const issuerRole = currentUser?.role ?? '';
                    const authorIsSelf = row.order_value_set_by === currentUser?.id;
                    const authorRelationshipFails = authorIsSelf || !author || author.status !== 'active' || !currentUser?.id
                      || !(author.manager_id === currentUser.id || (ROLE_RANK[author.role] ?? 0) > (ROLE_RANK[issuerRole] ?? 0));
                    const issueBlocked = Number(row.order_value ?? 0) > 0 && !['Finance', 'Executive', 'Admin'].includes(issuerRole)
                      && (!row.order_value_set_at || authorRelationshipFails);
                    const issueGateBody = !row.order_value_set_at
                      ? t('projectDetail.workOrders.issueGate.unstampedBody', 'The value must be set by an authorized reviewer before this order can be issued.')
                      : authorIsSelf
                        ? t('projectDetail.workOrders.issueGate.body', 'You set its value. Ask another authorized reviewer to review and issue it.')
                        : t('projectDetail.workOrders.issueGate.peerBody', 'The value must be set by your supervisor or a more senior active reviewer before it can be issued.');
                    return (
                      <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                        <div className="min-w-0">
                          <span className="font-medium text-foreground">{row.wo_number ?? row.title}</span>
                          {row.wo_number && <span className="ml-2 text-sm text-muted-foreground">{row.title}</span>}
                          {row.client_po_number && <span className="ml-3 text-xs text-muted-foreground">{t('projectDetail.workOrders.clientPo', 'Client PO')} {row.client_po_number}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {canEdit && <Button variant="ghost" size="sm" onClick={() => setFormFor(row)}>{t('projectDetail.workOrders.action.editOrder', 'Edit order')}</Button>}
                          {canSetValue && <Button variant="ghost" size="sm" onClick={() => setValueFor(row)}>{t('projectDetail.workOrders.action.setValue', 'Set value')}</Button>}
                          {issueBlocked && canTransition ? <GateNotice variant="blocked" className="max-w-sm px-2 py-1.5 text-xs">{issueGateBody}</GateNotice>
                            : canTransition && <Button variant="ghost" size="sm" onClick={() => setPending({ row, to: 'Issued' })}>{t('projectDetail.workOrders.action.issue', 'Issue')}</Button>}
                          {canTransition && <Button variant="ghost" size="sm" className="text-destructive-text" onClick={() => setPending({ row, to: 'Cancelled' })}>{t('projectDetail.workOrders.action.cancel', 'Cancel')}</Button>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {liveOrders.map((row) => {
              const orderAllocations = (projectBilling.data?.contractLines ?? []).flatMap((line) =>
                line.allocations.filter((allocation) => allocation.workOrderId === row.id).map((allocation) => ({ line, allocation })),
              );
              const rawLines = allocationsByWo.get(row.id) ?? [];
              const hasOrderLines = orderAllocations.length > 0 || rawLines.length > 0;
              const orderLineFactsReady = !lineReadsPending && !lineReadsFailed && (!hasOrderLines || Boolean(projectBilling.data));
              const bastList = acceptancesByWo.get(row.id) ?? [];
              const pendingBast = [...bastList].filter((acceptance) => acceptance.status === 'Draft')
                .sort((a, b) => b.prepared_at.localeCompare(a.prepared_at))[0];
              const finalBast = bastList.some((acceptance) => acceptance.status === 'Confirmed' && acceptance.is_final);
              const delivered = row.status === 'Closed' && finalBast;
              const billingRow = billingById.get(row.id);
              const orderInvoices = invoicesByWo.get(row.id) ?? [];
              const settlement = invoiceReadReady ? summarizeInvoiceSettlement(orderInvoices) : null;
              const orderClaims = claimRows.filter((claim) => claim.work_order_id === row.id);
              const claimIds = new Set(orderClaims.map((claim) => claim.id));
              const directInvoices = orderInvoices.filter((invoice) => !claimIds.has(invoice.id));
              const canPrepare = row.status === 'Issued' && rawLines.length > 0
                && may('create', 'workOrderAcceptance', { currentUserId: currentUser?.id, record: { status: row.status, project_manager_id: projectManagerId } });
              const canConfirm = Boolean(pendingBast) && may('confirm', 'workOrderAcceptance', {
                currentUserId: currentUser?.id,
                record: { status: pendingBast?.status, prepared_by: pendingBast?.prepared_by },
              });
              const canEdit = may('edit', 'workOrder', { record: { status: row.status } });
              const canTransition = may('transition', 'workOrder');
              const invoiceForOrder = billingRow && canInvoiceWorkOrder(row.status, billingRow);
              const invoiceTable = canViewBilling && (orderClaims.length > 0 || directInvoices.length > 0);
              const paidText = settlement === null
                ? invoicesQuery.isError
                  ? t('projectDetail.workOrders.billing.unavailable', 'Unavailable')
                  : t('projectDetail.workOrders.billing.loading', 'Loading')
                : formatCurrencyCents(settlement.paid, currency);
              const invoiceAmountText = settlement === null || settlement.invoiced === null
                ? t('projectDetail.workOrders.billing.unavailable', 'Unavailable')
                : formatCurrencyCents(settlement.invoiced, currency);
              const claimDownPayment = orderClaims.find((claim) => claim.kind === 'down_payment' && !claim.withdrawn_at && claim.invoice?.status !== 'Cancelled');
              const orderStatus = delivered
                ? t('projectDetail.cascade.delivered', 'Delivered')
                : t('projectDetail.cascade.inProgress', 'In progress');
              const workOrderStatusTone: StatusVariant = delivered ? 'won' : 'progress';

              return (
                <article key={row.id} data-testid={`customer-order-${row.id}`} className="min-w-0 border-b border-border/70 py-5 first:pt-1">
                  <header className="flex flex-col gap-3">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 data-wo-anchor={row.id} tabIndex={-1}
                        className="rounded-sm text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {row.wo_number ?? t('projectDetail.workOrders.notYetIssued', 'Not issued yet')}
                      </h3>
                      <span className="text-sm text-foreground">{row.title}</span>
                      <StatusPill variant={workOrderStatusTone}>{orderStatus}</StatusPill>
                      {row.client_po_number && <span className="text-xs text-muted-foreground">{t('projectDetail.workOrders.clientPo', 'Client PO')} {row.client_po_number}</span>}
                      <span className="text-xs tabular text-muted-foreground" data-testid={`wo-value-${row.id}`}>
                        {formatCurrency(row.order_value, row.currency)} {basisNote(row)}
                      </span>
                      {row.closing_value != null && <span className="text-xs tabular text-muted-foreground" data-testid={`wo-closing-${row.id}`}>
                        {t('projectTabs:contractQuantities.workOrders.closing.closedAt', 'Closed at {{amount}} (excl. PPN)', { amount: formatCurrency(Number(row.closing_value), row.currency), interpolation: { escapeValue: false } })}
                      </span>}
                      {canViewBilling && (
                        <span className="ml-auto flex flex-wrap items-baseline gap-x-2 text-xs tabular">
                          <span>{t('projectDetail.cascade.invoiced', 'Invoiced')} <b className="text-foreground">{settlement === null ? (invoicesQuery.isError ? t('projectDetail.workOrders.billing.unavailable', 'Unavailable') : t('projectDetail.workOrders.billing.loading', 'Loading')) : billingRow && !billingRow.figuresComplete ? t('projectDetail.workOrders.billing.unavailable', 'Unavailable') : invoiceAmountText}</b></span>
                          <span>{t('projectDetail.cascade.paid', 'Paid')} <b className="text-foreground">{paidText}</b></span>
                          {settlement?.unpaid !== null && settlement?.unpaid !== undefined && settlement.unpaid > 0
                            ? <span className="font-semibold text-destructive-text">{t('projectDetail.cascade.unpaidAmt', '{{amount}} unpaid', { amount: formatCurrencyCents(settlement.unpaid, currency) })}</span>
                            : settlement?.unpaid === null && orderInvoices.length > 0
                              ? <span className="text-muted-foreground">{t('projectDetail.cascade.unpaidUnknown', 'Unpaid balance pending')}</span>
                              : null}
                          {claimDownPayment && <span className="text-muted-foreground">{t('projectDetail.cascade.includingDownPayment', 'incl. down payment {{amount}}', { amount: formatCurrencyCents(Number(claimDownPayment.down_payment_amount ?? claimDownPayment.gross_amount), currency) })}</span>}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {canPrepare && <button type="button" className="min-h-8 text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => setBastFor({ row, draft: null })}>{t('projectDetail.procurement.nextStep.ordered', 'Record delivery')}</button>}
                      {canConfirm && pendingBast && <button type="button" className="min-h-8 text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => setConfirmFor({ acceptance: pendingBast, error: null })}>{t('projectTabs:contractQuantities.workOrders.acceptances.confirmDelivery', 'Confirm delivery')}</button>}
                      {hasOrderLines && summary && canBill && <button type="button" className="min-h-8 text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => setClaimFor(row)}>{t('projectDetail.workOrders.billing.raiseProgressClaim', 'Raise invoice')}</button>}
                      {!hasOrderLines && canInvoice && invoiceForOrder && billingRow && <button type="button" className="min-h-8 text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => { setCreatedInvoice(null); setInvoiceFor({ row, remaining: billingRow.remaining }); }}>{t('projectDetail.workOrders.billing.invoiceAction', 'Raise invoice')}</button>}
                      {canEdit && <button type="button" className="min-h-8 text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => setFormFor(row)}>{t('projectDetail.workOrders.action.editOrder', 'Edit order')}</button>}
                      {row.status === 'Issued' && canTransition && !closeByBast(row.id) && <button type="button" className="min-h-8 text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => setPending({ row, to: 'Closed' })}>{t('projectDetail.workOrders.action.close', 'Close')}</button>}
                      {(row.status === 'Issued' || row.status === 'Draft') && canTransition && <button type="button" className="min-h-8 text-muted-foreground underline underline-offset-4 hover:text-destructive-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => setPending({ row, to: 'Cancelled' })}>{t('projectDetail.workOrders.action.cancel', 'Cancel')}</button>}
                      {hasOrderLines && canInvoice && invoiceForOrder && billingRow && (
                        <details className="relative">
                          <summary className="min-h-8 cursor-pointer py-2 text-muted-foreground underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                            {t('projectDetail.workOrders.action.more', 'More')}
                          </summary>
                          <div className="absolute right-0 z-10 min-w-44 rounded-md border border-border bg-popover p-1 shadow-md">
                            <button type="button" className="w-full px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                              onClick={() => { setCreatedInvoice(null); setInvoiceFor({ row, remaining: billingRow.remaining }); }}>
                              {t('projectDetail.workOrders.billing.invoiceByAmount', 'Invoice by amount')}
                            </button>
                          </div>
                        </details>
                      )}
                    </div>
                  </header>

                  {pendingBast && <p className="mt-2 text-xs text-muted-foreground" role="status">
                    {t('projectDetail.cascade.pendingAcceptance', 'Delivery awaiting confirmation')} · {pendingBast.acceptance_date} · {pendingBast.is_final
                      ? t('projectTabs:contractQuantities.workOrders.acceptances.final', 'Final')
                      : t('projectTabs:contractQuantities.workOrders.acceptances.stage', 'Stage')}
                  </p>}

                  {!orderLineFactsReady ? (
                    lineReadsFailed
                      ? <ListState variant="error" title={t('projectDetail.cascade.error', "Couldn't load the contract")} onRetry={() => { void boq.refetch(); void projectBilling.refetch(); void lines.refetch(); }} />
                      : <ListState variant="loading" rows={3} />
                  ) : hasOrderLines ? (
                    <div className="mt-4 overflow-x-auto rounded-md border border-border" data-testid={`wo-lines-table-scroll-${row.id}`}>
                      <table className="w-full min-w-[46rem] text-sm">
                        <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
                          {[t('projectDetail.cascade.colItem', 'Item'), t('projectDetail.cascade.colUnit', 'Unit'), t('projectDetail.cascade.colOrdered', 'Ordered'), t('projectDetail.cascade.colDelivered', 'Delivered'), t('projectDetail.cascade.colInvoiced', 'Invoiced'), t('projectDetail.cascade.colCanInvoice', 'Can invoice')].map((heading) => (
                            <th key={heading} scope="col" className="px-3 py-2 text-right font-medium first:text-left">{heading}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {orderAllocations.map(({ line, allocation }) => {
                            const item = boqRows.find((boqItem) => boqItem.id === allocation.boqItemId);
                            const deliveredQuantity = allocation.acceptedQuantity;
                            const canInvoiceQuantity = deliveredQuantity === null ? null : Math.max(0, deliveredQuantity - allocation.claimedQuantity);
                            return (
                              <tr key={`${line.boqItemId}-${row.id}`} className="border-t border-border/70">
                                <td className="px-3 py-2"><span className="mr-2 text-xs text-muted-foreground">{item?.item_code ?? ''}</span>{item?.description ?? allocation.boqItemId}</td>
                                <td className="px-3 py-2 text-right text-muted-foreground">{item?.unit ?? ''}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{formatNumberExact(allocation.quantity)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {deliveredQuantity === null ? '—' : <span className={deliveredQuantity < allocation.quantity && allocation.final ? 'text-warning-foreground' : undefined}>
                                    {formatNumberExact(deliveredQuantity)}{deliveredQuantity < allocation.quantity && allocation.final && <span className="ml-1 text-xs">{t('projectDetail.cascade.short', '({{n}} short)', { n: formatNumberExact(allocation.quantity - deliveredQuantity) })}</span>}
                                  </span>}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">{formatNumberExact(allocation.claimedQuantity)}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{canInvoiceQuantity === null ? '—' : formatNumberExact(canInvoiceQuantity)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">{t('projectDetail.cascade.moneyOnly', 'Money-only order')}</p>
                  )}

                  {invoiceTable && (
                    <section className="mt-4" aria-label={t('projectDetail.cascade.claimsHeading', 'Invoices and claims')}>
                      <h4 className="mb-2 text-xs font-medium text-muted-foreground">{t('projectDetail.cascade.claimsHeading', 'Invoices and claims')}</h4>
                      {invoicesQuery.isPending ? <ListState variant="loading" rows={2} /> : invoicesQuery.isError ? (
                        <ListState variant="error" title={t('projectDetail.cascade.invoiceError', "Couldn't load invoices")} onRetry={() => void invoicesQuery.refetch()} />
                      ) : (
                        <div className="overflow-x-auto" data-testid={`wo-invoices-scroll-${row.id}`}>
                          <table className="w-full min-w-[42rem] text-xs">
                            <thead><tr className="border-b border-border text-left text-muted-foreground">
                              {[t('projectDetail.cascade.invoiceNumber', 'Claim / invoice'), t('projectDetail.cascade.invoiceAmount', 'Amount'), t('projectDetail.cascade.invoiceStatus', 'Status'), t('projectDetail.cascade.paid', 'Paid'), t('projectDetail.cascade.invoiceActions', 'Actions')].map((heading) => <th key={heading} scope="col" className="px-2 py-2 font-medium">{heading}</th>)}
                            </tr></thead>
                            <tbody>
                              {orderClaims.map((claim) => {
                                const invoice = invoiceById.get(claim.id);
                                const status = claim.withdrawn_at ? t('projectDetail.billing.claims.withdrawn', 'Withdrawn') : invoice?.status ?? claim.invoice?.status ?? t('projectDetail.billing.claims.notRaised', 'Not raised');
                                const amount = invoice?.amount ?? Number(claim.gross_amount);
                                const paid = invoice ? summarizeInvoiceSettlement([invoice]) : null;
                                const hasInvoice = Boolean(invoice || claim.invoice);
                                const isOpen = !claim.withdrawn_at && !hasInvoice;
                                return (
                                  <tr key={claim.id} className="border-t border-border/70">
                                    <td className="px-2 py-2 font-medium">{invoice?.si_number ?? claim.invoice?.si_number ?? `Claim ${claim.id.slice(0, 8)}`}</td>
                                    <td className="px-2 py-2 tabular-nums">{Number.isFinite(amount) ? formatCurrencyCents(amount, currency) : t('projectDetail.workOrders.billing.unavailable', 'Unavailable')}</td>
                                    <td className="px-2 py-2">{status}</td>
                                    <td className="px-2 py-2 tabular-nums">{!invoice || invoice.status === 'Draft' || invoice.status === 'Cancelled'
                                      ? '—'
                                      : !paid?.balancesKnown && invoice.status !== 'Paid'
                                        ? t('projectDetail.cascade.awaitingBalance', 'Awaiting balance')
                                        : formatCurrencyCents(paid?.paid ?? 0, currency)}</td>
                                    <td className="px-2 py-1.5">
                                      <div className="flex flex-wrap items-center gap-1">
                                        {isOpen && canBill && <Button variant="ghost" size="sm" onClick={() => setEvidenceFor(claim.id)}>{t('projectDetail.billing.claims.attachEvidence', 'Attach evidence')}</Button>}
                                        {isOpen && canBill && claim.evidence.length > 0 && <Button variant="ghost" size="sm" onClick={() => setRaiseFor({ claim, idempotencyKey: crypto.randomUUID() })}>{t('projectDetail.billing.claims.raise', 'Raise invoice')}</Button>}
                                        {isOpen && canBill && claim.evidence.length === 0 && <span className="text-[11px] text-muted-foreground">{t('projectDetail.billing.claims.evidenceNeeded', 'Attach evidence before raising')}</span>}
                                        {isOpen && canBill && <Button variant="ghost" size="sm" className="text-destructive-text" onClick={() => setWithdrawClaimFor(claim)}>{t('projectDetail.billing.claims.withdraw', 'Withdraw')}</Button>}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                              {directInvoices.map((invoice) => {
                                const paid = summarizeInvoiceSettlement([invoice]);
                                return (
                                  <tr key={invoice.id} className="border-t border-border/70">
                                    <td className="px-2 py-2 font-medium">{invoice.si_number ?? t('projectDetail.cascade.invoiceDraft', 'Invoice draft')}</td>
                                    <td className="px-2 py-2 tabular-nums">{invoice.amount === null ? t('projectDetail.workOrders.billing.unavailable', 'Unavailable') : formatCurrencyCents(invoice.amount, currency)}</td>
                                    <td className="px-2 py-2">{invoice.status}</td>
                                    <td className="px-2 py-2 tabular-nums">{invoice.status === 'Draft' || invoice.status === 'Cancelled'
                                      ? '—'
                                      : !paid.balancesKnown && invoice.status !== 'Paid'
                                        ? t('projectDetail.cascade.awaitingBalance', 'Awaiting balance')
                                        : formatCurrencyCents(paid.paid, currency)}</td>
                                    <td className="px-2 py-2">—</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  )}

                  <div className="mt-4 flex flex-col gap-3">
                    {lines.isError && <ListState variant="error" title={t('projectTabs:contractQuantities.workOrders.contractLines.loadError', 'Couldn’t load the contract lines')} onRetry={() => void lines.refetch()} />}
                    {acceptancesQuery.isError && <ListState variant="error" title={t('projectTabs:contractQuantities.workOrders.acceptances.error', 'Couldn’t load the BASTs')} onRetry={() => void acceptancesQuery.refetch()} />}
                    {(hasOrderLines || bastList.length > 0 || canPrepare) && (
                      <details className="group">
                        <summary className="cursor-pointer text-xs text-muted-foreground underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          {t('projectTabs:contractQuantities.workOrders.quantities.summary', 'Contract lines and BAST — {{wo}}', { wo: row.wo_number ?? row.title })}
                          <span className="ml-2">{t('projectTabs:contractQuantities.workOrders.quantities.counts', '{{lines}} lines · {{basts}} BAST', { lines: rawLines.length, basts: bastList.length })}</span>
                        </summary>
                        <div className="mt-3 flex flex-col gap-4">
                          {hasOrderLines && <section aria-label={t('projectTabs:contractQuantities.workOrders.contractLines.heading', 'Contract lines')}>
                            <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.contractLines.heading', 'Contract lines')}</h4>
                            <ul className="flex flex-col gap-0.5 text-xs" data-testid={`wo-lines-${row.id}`}>
                              {rawLines.map((line) => {
                                const item = boqRows.find((boqItem) => boqItem.id === line.boq_item_id);
                                return <li key={line.id} className="tabular">{item ? `${item.item_code} — ${item.description}` : line.boq_item_id} <span className="font-semibold">{formatNumberExact(Number(line.quantity))}{item ? ` ${item.unit}` : ''}</span></li>;
                              })}
                            </ul>
                            {may('create', 'workOrderLine', { record: { status: row.status } }) && <Button variant="ghost" size="sm" className="mt-1 px-0 text-xs text-muted-foreground" onClick={() => setLinesFor(row)}>{t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Edit lines')}</Button>}
                          </section>}
                          <section aria-label={t('projectTabs:contractQuantities.workOrders.acceptances.heading', 'Acceptances (BAST)')}>
                            <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.acceptances.heading', 'Acceptances (BAST)')}</h4>
                            <WorkOrderAcceptances
                              workOrder={row}
                              boqItems={boqRows}
                              documents={documents.data ?? []}
                              acceptances={bastList}
                              state={acceptancesQuery.isError ? 'error' : acceptancesQuery.isPending ? 'loading' : 'ready'}
                              onRetry={() => void acceptancesQuery.refetch()}
                              currentUserId={currentUser?.id ?? null}
                              projectManagerId={projectManagerId}
                              hasAllocations={false}
                              onPrepare={() => setBastFor({ row, draft: null })}
                              onEdit={(acceptance) => setBastFor({ row, draft: acceptance })}
                              onWithdraw={setWithdrawFor}
                              onConfirm={(acceptance) => setConfirmFor({ acceptance, error: null })}
                            />
                          </section>
                        </div>
                      </details>
                    )}
                  </div>
                </article>
              );
            })}
          </>
        )}
      </section>

      {canViewBilling && showSettlementNote && !invoicesQuery.isPending && !invoicesQuery.isError && partialBalanceUnknown && (
        <p className="text-xs text-muted-foreground" role="note">{t('projectDetail.cascade.partialPaymentNote', 'Part payments appear once invoice balances arrive from accounting.')}</p>
      )}

      {formFor !== undefined && (
        <WorkOrderFormModal
          workOrder={formFor}
          currencySymbolPrefix={prefix}
          onClose={() => setFormFor(undefined)}
          onCreate={runCreate}
          onUpdate={runUpdate}
        />
      )}

      {linesFor && (
        <WorkOrderLinesModal
          workOrder={linesFor}
          boqItems={boqRows}
          contractLines={projectBilling.data?.contractLines ?? []}
          allocations={allocationsByWo.get(linesFor.id) ?? []}
          canEdit={may('create', 'workOrderLine', { record: { status: linesFor.status } })}
          onClose={() => setLinesFor(null)}
          onCreate={async (boqItemId, quantity) => { await quantityMutations.createLine.mutateAsync({ workOrderId: linesFor.id, boqItemId, quantity }); }}
          onUpdate={async (id, quantity) => { await quantityMutations.updateLine.mutateAsync({ id, quantity }); }}
          onDelete={async (id) => { await quantityMutations.deleteLine.mutateAsync(id); }}
          onError={fail}
        />
      )}

      {bastFor && (
        <WorkOrderAcceptanceModal
          workOrder={bastFor.row}
          boqItems={boqRows}
          allocations={allocationsByWo.get(bastFor.row.id) ?? []}
          acceptances={acceptancesByWo.get(bastFor.row.id) ?? []}
          documents={documents.data ?? []}
          today={todayIso()}
          draft={bastFor.draft}
          onClose={() => setBastFor(null)}
          onSave={runPrepare}
          onError={fail}
        />
      )}

      {withdrawFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t('projectTabs:contractQuantities.workOrders.acceptances.confirmWithdraw.title', 'Withdraw this BAST draft?')}
          description={t('projectTabs:contractQuantities.workOrders.acceptances.confirmWithdraw.body', 'The draft is withdrawn and cannot be confirmed. Prepare a new BAST if the client still accepts the work.')}
          confirmLabel={t('projectTabs:contractQuantities.workOrders.acceptances.confirmWithdraw.confirm', 'Withdraw BAST')}
          loading={quantityMutations.withdraw.isPending}
          onConfirm={() => void runWithdrawBast()}
          onCancel={() => setWithdrawFor(null)}
        />
      )}

      {confirmFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={confirmFor.acceptance.is_final
            ? t('projectTabs:contractQuantities.workOrders.acceptances.confirmFinal.title', 'Confirm the final BAST?')
            : t('projectTabs:contractQuantities.workOrders.acceptances.confirmStage.title', 'Confirm this BAST?')}
          description={
            <div className="flex flex-col gap-2">
              <p>
                {confirmFor.acceptance.is_final
                  ? t('projectTabs:contractQuantities.workOrders.acceptances.confirmFinal.body', 'Confirming a final BAST closes the work order at the accepted quantities. The client’s PO value stays as recorded; the closing value is kept separately and unused quantity returns to the contract balance. This cannot be undone.')
                  : t('projectTabs:contractQuantities.workOrders.acceptances.confirmStage.body', 'The accepted quantities are recorded as of this BAST. The work order stays open and nothing is invoiced.')}
              </p>
              {confirmFor.error && (
                <p role="alert" data-testid="bast-confirm-error" className="font-medium text-destructive-text">{confirmFor.error}</p>
              )}
            </div>
          }
          confirmLabel={confirmFor.acceptance.is_final
            ? t('projectTabs:contractQuantities.workOrders.acceptances.confirmFinal.confirm', 'Confirm final BAST')
            : t('projectTabs:contractQuantities.workOrders.acceptances.confirmStage.confirm', 'Confirm BAST')}
          loading={quantityMutations.confirm.isPending}
          onConfirm={() => void runConfirmBast()}
          onCancel={() => setConfirmFor(null)}
        />
      )}

      {valueFor && (
        <WorkOrderValueModal
          workOrder={valueFor}
          currentValueText={valueWithBasis(valueFor)}
          currencySymbolPrefix={prefix}
          onClose={() => setValueFor(null)}
          onSave={runSetValue}
        />
      )}

      {invoiceFor && clientId && (
        <InvoiceWorkOrderModal
          workOrder={invoiceFor.row}
          projectId={projectId}
          clientId={clientId}
          remaining={invoiceFor.remaining}
          onClose={() => setInvoiceFor(null)}
          onCreated={(invoice) => {
            setCreatedInvoice({ id: invoice.id, native: revenueMode === 'native' });
            if (revenueMode === 'native') {
              toast(t('projectDetail.workOrders.billing.toast.nativeCreated', 'Draft invoice created in PMO'), undefined, 'success');
            } else {
              toast(t('projectDetail.workOrders.billing.toast.created', 'Draft invoice created'), undefined, 'success');
            }
            setInvoiceFor(null);
          }}
        />
      )}

      {claimFor && summary && (
        <ProgressClaimModal
          boqItems={boqRows}
          workOrders={rows}
          allocations={lines.data ?? []}
          contractLines={summary.contractLines}
          contractNet={summary.contractNet}
          currencySymbolPrefix={prefix}
          hasDownPayment={liveDownPayment}
          claimedByBoqItem={summary.claimedByBoqItem}
          assessedByBoqItem={summary.assessedByBoqItem}
          assessmentMonth={summary.assessment?.month ?? null}
          initialWorkOrderId={claimFor.id}
          onClose={() => setClaimFor(null)}
          onSave={saveClaim}
          onError={failClaim}
        />
      )}

      {evidenceFor && (
        <ClaimEvidenceModal
          documents={documents.data ?? []}
          attachedDocumentIds={(claimRows.find((claim) => claim.id === evidenceFor)?.evidence ?? []).map((evidence) => evidence.document_id)}
          onClose={() => setEvidenceFor(null)}
          onAttach={attachEvidence}
          onError={failClaim}
        />
      )}

      {raiseFor && (
        <ConfirmDialog
          open
          title={t('projectDetail.billing.claims.confirmRaise.title', "Raise this claim's invoice?")}
          description={
            <div className="flex flex-col gap-2">
              <p>{t('projectDetail.billing.claims.confirmRaise.body', 'An ERP sales invoice draft is created from this claim. A different Admin or Finance user submits it.')}</p>
              <p data-testid="raise-figures">
                {t('projectDetail.billing.claims.confirmRaise.figures', 'Claimed {{gross}} · down payment recovered {{recovery}} · net {{net}} (excl. PPN)', {
                  gross: formatCurrencyCents(Number(raiseFor.claim.gross_amount), currency),
                  recovery: formatCurrencyCents(Number(raiseFor.claim.dp_recovery_amount), currency),
                  net: formatCurrencyCents(claimNet(Number(raiseFor.claim.gross_amount), Number(raiseFor.claim.dp_recovery_amount)), currency),
                  interpolation: { escapeValue: false },
                })}
              </p>
            </div>
          }
          confirmLabel={t('projectDetail.billing.claims.confirmRaise.confirm', 'Create ERP invoice')}
          loading={billingMutations.raiseInvoice.isPending}
          onConfirm={() => void runRaiseClaimInvoice()}
          onCancel={() => setRaiseFor(null)}
        />
      )}

      {withdrawClaimFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t('projectDetail.billing.claims.confirmWithdraw.title', 'Withdraw this claim?')}
          description={t('projectDetail.billing.claims.confirmWithdraw.body', 'Withdrawing is final. Its quantities and down payment recovery are released for a new claim.')}
          confirmLabel={t('projectDetail.billing.claims.confirmWithdraw.confirm', 'Withdraw claim')}
          loading={billingMutations.withdrawClaim.isPending}
          onConfirm={() => void runWithdrawClaim()}
          onCancel={() => setWithdrawClaimFor(null)}
        />
      )}

      {pending && (
        <ConfirmDialog
          open
          {...confirmCopy(pending)}
          loading={transition.isPending}
          onConfirm={() => void runTransition(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {/* The acknowledgement. Deliberately a SEPARATE confirm carrying the server's own sentence —
          it names the candidate total, the ceiling and what is already committed, which is more
          than any figure the client holds could promise to be current about. */}
      {overCommit && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t(
            'projectDetail.workOrders.confirm.overCommit.title',
            'This would go past the contract ceiling',
          )}
          description={
            <div className="flex flex-col gap-2" data-testid="wo-over-commit-body">
              <p data-testid="wo-over-commit-message">{overCommit.message}</p>
              <p>
                {t(
                  'projectDetail.workOrders.confirm.overCommit.body',
                  'You may still issue it. If you do, your name and the time are recorded on this work order as the person who chose to over-commit.',
                )}
              </p>
            </div>
          }
          confirmLabel={t(
            'projectDetail.workOrders.confirm.overCommit.confirm',
            'Acknowledge and issue',
          )}
          loading={transition.isPending}
          onConfirm={() => void runAcknowledgedIssue(overCommit.row)}
          onCancel={() => setOverCommit(null)}
        />
      )}
    </div>
  );
};

export default WorkOrdersTab;
