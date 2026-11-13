import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  ListState,
  SelectField,
  TaxBasisLabel,
  useToast,
  type Column,
} from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency, formatNumberExact, formatNumberWhole, currencySymbol } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  isOverCommitmentRefusal,
  type WorkOrderRow,
  type WorkOrderStatus,
} from '@/src/lib/db/workOrders';
import { useProjectWorkOrders, useWorkOrderMutations } from '@/src/hooks/useWorkOrders';
import { useWorkOrderAcceptanceAge, useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useBoqItems, useProgressBillingMutations, useProjectBilling, useProjectClaims } from '@/src/hooks/useProgressBilling';
import { useDocuments } from '@/src/hooks/useDocuments';
import {
  useWorkOrderAcceptanceMutations, useWorkOrderAcceptances, useProjectWorkOrderLines,
} from '@/src/hooks/useWorkOrderAcceptances';
import type { WorkOrderAcceptanceWithLines, WorkOrderLineRow } from '@/src/lib/db/workOrderAcceptances';
import type { ProgressAssessmentInput, ProgressClaimWithInvoice } from '@/src/lib/db/progressBilling';
import { summarizeBilling } from '@/src/lib/progressBilling';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import { PROGRESS_RECORDABLE_PROJECT_STATUSES } from '@/src/lib/dashboardConstants';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { useOwnershipCacheSynced, useRevenueRouteReady } from '@/src/hooks/useOwnershipCacheSync';
import {
  canInvoiceWorkOrder,
  summarizeProjectWorkOrderBilling,
} from '@/src/lib/workOrderBilling';
import {
  basisNote,
  type InvoiceWithWorkOrder,
  type OrderLineView,
  type PendingTransition,
} from './workOrdersTabFigures';
import WorkOrderCustomerOrderCard from './WorkOrderCustomerOrderCard';
import WorkOrdersDraftOrders from './WorkOrdersDraftOrders';
import WorkOrdersClaimsCard, { WorkOrdersOrderlessInvoices } from './WorkOrdersClaimsCard';
import {
  DeliverySelectorDrawer,
  WorkOrderClaimDrawer,
  WorkOrderInvoiceDrawer,
  WorkOrderLineDrawer,
  WorkOrderPoDrawer,
} from './WorkOrdersDrawers';
import WorkOrdersModals from './WorkOrdersModals';

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
 *
 * The focused pieces live beside this file: workOrdersTabFigures (figures + pure helpers),
 * WorkOrdersDraftOrders, WorkOrderCustomerOrderCard, WorkOrdersClaimsCard,
 * WorkOrdersOrderlessInvoices, WorkOrdersDrawers and WorkOrdersModals.
 */

export interface WorkOrdersTabProps {
  projectId: string;
  /** The project's currency. Work orders are pinned to it by a trigger, so they never disagree. */
  currency: string;
  /** The project's client — the invoice customer (OD-BILL-1). No client, no "Invoice" button. */
  clientId?: string | null;
  /** A work order to bring into view on arrival (`?wo=` from a dashboard link): highlighted, scrolled to, focused. */
  focusWorkOrderId?: string | null;
  /** `?wo=…&invoice=1` from the plan's Invoice this: open the shipped invoice flow for this work order once, through the card button's own gate. */
  autoInvoiceWorkOrderId?: string | null;
  /** Decides who may prepare a BAST (the project's own PM or Finance rank). */
  projectManagerId?: string | null;
  /** Standalone legacy surface may explain partial-payment timing; ContractCascade owns the note on its page. */
  showSettlementNote?: boolean;
  /** Shown in the Record progress dialog. */
  projectName?: string;
  /** Month-end percent complete is offered only while the project is in a progress-recordable status. */
  projectStatus?: string | null;
}

const WorkOrdersTab: React.FC<WorkOrdersTabProps> = ({ projectId, currency, clientId = null, focusWorkOrderId = null, autoInvoiceWorkOrderId = null, projectManagerId = null, projectName = '', projectStatus = null }) => {
  const { t } = useTranslation('project');
  const [searchParams, setSearchParams] = useSearchParams();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const { data, isPending, isFetching, isError, refetch } = useProjectWorkOrders(projectId);
  const { create, update, setValue, transition } = useWorkOrderMutations(projectId);

  // `undefined` = closed · `null` = create a draft · a row = edit that draft's body.
  const [formFor, setFormFor] = useState<WorkOrderRow | null | undefined>(undefined);
  const [valueFor, setValueFor] = useState<WorkOrderRow | null>(null);
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [orderFilter, setOrderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | 'all'>('all');
  const [deliverySelectorOpen, setDeliverySelectorOpen] = useState(false);
  const [lineDrawerFor, setLineDrawerFor] = useState<OrderLineView | null>(null);
  const [poDrawerFor, setPoDrawerFor] = useState<WorkOrderRow | null>(null);
  const [invoiceDrawerFor, setInvoiceDrawerFor] = useState<InvoiceWithWorkOrder | null>(null);
  const [claimDrawerFor, setClaimDrawerFor] = useState<ProgressClaimWithInvoice | null>(null);
  const [newClaimOpen, setNewClaimOpen] = useState(false);
  const [assessOpen, setAssessOpen] = useState(false);
  const [percentOpen, setPercentOpen] = useState(false);
  /** The server's own over-ceiling refusal, held until the user answers it. */
  const [overCommit, setOverCommit] = useState<{ row: WorkOrderRow; message: string } | null>(null);
  const openRecordId = searchParams.get('open');
  const openRecordType = searchParams.get('openType');
  const updateOpenRecord = (id: string, type: 'workOrder' | 'workOrderLine' | 'workOrderInvoice' | 'workOrderClaim') => {
    const next = new URLSearchParams(searchParams);
    next.set('open', id);
    next.set('openType', type);
    setSearchParams(next);
  };
  const closeOpenRecord = (id: string, type: 'workOrder' | 'workOrderLine' | 'workOrderInvoice' | 'workOrderClaim') => {
    if (openRecordId === id && openRecordType === type) {
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      next.delete('openType');
      setSearchParams(next, { replace: true });
    }
    if (type === 'workOrder') setPoDrawerFor(null);
    if (type === 'workOrderLine') setLineDrawerFor(null);
    if (type === 'workOrderInvoice') setInvoiceDrawerFor(null);
    if (type === 'workOrderClaim') setClaimDrawerFor(null);
  };
  const openPoDrawer = (row: WorkOrderRow) => { setPoDrawerFor(row); updateOpenRecord(row.id, 'workOrder'); };
  const openLineDrawer = (line: OrderLineView) => { setLineDrawerFor(line); updateOpenRecord(line.key, 'workOrderLine'); };
  const openInvoiceDrawer = (invoice: InvoiceWithWorkOrder) => { setInvoiceDrawerFor(invoice); updateOpenRecord(invoice.id, 'workOrderInvoice'); };
  const openClaimDrawer = (claim: ProgressClaimWithInvoice) => { setClaimDrawerFor(claim); updateOpenRecord(claim.id, 'workOrderClaim'); };

  const rows = useMemo(() => data ?? [], [data]);
  const canIssue = (id: string) => !isPending && !isFetching && !isError && rows.some((row) => row.id === id && row.status === 'Draft' && row.issue_eligibility === 'allowed');
  const requestIssue = (row: WorkOrderRow) => {
    if (canIssue(row.id) && may('transition', 'workOrder')) setPending({ row, to: 'Issued' });
  };
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
  const claimRows = useMemo(() => claimsQuery.data ?? [], [claimsQuery.data]);
  const summary = projectBilling.data ? summarizeBilling(projectBilling.data) : null;
  const allocationsByWo = useMemo(() => {
    const grouped = new Map<string, WorkOrderLineRow[]>();
    for (const row of lines.data ?? []) grouped.set(row.work_order_id, [...(grouped.get(row.work_order_id) ?? []), row]);
    return grouped;
  }, [lines.data]);
  const drawerLineRows = useMemo<OrderLineView[]>(() => rows.flatMap((order) =>
    (projectBilling.data?.contractLines ?? []).flatMap((contractLine) => contractLine.allocations
      .filter((allocation) => allocation.workOrderId === order.id)
      .map((allocation) => {
        const item = boqRows.find((boqItem) => boqItem.id === allocation.boqItemId) ?? null;
        return {
          key: `${allocation.boqItemId}-${order.id}`,
          order,
          item,
          allocation,
          rate: item?.rate == null ? null : Number(item.rate),
        };
      })),
  ), [rows, projectBilling.data, boqRows]);
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
  // #1457: the org's business day (not the viewer's device day) bounds the overdue figure.
  const orgDay = useFxOrgDay(canViewBilling).day;
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
  const acceptanceAge = useWorkOrderAcceptanceAge(projectId, canViewBilling);
  const ageById = useMemo(() => new Map((acceptanceAge.data ?? []).map((a) => [a.workOrderId, a.days] as const)), [acceptanceAge.data]);
  const billingById = useMemo(
    () => new Map((billing.data ?? []).map((b) => [b.workOrderId, b] as const)),
    [billing.data],
  );
  const billingTotals = useMemo(() => summarizeProjectWorkOrderBilling(billing.data ?? []), [billing.data]);
  const [invoiceFor, setInvoiceFor] = useState<{ row: WorkOrderRow; remaining: number } | null>(null);
  const [createdInvoice, setCreatedInvoice] = useState<{ id: string; native: boolean } | null>(null);
  const [claimFor, setClaimFor] = useState<WorkOrderRow | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [raiseFor, setRaiseFor] = useState<{ claim: ProgressClaimWithInvoice; idempotencyKey: string } | null>(null);
  const [withdrawClaimFor, setWithdrawClaimFor] = useState<ProgressClaimWithInvoice | null>(null);
  const claimScopeReady = !lines.isPending && !lines.isError;
  const canBill = may('create', 'progressClaim') && erp.connected && Boolean(clientId) && claimScopeReady && Boolean(summary);
  /** The card's Raise invoice and the plan's Invoice this share ONE gate and ONE opener (#1640 D5). */
  const orderInvoiceAction = (row: WorkOrderRow): (() => void) | null => {
    // Fail closed: if either read that tells claim-path from direct-path failed, we can't know which applies.
    if (lines.isError || projectBilling.isError) return null;
    const hasOrderLines = (projectBilling.data?.contractLines ?? []).some((line) => line.allocations.some((a) => a.workOrderId === row.id))
      || (allocationsByWo.get(row.id) ?? []).length > 0;
    const billingRow = billingById.get(row.id);
    const invoiceable = billingRow && canInvoiceWorkOrder(row.status, billingRow);
    if (!((hasOrderLines ? canBill : canInvoice) && invoiceable && billingRow && billingRow.remaining > 0)) return null;
    return () => {
      setCreatedInvoice(null);
      if (hasOrderLines) setClaimFor(row);
      else setInvoiceFor({ row, remaining: billingRow.remaining });
    };
  };
  const canAssess = may('edit', 'projectProgress', { currentUserId: currentUser?.id, record: { project_manager_id: projectManagerId } });
  // A project without contract lines records its month-end percent complete directly; with contract lines the
  // percent is measured from quantities (the assessment above).
  const canRecordPercent = canAssess && !boq.isPending && !boq.isError && boqRows.length === 0
    && PROGRESS_RECORDABLE_PROJECT_STATUSES.has(projectStatus ?? '');
  const liveDownPayment = claimRows.some((claim) => claim.kind === 'down_payment' && !claim.withdrawn_at && claim.invoice?.status !== 'Cancelled');
  const canPrepareForOrder = (row: WorkOrderRow): boolean => row.status === 'Issued'
    && (allocationsByWo.get(row.id) ?? []).length > 0
    && may('create', 'workOrderAcceptance', { currentUserId: currentUser?.id, record: { status: row.status, project_manager_id: projectManagerId } });

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

  // #1640 FR-WOMS-031..033: arriving from the plan's Invoice this. Wait until every input of the gate is read, act
  // once, then drop `invoice` from the URL so reload/Back never reopens the dialog. `useRevenueRouteReady` is false
  // until the ownership cache syncs (`useOwnershipCacheSync.ts`), so waiting on `revenueMode` alone would announce
  // a false refusal on a fast arrival and spend the one shot.
  const autoInvoiced = useRef(false);
  const [autoInvoiceNote, setAutoInvoiceNote] = useState<string | null>(null);
  const ownershipSynced = useOwnershipCacheSynced();
  const gateReady = !isPending && !billing.isPending && !lines.isPending && !projectBilling.isPending
    && revenueMode !== undefined && ownershipSynced;
  useEffect(() => {
    if (!autoInvoiceWorkOrderId || autoInvoiced.current || !gateReady) return;
    autoInvoiced.current = true;
    const row = rows.find((r) => r.id === autoInvoiceWorkOrderId);
    const open = row ? orderInvoiceAction(row) : null;
    if (open) open();
    else setAutoInvoiceNote(t('projectDetail.workOrders.cannotInvoiceHere', "This work order can't be invoiced from here right now."));
    const next = new URLSearchParams(searchParams);
    next.delete('invoice');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on arrival; orderInvoiceAction reads current state.
  }, [autoInvoiceWorkOrderId, gateReady, rows]);

  const valueWithBasis = (row: WorkOrderRow): string => `${formatCurrency(row.order_value, row.currency)} ${basisNote(row, t)}`;

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
    if (to === 'Issued' && (!may('transition', 'workOrder') || !canIssue(row.id))) return;
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
    if (!may('transition', 'workOrder') || !canIssue(row.id)) return;
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
          ? t('projectTabs:contractQuantities.workOrders.acceptances.toast.closed', 'Final BAST confirmed: closed at {{amount}}', { amount: formatCurrency(result.closingValue, currency), interpolation: { escapeValue: false } })
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
    setNewClaimOpen(false);
    if (typeof id === 'string') setEvidenceFor(id);
  };

  const saveAssessment = async (input: Omit<ProgressAssessmentInput, 'projectId'>) => {
    const pct = await billingMutations.recordAssessment.mutateAsync(input);
    toast(t('projectDetail.billing.assessment.toast.saved', 'Progress recorded: {{pct}}% complete', { pct: formatNumberExact(Number(pct)) }), undefined, 'success');
    setAssessOpen(false);
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
        '55000': t('projectDetail.billing.claims.errors.claimWithdrawn', "This claim was withdrawn. Its invoice can't be raised."),
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

  const customerOrders = rows.filter((row) => row.status !== 'Draft')
    .sort((a, b) => (a.wo_number ?? a.title).localeCompare(b.wo_number ?? b.title));
  const liveOrders = rows.filter((row) => row.status === 'Issued' || row.status === 'Closed')
    .sort((a, b) => (a.wo_number ?? '').localeCompare(b.wo_number ?? ''));
  const draftOrders = rows.filter((row) => row.status === 'Draft')
    .sort((a, b) => (a.wo_number ?? a.title).localeCompare(b.wo_number ?? b.title));
  const filteredOrders = rows.filter((row) => (orderFilter === 'all' || row.id === orderFilter)
    && (statusFilter === 'all' || row.status === statusFilter));
  const filteredOrderIds = new Set(filteredOrders.map((row) => row.id));
  const visibleCustomerOrders = customerOrders.filter((row) => filteredOrderIds.has(row.id));
  const visibleDraftOrders = draftOrders.filter((row) => filteredOrderIds.has(row.id));
  const deliveryCandidates = liveOrders.filter(canPrepareForOrder);
  const orderExportColumns: Column<WorkOrderRow>[] = [
    { key: 'number', header: t('projectDetail.workOrders.export.number', 'Work order'), cell: (row) => row.wo_number ?? row.title, exportValue: (row) => row.wo_number ?? row.title },
    { key: 'title', header: t('projectDetail.workOrders.export.title', 'Title'), cell: (row) => row.title, exportValue: (row) => row.title },
    { key: 'customerPo', header: t('projectDetail.workOrders.export.customerPo', 'Customer PO'), cell: (row) => row.client_po_number ?? '', exportValue: (row) => row.client_po_number ?? '' },
    { key: 'status', header: t('projectDetail.workOrders.export.status', 'Status'), cell: (row) => row.status, exportValue: (row) => row.status },
    ...(canViewBilling ? [{ key: 'value', header: t('projectDetail.workOrders.export.value', 'Order value'), cell: (row: WorkOrderRow) => row.order_value ?? '', align: 'num' as const, exportValue: (row: WorkOrderRow) => row.order_value ?? '' }] : []),
  ];
  const orderlessInvoices = invoiceRows.filter((invoice) => !invoice.work_order_id);
  const lineReadsPending = boq.isPending || projectBilling.isPending || lines.isPending;
  const lineReadsFailed = boq.isError || projectBilling.isError || lines.isError;
  const invoiceReadReady = !canViewBilling || (!invoicesQuery.isPending && !invoicesQuery.isError);
  const canEditOrderLines = (row: WorkOrderRow) => may('create', 'workOrderLine', { record: { status: row.status } });
  const retryLineReads = () => { void boq.refetch(); void projectBilling.refetch(); void lines.refetch(); };

  useEffect(() => {
    setPoDrawerFor(openRecordType === 'workOrder' ? rows.find((row) => row.id === openRecordId) ?? null : null);
    setLineDrawerFor(openRecordType === 'workOrderLine' ? drawerLineRows.find((line) => line.key === openRecordId) ?? null : null);
    setInvoiceDrawerFor(openRecordType === 'workOrderInvoice' ? invoiceRows.find((invoice) => invoice.id === openRecordId) ?? null : null);
    setClaimDrawerFor(openRecordType === 'workOrderClaim' && canViewBilling ? claimRows.find((claim) => claim.id === openRecordId) ?? null : null);
  }, [openRecordId, openRecordType, rows, drawerLineRows, invoiceRows, claimRows, canViewBilling]);

  return (
    <div className="space-y-[var(--space-panel-gap)]">
      {canViewBilling && dpNotice !== null && (
        <div role="status" data-testid="wo-dp-held-notice" className="border-b border-border pb-3 text-sm text-muted-foreground">
          {t('projectTabs:contractQuantities.workOrders.closing.dpHeld',
            '{{amount}} of the down payment is still held after closing. Finance should recover the rest with the next progress claim, or refund it explicitly. Closing does not clear it.',
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

      <section aria-labelledby="pd-customer-orders" className="panel-card min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[var(--panel-inset)] py-4">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 id="pd-customer-orders" className="text-sm font-semibold text-foreground">
              {t('projectDetail.contract.orders', 'Customer orders')}
            </h2>
            {/* C6: currency named once for the orders below; every figure in them is a bare number. */}
            {/* AC-BWO-004: billing figures are net of tax — the basis is said once, here. */}
            {canViewBilling && <span className="text-sm text-muted-foreground">{currency} · <TaxBasisLabel treatment="exclusive" showDetails={false} className="whitespace-nowrap text-sm" testId="wo-billing-basis" /></span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {deliveryCandidates.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => deliveryCandidates.length === 1
                ? setBastFor({ row: deliveryCandidates[0], draft: null })
                : setDeliverySelectorOpen(true)}>
                {t('projectDetail.workOrders.action.recordDelivery', 'Record delivery')}
              </Button>
            )}
            {may('create', 'workOrder') && (
              <Button id="add-customer-order" variant="outline" size="sm" onClick={() => setFormFor(null)}>
                {t('projectDetail.workOrders.action.addCustomerOrder', 'Add customer order')}
              </Button>
            )}
            <ExportButton rows={filteredOrders} columns={orderExportColumns} entity="Customer orders"
              label={t('common.export', 'Export')} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 px-[var(--panel-inset)] pt-4">
          <SelectField
            label={t('projectDetail.workOrders.filter.orders', 'Order')}
            value={orderFilter}
            onChange={setOrderFilter}
            options={[
              { value: 'all', label: t('projectDetail.workOrders.filter.allOrders', 'All orders') },
              ...rows.map((row) => ({ value: row.id, label: row.wo_number ?? row.title })),
            ]}
            wrapperClassName="min-w-[190px] flex-1 gap-1 sm:flex-none"
            aria-label={t('projectDetail.workOrders.filter.orders', 'Order')}
          />
          <SelectField
            label={t('projectDetail.workOrders.filter.status', 'Status')}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as WorkOrderStatus | 'all')}
            options={[
              { value: 'all', label: t('projectDetail.workOrders.filter.allStatuses', 'All statuses') },
              ...(['Draft', 'Issued', 'Closed', 'Cancelled'] as const).map((status) => ({ value: status, label: status })),
            ]}
            wrapperClassName="min-w-[160px] gap-1"
            aria-label={t('projectDetail.workOrders.filter.status', 'Status')}
          />
        </div>
        {autoInvoiceNote && <p role="status" className="px-[var(--panel-inset)] pt-4 text-sm text-muted-foreground">{autoInvoiceNote}</p>}
        {/* L6/C4: the "Still to invoice" total only adds information across several orders (one order's own line
            already says it); "Not yet submitted" is said only here. An incomplete total is left out — each order
            states why its figures are incomplete. */}
        {canViewBilling && rows.length > 0 && billing.data && billing.data.length > 0 && billingTotals.complete && <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-[var(--panel-inset)] text-sm" role="status">
          {rows.length > 0 && billing.data && billing.data.length > 0 && billingTotals.complete && <span data-testid="wo-billing-summary" aria-label={t('common:projectDetail.workOrders.billing.summaryTitle', 'Billing against work orders')} className="flex flex-wrap gap-x-4 gap-y-1">
            {billing.data.length > 1 && <span>
              <span className="text-muted-foreground">{t('common:projectDetail.workOrders.billing.stillToInvoice', 'Still to invoice')}</span>
              <strong data-testid="wo-billing-total-still" className="ml-2 tabular-nums">
                {formatNumberWhole(billingTotals.stillToInvoice)}
              </strong>
            </span>}
            {billingTotals.inDraft > 0 && <span>
              <span className="text-muted-foreground">{t('common:projectDetail.workOrders.billing.notSubmitted', 'Not yet submitted')}</span>{' '}
              <strong data-testid="wo-billing-total-draft" className="ml-1 tabular-nums">
                {formatNumberWhole(billingTotals.inDraft)}
              </strong>
            </span>}
          </span>}
        </div>}

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

            {visibleCustomerOrders.length === 0 && (lineReadsFailed
              ? <ListState variant="error" title={t('projectDetail.cascade.error', "Couldn't load the contract")} onRetry={retryLineReads} />
              : lineReadsPending ? <ListState variant="loading" rows={3} /> : null)}
            {!showQuantities && visibleCustomerOrders.length === 0 && visibleDraftOrders.length === 0 && (
              <p className="px-[var(--panel-inset)] py-4 text-sm text-muted-foreground">
                {t('projectDetail.workOrders.emptyRegister', 'No customer orders yet. Client purchase orders are recorded here and draw down the project contract ceiling when issued.')}
              </p>
            )}
            {showQuantities && visibleCustomerOrders.length === 0 && visibleDraftOrders.length === 0 && (
              <p className="px-[var(--panel-inset)] py-4 text-sm text-muted-foreground">
                {t('projectDetail.contract.noOrders', 'No customer orders yet.')}
              </p>
            )}

            {visibleDraftOrders.length > 0 && (
              <section aria-labelledby="pd-draft-orders" className="mb-6 mt-4 px-[var(--panel-inset)]">
                <h3 id="pd-draft-orders" className="mb-2 text-sm font-medium text-muted-foreground">
                  {t('projectDetail.workOrders.drafts', 'Draft orders')}
                </h3>
                <WorkOrdersDraftOrders
                  rows={visibleDraftOrders}
                  readsPending={isPending}
                  readsFetching={isFetching}
                  readsError={isError}
                  lineReadsPending={lineReadsPending}
                  lineReadsFailed={lineReadsFailed}
                  openPoDrawer={openPoDrawer}
                  onEdit={setFormFor}
                  onSetValue={setValueFor}
                  onIssue={requestIssue}
                  onCancel={(row) => setPending({ row, to: 'Cancelled' })}
                  onAllocateLines={setLinesFor}
                />
              </section>
            )}

            {visibleCustomerOrders.length > 0 && <div className="flex flex-col gap-4 p-[var(--panel-inset)] pt-4">{visibleCustomerOrders.map((row) => <WorkOrderCustomerOrderCard
              key={row.id}
              row={row}
              currency={currency}
              canViewBilling={canViewBilling}
              orgDay={orgDay}
              boqRows={boqRows}
              documentRows={documents.data ?? []}
              projectManagerId={projectManagerId}
              allocationsByWo={allocationsByWo}
              acceptancesByWo={acceptancesByWo}
              invoicesByWo={invoicesByWo}
              billingById={billingById}
              ageById={ageById}
              drawerLineRows={drawerLineRows}
              lineReadsPending={lineReadsPending}
              lineReadsFailed={lineReadsFailed}
              invoiceReadReady={invoiceReadReady}
              invoicesRead={invoicesQuery}
              billingRead={billing}
              contractLines={projectBilling.data?.contractLines}
              retryLineReads={retryLineReads}
              canPrepareForOrder={canPrepareForOrder}
              orderInvoiceAction={orderInvoiceAction}
              closeByBast={closeByBast}
              currentUserId={currentUser?.id ?? null}
              openPoDrawer={openPoDrawer}
              openLineDrawer={openLineDrawer}
              openInvoiceDrawer={openInvoiceDrawer}
              setFormFor={setFormFor}
              setPending={setPending}
              setBastFor={setBastFor}
              setConfirmFor={setConfirmFor}
              setWithdrawFor={setWithdrawFor}
              setLinesFor={setLinesFor}
              acceptancesRead={acceptancesQuery}
              linesRead={lines}
            />)}</div>}
          </>
        )}
      </section>

      <WorkOrdersClaimsCard
        visible={canViewBilling}
        boqRows={boqRows}
        summary={summary}
        canAssess={canAssess}
        canRecordPercent={canRecordPercent}
        canBill={canBill}
        claimsRead={claimsQuery}
        claimRows={claimRows}
        openClaimDrawer={openClaimDrawer}
        onOpenAssessment={() => setAssessOpen(true)}
        onOpenPercent={() => setPercentOpen(true)}
        onOpenNewClaim={() => setNewClaimOpen(true)}
        onAttachEvidence={setEvidenceFor}
        onRaiseClaim={(claim) => setRaiseFor({ claim, idempotencyKey: crypto.randomUUID() })}
        onWithdrawClaim={setWithdrawClaimFor}
      />

      {canViewBilling && (orderlessInvoices.length > 0 || ((!customerOrders.length && !draftOrders.length) && !invoiceReadReady)) && <WorkOrdersOrderlessInvoices
        orderlessInvoices={orderlessInvoices}
        invoicesRead={invoicesQuery}
        openInvoiceDrawer={openInvoiceDrawer}
      />}

      {deliverySelectorOpen && <DeliverySelectorDrawer
        open
        candidates={deliveryCandidates}
        onClose={() => setDeliverySelectorOpen(false)}
        onPick={(order) => { setDeliverySelectorOpen(false); setBastFor({ row: order, draft: null }); }}
      />}

      {lineDrawerFor && <WorkOrderLineDrawer
        selected={lineDrawerFor}
        contractLines={projectBilling.data?.contractLines}
        orders={rows}
        acceptancesByWo={acceptancesByWo}
        lineReadsPending={lineReadsPending}
        lineReadsFailed={lineReadsFailed}
        canViewBilling={canViewBilling}
        currency={currency}
        projectId={projectId}
        onClose={() => closeOpenRecord(lineDrawerFor.key, 'workOrderLine')}
        onAllocateLines={(order) => { closeOpenRecord(lineDrawerFor.key, 'workOrderLine'); setLinesFor(order); }}
      />}

      {poDrawerFor && <WorkOrderPoDrawer
        row={poDrawerFor}
        canViewBilling={canViewBilling}
        currency={currency}
        projectId={projectId}
        onClose={() => closeOpenRecord(poDrawerFor.id, 'workOrder')}
        onEdit={(row) => { closeOpenRecord(row.id, 'workOrder'); setFormFor(row); }}
      />}

      {invoiceDrawerFor && <WorkOrderInvoiceDrawer
        invoice={invoiceDrawerFor}
        currency={currency}
        onClose={() => closeOpenRecord(invoiceDrawerFor.id, 'workOrderInvoice')}
      />}

      {claimDrawerFor && <WorkOrderClaimDrawer
        claim={claimDrawerFor}
        canBill={canBill}
        currency={currency}
        projectId={projectId}
        documents={documents.data ?? []}
        onClose={() => closeOpenRecord(claimDrawerFor.id, 'workOrderClaim')}
        onRaise={(claim) => { closeOpenRecord(claim.id, 'workOrderClaim'); setRaiseFor({ claim, idempotencyKey: crypto.randomUUID() }); }}
        onAttachEvidence={(claimId) => { closeOpenRecord(claimId, 'workOrderClaim'); setEvidenceFor(claimId); }}
      />}

      <WorkOrdersModals
        boqRows={boqRows}
        documentRows={documents.data ?? []}
        documentsPending={documents.isPending}
        documentsError={documents.isError}
        onRetryDocuments={() => { void documents.refetch(); }}
        rows={rows}
        allocations={lines.data ?? []}
        allocationsById={allocationsByWo}
        acceptancesByWo={acceptancesByWo}
        contractLines={projectBilling.data?.contractLines ?? []}
        summary={summary}
        currency={currency}
        currencyPrefix={prefix}
        projectId={projectId}
        projectName={projectName}
        liveDownPayment={liveDownPayment}
        evidenceAttachedIds={(claimRows.find((claim) => claim.id === evidenceFor)?.evidence ?? []).map((evidence) => evidence.document_id)}
        linesSources={[
          { query: boq, name: t('projectDetail.billing.sources.boq', 'contract lines') },
          { query: projectBilling, name: t('projectDetail.billing.sources.billing', 'billing figures') },
          { query: lines, name: t('projectDetail.billing.sources.allocations', 'order allocations') },
        ].map(({ query, name }) => ({ name, pending: query.isPending, error: query.isError, retry: () => { void query.refetch(); } }))}
        assessOpen={assessOpen}
        percentOpen={percentOpen}
        formFor={formFor}
        linesFor={linesFor}
        bastFor={bastFor}
        withdrawFor={withdrawFor}
        confirmFor={confirmFor}
        valueFor={valueFor}
        invoiceFor={invoiceFor}
        clientId={clientId}
        claimFor={claimFor}
        newClaimOpen={newClaimOpen}
        evidenceFor={evidenceFor}
        raiseFor={raiseFor}
        withdrawClaimFor={withdrawClaimFor}
        pending={pending}
        overCommit={overCommit}
        bastMutations={quantityMutations}
        claimMutations={billingMutations}
        transition={transition}
        canIssue={canIssue}
        canEditLinesFor={canEditOrderLines}
        onCloseAssessment={() => setAssessOpen(false)}
        onSaveAssessment={saveAssessment}
        onError={fail}
        onClosePercent={() => setPercentOpen(false)}
        onCloseForm={() => setFormFor(undefined)}
        onCreateOrder={runCreate}
        onUpdateOrder={runUpdate}
        onCloseLines={() => setLinesFor(null)}
        onCreateLine={async (workOrderId, boqItemId, quantity) => { await quantityMutations.createLine.mutateAsync({ workOrderId, boqItemId, quantity }); }}
        onUpdateLine={async (id, quantity) => { await quantityMutations.updateLine.mutateAsync({ id, quantity }); }}
        onDeleteLine={async (id) => { await quantityMutations.deleteLine.mutateAsync(id); }}
        onCloseBast={() => setBastFor(null)}
        onSaveBast={runPrepare}
        onWithdrawBast={runWithdrawBast}
        onCloseWithdraw={() => setWithdrawFor(null)}
        onConfirmBast={runConfirmBast}
        onCloseConfirm={() => setConfirmFor(null)}
        currentValueText={valueFor ? valueWithBasis(valueFor) : ''}
        onCloseValue={() => setValueFor(null)}
        onSaveValue={runSetValue}
        onCloseInvoice={() => setInvoiceFor(null)}
        onInvoiceCreated={(invoice) => {
          setCreatedInvoice({ id: invoice.id, native: revenueMode === 'native' });
          if (revenueMode === 'native') {
            toast(t('projectDetail.workOrders.billing.toast.nativeCreated', 'Draft invoice created in PMO'), undefined, 'success');
          } else {
            toast(t('projectDetail.workOrders.billing.toast.created', 'Draft invoice created'), undefined, 'success');
          }
          setInvoiceFor(null);
        }}
        onCloseClaim={() => { setClaimFor(null); setNewClaimOpen(false); }}
        onSaveClaim={saveClaim}
        onClaimError={failClaim}
        onCloseEvidence={() => setEvidenceFor(null)}
        onAttachEvidence={attachEvidence}
        onEvidenceError={failClaim}
        onRaise={runRaiseClaimInvoice}
        onCloseRaise={() => setRaiseFor(null)}
        onWithdrawClaimConfirm={runWithdrawClaim}
        onCloseWithdrawClaim={() => setWithdrawClaimFor(null)}
        onTransition={runTransition}
        onCloseTransition={() => setPending(null)}
        onAcknowledgedIssue={runAcknowledgedIssue}
        onCloseOverCommit={() => setOverCommit(null)}
      />
    </div>
  );
};

export default WorkOrdersTab;
