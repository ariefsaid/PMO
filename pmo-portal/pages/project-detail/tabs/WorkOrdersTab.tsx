import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  Card,
  CardHead,
  CardPad,
  cn,
  ConfirmDialog,
  DataTable,
  Drawer,
  GateNotice,
  ListState,
  MenuButton,
  ProgressBar,
  StatusPill,
  TaxBasisLabel,
  Tooltip,
  useToast,
  type Column,
  type RowMenuItem,
  type StatusVariant,
} from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency, formatDateOnly, formatNumberExact, formatNumberWhole, formatUtcMonthYear, currencySymbol } from '@/src/lib/format';
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
import ProgressAssessmentModal from '../ProgressAssessmentModal';
import { RecordProgressModal } from '@/src/components/reports/RecordProgressModal';
import { PROGRESS_RECORDABLE_PROJECT_STATUSES } from '@/src/lib/dashboardConstants';
import ClaimEvidenceModal from '../ClaimEvidenceModal';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { BoqItemRow, ProgressAssessmentInput, ProgressClaimWithInvoice } from '@/src/lib/db/progressBilling';
import { claimNet, summarizeBilling, type AllocationFacts } from '@/src/lib/progressBilling';
import { summarizeInvoiceSettlement } from '../ContractCascade';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { useRevenueRouteReady } from '@/src/hooks/useOwnershipCacheSync';
import {
  canInvoiceWorkOrder,
  deriveWorkOrderBillingState,
  summarizeProjectWorkOrderBilling,
  type WorkOrderBillingState,
} from '@/src/lib/workOrderBilling';

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
  /** Shown in the Record progress dialog. */
  projectName?: string;
  /** Month-end percent complete is offered only while the project is in a progress-recordable status. */
  projectStatus?: string | null;
}

type InvoiceWithWorkOrder = SalesInvoiceRow & { work_order_id?: string | null };

interface OrderLineView {
  key: string;
  order: WorkOrderRow;
  item: BoqItemRow | null;
  allocation: AllocationFacts;
  rate: number | null;
}

function invoiceBalanceFigures(invoice: InvoiceWithWorkOrder): { paid: number | null; unpaid: number | null } {
  if (invoice.status === 'Draft' || invoice.status === 'Cancelled') return { paid: null, unpaid: null };
  if (invoice.amount === null || invoice.erp_outstanding_amount === null) return { paid: null, unpaid: null };
  if (invoice.status === 'Paid') return { paid: invoice.amount, unpaid: 0 };
  const balance = summarizeInvoiceSettlement([invoice]);
  return { paid: balance.paid, unpaid: balance.unpaid };
}

/** `YYYY-MM-DD` in the browser's zone — only the BAST date dialog's default. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
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

const WorkOrdersTab: React.FC<WorkOrdersTabProps> = ({ projectId, currency, clientId = null, focusWorkOrderId = null, projectManagerId = null, projectName = '', projectStatus = null }) => {
  const { t } = useTranslation('project');
  const billingStateLabels: Record<Exclude<WorkOrderBillingState, 'not-billable'>, string> = {
    incomplete: t('common:projectDetail.workOrders.billing.status.incomplete', "Can't total"),
    'over-invoiced': t('common:projectDetail.workOrders.billing.status.overInvoiced', 'Over-invoiced'),
    'not-invoiced': t('common:projectDetail.workOrders.billing.status.notInvoiced', 'Not invoiced'),
    paid: t('common:projectDetail.workOrders.billing.status.paid', 'Fully paid'),
    'awaiting-submission': t('common:projectDetail.workOrders.billing.status.awaitingSubmission', 'Awaiting submission'),
    'fully-invoiced': t('common:projectDetail.workOrders.billing.status.fullyInvoiced', 'Fully invoiced'),
    'partly-invoiced': t('common:projectDetail.workOrders.billing.status.partlyInvoiced', 'Partly invoiced'),
  };
  const billingStateTones: Record<Exclude<WorkOrderBillingState, 'not-billable'>, StatusVariant> = {
    incomplete: 'warn',
    'over-invoiced': 'lost',
    'not-invoiced': 'open',
    paid: 'won',
    'awaiting-submission': 'neutral',
    'fully-invoiced': 'neutral',
    'partly-invoiced': 'progress',
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const { data, isPending, isError, refetch } = useProjectWorkOrders(projectId);
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
  const billingTotals = useMemo(() => summarizeProjectWorkOrderBilling(billing.data ?? []), [billing.data]);
  const [invoiceFor, setInvoiceFor] = useState<{ row: WorkOrderRow; remaining: number } | null>(null);
  const [createdInvoice, setCreatedInvoice] = useState<{ id: string; native: boolean } | null>(null);
  const [claimFor, setClaimFor] = useState<WorkOrderRow | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [raiseFor, setRaiseFor] = useState<{ claim: ProgressClaimWithInvoice; idempotencyKey: string } | null>(null);
  const [withdrawClaimFor, setWithdrawClaimFor] = useState<ProgressClaimWithInvoice | null>(null);
  const claimScopeReady = !lines.isPending && !lines.isError;
  const canBill = may('create', 'progressClaim') && erp.connected && Boolean(clientId) && claimScopeReady && Boolean(summary);
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
  const projectClaimColumns: Column<ProgressClaimWithInvoice>[] = [
    { key: 'claim', header: t('projectDetail.billing.claims.column.claim', 'Claim'), kind: 'primary', rowHeader: true,
      cell: (claim) => claim.kind === 'down_payment' ? t('projectDetail.billing.claims.kind.downPayment', 'Down payment') : t('projectDetail.billing.claims.kind.progress', 'Progress'),
      secondaryCell: (claim) => formatDateOnly(claim.created_at) },
    { key: 'gross', header: t('projectDetail.billing.claims.column.gross', 'Gross'), align: 'num', kind: 'money',
      cell: (claim) => <Tooltip content={t('projectDetail.billing.claims.source.gross', 'Source: the progress claim gross amount, copied from accepted quantities and contract rates.') }><span className="cursor-help tabular-nums">{formatNumberWhole(Number(claim.gross_amount))}</span></Tooltip>,
      exportValue: (claim) => Number(claim.gross_amount) },
    { key: 'recovery', header: t('projectDetail.billing.claims.column.recovery', 'DP recovery'), align: 'num', kind: 'money',
      cell: (claim) => <Tooltip content={t('projectDetail.billing.claims.source.recovery', 'Source: the down-payment amount recovered on this claim.') }><span className="cursor-help tabular-nums">{formatNumberWhole(Number(claim.dp_recovery_amount))}</span></Tooltip>,
      exportValue: (claim) => Number(claim.dp_recovery_amount) },
    { key: 'net', header: t('projectDetail.billing.claims.column.net', 'Net'), align: 'num', kind: 'money',
      cell: (claim) => <Tooltip content={t('projectDetail.billing.claims.source.net', 'Computed as gross less down-payment recovery.') }><span className="cursor-help tabular-nums font-semibold">{formatNumberWhole(claimNet(Number(claim.gross_amount), Number(claim.dp_recovery_amount)))}</span></Tooltip>,
      exportValue: (claim) => claimNet(Number(claim.gross_amount), Number(claim.dp_recovery_amount)) },
    { key: 'invoice', header: t('projectDetail.billing.claims.column.invoice', 'Invoice'), cell: (claim) => {
      const invoiceId = claim.invoice ? claim.id : null;
      const label = claim.withdrawn_at ? t('projectDetail.billing.claims.withdrawn', 'Withdrawn') : claim.invoice?.status ?? t('projectDetail.billing.claims.notRaised', 'Not raised');
      const variant: StatusVariant = claim.withdrawn_at ? 'lost' : claim.invoice?.status === 'Paid' ? 'won' : claim.invoice?.status === 'Unpaid' || claim.invoice?.status === 'Submitted' ? 'warn' : 'neutral';
      return <Tooltip content={t('projectDetail.billing.claims.source.invoice', 'Source: invoice status linked to this claim.') }>
        {invoiceId ? <Link to={`/sales-invoices/${encodeURIComponent(invoiceId)}`} className="cursor-help"><StatusPill variant={variant}>{claim.invoice?.si_number ?? label}</StatusPill></Link> : <StatusPill variant={variant}>{label}</StatusPill>}
      </Tooltip>;
    } },
    { key: 'evidence', header: t('projectDetail.billing.claims.column.evidence', 'Evidence'), align: 'num', kind: 'number',
      cell: (claim) => <Tooltip content={t('projectDetail.billing.claims.source.evidence', 'Source: linked evidence documents on the claim.') }><span className="cursor-help tabular-nums">{formatNumberExact(claim.evidence?.length ?? 0)}</span></Tooltip>,
      exportValue: (claim) => claim.evidence?.length ?? 0 },
  ];
  const orderlessInvoices = invoiceRows.filter((invoice) => !invoice.work_order_id);
  const orderlessColumns: Column<InvoiceWithWorkOrder>[] = [
    { key: 'invoice', header: t('projectDetail.cascade.invoiceNumber', 'Invoice'), kind: 'primary', rowHeader: true,
      cell: (invoice) => <span className="font-medium">{invoice.si_number ?? t('projectDetail.cascade.invoiceDraft', 'Invoice draft')}</span>,
      exportValue: (invoice) => invoice.si_number ?? '' },
    { key: 'date', header: t('projectDetail.cascade.invoiceDate', 'Date'), kind: 'date',
      cell: (invoice) => invoice.invoice_date ? <Tooltip content={t('projectDetail.cascade.invoiceDateSource', 'Source: invoice date from accounting.')}><span className="cursor-help tabular-nums">{formatDateOnly(invoice.invoice_date)}</span></Tooltip> : null,
      exportValue: (invoice) => invoice.invoice_date ?? '' },
    { key: 'amount', header: t('projectDetail.cascade.invoiceAmount', 'Amount'), kind: 'money', align: 'num',
      cell: (invoice) => invoice.amount === null ? null : <Tooltip content={t('projectDetail.cascade.source.invoiceAmount', 'Source: invoice amount mirrored from accounting.')}><span className="cursor-help tabular-nums">{formatNumberWhole(invoice.amount)}</span></Tooltip>,
      exportValue: (invoice) => invoice.amount ?? '' },
    { key: 'status', header: t('projectDetail.cascade.invoiceStatus', 'Status'), kind: 'status',
      cell: (invoice) => <StatusPill variant={invoice.status === 'Paid' ? 'won' : invoice.status === 'Unpaid' || invoice.status === 'Submitted' ? 'warn' : invoice.status === 'Cancelled' ? 'lost' : 'neutral'}>{invoice.status}</StatusPill>,
      exportValue: (invoice) => invoice.status },
    { key: 'paid', header: t('projectDetail.cascade.paid', 'Paid'), kind: 'money', align: 'num',
      cell: (invoice) => {
        const notApplicable = invoice.status === 'Draft' || invoice.status === 'Cancelled';
        const paid = invoiceBalanceFigures(invoice).paid;
        return notApplicable ? '—' : paid === null ? null : <Tooltip content={t('projectDetail.cascade.source.invoicePaid', 'Computed as invoice amount less accounting balance outstanding.')}><span className="cursor-help tabular-nums">{formatNumberWhole(paid)}</span></Tooltip>;
      } },
    { key: 'unpaid', header: t('projectDetail.cascade.unpaid', 'Unpaid'), kind: 'money', align: 'num',
      cell: (invoice) => {
        const notApplicable = invoice.status === 'Draft' || invoice.status === 'Cancelled';
        const unpaid = invoiceBalanceFigures(invoice).unpaid;
        return notApplicable ? '—' : unpaid === null ? null : <Tooltip content={t('projectDetail.cascade.source.invoiceUnpaid', 'Source: accounting balance outstanding for this invoice.')}><span className="cursor-help tabular-nums">{formatNumberWhole(unpaid)}</span></Tooltip>;
      } },
  ];
  const lineReadsPending = boq.isPending || projectBilling.isPending || lines.isPending;
  const lineReadsFailed = boq.isError || projectBilling.isError || lines.isError;
  const invoiceReadReady = !canViewBilling || (!invoicesQuery.isPending && !invoicesQuery.isError);

  useEffect(() => {
    setPoDrawerFor(openRecordType === 'workOrder' ? rows.find((row) => row.id === openRecordId) ?? null : null);
    setLineDrawerFor(openRecordType === 'workOrderLine' ? drawerLineRows.find((line) => line.key === openRecordId) ?? null : null);
    setInvoiceDrawerFor(openRecordType === 'workOrderInvoice' ? invoiceRows.find((invoice) => invoice.id === openRecordId) ?? null : null);
    setClaimDrawerFor(openRecordType === 'workOrderClaim' && canViewBilling ? claimRows.find((claim) => claim.id === openRecordId) ?? null : null);
  }, [openRecordId, openRecordType, rows, drawerLineRows, invoiceRows, claimRows, canViewBilling]);

  return (
    <div className="space-y-8">
      {canViewBilling && dpNotice !== null && (
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 id="pd-customer-orders" className="text-sm font-semibold text-foreground">
              {t('projectDetail.contract.orders', 'Customer orders')}
            </h2>
            {/* C6: currency named once for the orders below; every figure in them is a bare number. */}
            {/* AC-BWO-004: billing figures are net of tax — the basis is said once, here. */}
            {canViewBilling && <span className="text-xs text-muted-foreground">{currency} · <TaxBasisLabel treatment="exclusive" showDetails={false} className="whitespace-nowrap text-xs" testId="wo-billing-basis" /></span>}
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
              <Button variant="outline" size="sm" onClick={() => setFormFor(null)}>
                {t('projectDetail.workOrders.action.addCustomerOrder', 'Add customer order')}
              </Button>
            )}
            <ExportButton rows={filteredOrders} columns={orderExportColumns} entity="Customer orders"
              label={t('common.export', 'Export')} />
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[190px] flex-1 flex-col gap-1 text-xs text-muted-foreground sm:flex-none">
            {t('projectDetail.workOrders.filter.orders', 'Order')}
            <select aria-label={t('projectDetail.workOrders.filter.orders', 'Order')} value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)}
              className="min-h-10 min-w-0 rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <option value="all">{t('projectDetail.workOrders.filter.allOrders', 'All orders')}</option>
              {rows.map((row) => <option key={row.id} value={row.id}>{row.wo_number ?? row.title}</option>)}
            </select>
          </label>
          <label className="flex min-w-[160px] flex-col gap-1 text-xs text-muted-foreground">
            {t('projectDetail.workOrders.filter.status', 'Status')}
            <select aria-label={t('projectDetail.workOrders.filter.status', 'Status')} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as WorkOrderStatus | 'all')}
              className="min-h-10 min-w-0 rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              <option value="all">{t('projectDetail.workOrders.filter.allStatuses', 'All statuses')}</option>
              {(['Draft', 'Issued', 'Closed', 'Cancelled'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
        </div>
        {/* L6/C4: the "Still to invoice" total only adds information across several orders (one order's own line
            already says it); "Not yet submitted" is said only here. An incomplete total is left out — each order
            states why its figures are incomplete. */}
        {canViewBilling && <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" role="status">
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
            {!showQuantities && visibleCustomerOrders.length === 0 && visibleDraftOrders.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">
                {t('projectDetail.workOrders.emptyRegister', 'No customer orders yet. Client purchase orders are recorded here and draw down the project contract ceiling when issued.')}
              </p>
            )}
            {showQuantities && visibleCustomerOrders.length === 0 && visibleDraftOrders.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">
                {t('projectDetail.contract.noOrders', 'No customer orders yet.')}
              </p>
            )}

            {visibleDraftOrders.length > 0 && (
              <section aria-labelledby="pd-draft-orders" className="mb-6">
                <h3 id="pd-draft-orders" className="mb-2 text-xs font-medium text-muted-foreground">
                  {t('projectDetail.workOrders.drafts', 'Draft orders')}
                </h3>
                <ul className="divide-y divide-border/70">
                  {visibleDraftOrders.map((row) => {
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
                          <button type="button" data-wo-anchor={row.id} tabIndex={-1} className="rounded-sm text-left font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                            aria-label={t('projectDetail.workOrders.action.openDetails', 'View details for {{order}}', { order: row.wo_number ?? row.title })}
                            onClick={() => openPoDrawer(row)}>
                            {row.wo_number ?? row.title}
                          </button>
                          {row.wo_number && <span className="ml-2 text-sm text-muted-foreground">{row.title}</span>}
                          {row.client_po_number && <span className="ml-3 text-xs text-muted-foreground">{t('projectDetail.workOrders.clientPo', 'Customer PO')} {row.client_po_number}</span>}
                          {row.order_date && <span className="ml-3 text-xs text-muted-foreground">{t('projectDetail.workOrders.orderDate', 'Order date')} {formatDateOnly(row.order_date)}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {canEdit && <Button variant="ghost" size="sm" onClick={() => setFormFor(row)}>{t('projectDetail.workOrders.action.editOrder', 'Edit order')}</Button>}
                          {canSetValue && <Button variant="ghost" size="sm" onClick={() => setValueFor(row)}>{t('projectDetail.workOrders.action.setValue', 'Set value')}</Button>}
                          {issueBlocked && canTransition ? <GateNotice variant="blocked" className="max-w-sm px-2 py-1.5 text-xs">{issueGateBody}</GateNotice>
                            : canTransition && <Button variant="ghost" size="sm" onClick={() => setPending({ row, to: 'Issued' })}>{t('projectDetail.workOrders.action.issue', 'Issue')}</Button>}
                          {canTransition && <Button variant="ghost" size="sm" className="text-destructive-text" onClick={() => setPending({ row, to: 'Cancelled' })}>{t('projectDetail.workOrders.action.cancelGeneric', 'Cancel')}</Button>}
                          <MenuButton ariaLabel={t('projectDetail.workOrders.action.orderMenuLabel', 'Actions for {{order}}', { order: row.wo_number ?? row.title })} items={[
                            ...(canEdit ? [{ label: t('projectDetail.workOrders.action.editOrder', 'Edit order'), onClick: () => setFormFor(row) }] : []),
                            ...(canSetValue ? [{ label: t('projectDetail.workOrders.action.setValue', 'Set value'), onClick: () => setValueFor(row) }] : []),
                            ...(may('create', 'workOrderLine', { record: { status: row.status } }) ? [{ label: t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines'), onClick: () => setLinesFor(row) }] : []),
                            ...(!issueBlocked && canTransition ? [{ label: t('projectDetail.workOrders.action.issue', 'Issue'), onClick: () => setPending({ row, to: 'Issued' }) }] : []),
                            ...(canTransition ? [{ label: t('projectDetail.workOrders.action.cancelGeneric', 'Cancel'), danger: true, onClick: () => setPending({ row, to: 'Cancelled' }) }] : []),
                            { label: t('projectDetail.workOrders.action.viewPo', 'View customer PO'), onClick: () => openPoDrawer(row) },
                          ]} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {visibleCustomerOrders.map((row) => {
              const orderAllocations = (projectBilling.data?.contractLines ?? []).flatMap((line) =>
                line.allocations.filter((allocation) => allocation.workOrderId === row.id).map((allocation) => ({ line, allocation })),
              );
              const rawLines = allocationsByWo.get(row.id) ?? [];
              const hasOrderLines = orderAllocations.length > 0 || rawLines.length > 0;
              const orderLineFactsReady = !lineReadsPending && !lineReadsFailed && (!hasOrderLines || Boolean(projectBilling.data));
              const bastList = acceptancesByWo.get(row.id) ?? [];
              const pendingBast = [...bastList].filter((acceptance) => acceptance.status === 'Draft')
                .sort((a, b) => b.prepared_at.localeCompare(a.prepared_at))[0];
              const billingRow = billingById.get(row.id);
              const orderInvoices = invoicesByWo.get(row.id) ?? [];
              // NFR-BWO-005: no figures until BOTH the invoices and the order billing are read — a pending or failed
              // billing read must not look like an order with nothing invoiced.
              const settlement = invoiceReadReady && !billing.isPending && !billing.isError ? summarizeInvoiceSettlement(orderInvoices) : null;
              // SUB-C: invoiced / paid / unpaid appear once something has been invoiced.
              const hasInvoiced = (settlement?.invoiced ?? 0) > 0;
              const canPrepare = canPrepareForOrder(row);
              const canConfirm = Boolean(pendingBast) && may('confirm', 'workOrderAcceptance', {
                currentUserId: currentUser?.id,
                record: { status: pendingBast?.status, prepared_by: pendingBast?.prepared_by },
              });
              const canEdit = may('edit', 'workOrder', { record: { status: row.status } });
              const canTransition = may('transition', 'workOrder');
              const invoiceForOrder = billingRow && canInvoiceWorkOrder(row.status, billingRow);
              const canRaiseOrderInvoice = Boolean((hasOrderLines ? canBill : canInvoice) && invoiceForOrder && billingRow && billingRow.remaining > 0);
              const orderFiguresComplete = Boolean(settlement)
                && settlement?.invoiced !== null
                && settlement?.balancesKnown
                && billingRow?.figuresComplete !== false;
              const orderFiguresMissing = canViewBilling && !orderFiguresComplete;
              const billingState = billingRow ? deriveWorkOrderBillingState(row.status, billingRow) : null;
              const workOrderStatusTone: StatusVariant = row.status === 'Closed' ? 'won' : row.status === 'Cancelled' ? 'lost' : 'progress';
              const latestConfirmedBast = bastList.find((acceptance) => acceptance.status === 'Confirmed');
              const orderOverdue = orderInvoices.reduce((sum, invoice) => {
                if (!invoice.erp_due_date || invoice.erp_due_date >= todayIso() || invoice.status === 'Draft' || invoice.status === 'Cancelled') return sum;
                const balance = invoice.status === 'Paid' ? 0 : invoice.erp_outstanding_amount;
                return balance === null ? sum : sum + Math.max(0, balance);
              }, 0);
              const raiseOrderInvoice = () => {
                if (!billingRow) return;
                setCreatedInvoice(null);
                if (hasOrderLines) setClaimFor(row);
                else setInvoiceFor({ row, remaining: billingRow.remaining });
              };
              const canEditLines = may('create', 'workOrderLine', { record: { status: row.status } });
              const orderActions: RowMenuItem[] = [
                ...(canPrepare ? [{ label: t('projectDetail.workOrders.action.recordDelivery', 'Record delivery'), onClick: () => setBastFor({ row, draft: null }) }] : []),
                ...(canConfirm && pendingBast ? [{ label: t('projectTabs:contractQuantities.workOrders.acceptances.confirmDelivery', 'Confirm draft BAST'), onClick: () => setConfirmFor({ acceptance: pendingBast, error: null }) }] : []),
                ...(canRaiseOrderInvoice ? [{ label: t('projectDetail.workOrders.billing.invoiceAction', 'Raise invoice'), onClick: raiseOrderInvoice }] : []),
                ...(canEditLines ? [{ label: t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines'), onClick: () => setLinesFor(row) }] : []),
                ...(row.client_po_number ? [{ label: t('projectDetail.workOrders.action.viewPo', 'View customer PO'), onClick: () => openPoDrawer(row) }] : []),
                ...(canEdit ? [{ label: t('projectDetail.workOrders.action.editOrder', 'Edit order'), onClick: () => setFormFor(row) }] : []),
                ...(row.status === 'Issued' && canTransition && !closeByBast(row.id) ? [{ label: t('projectDetail.workOrders.action.close', 'Close order'), onClick: () => setPending({ row, to: 'Closed' }) }] : []),
                ...((row.status === 'Issued' || row.status === 'Draft') && canTransition ? [{ label: t('projectDetail.workOrders.action.cancel', 'Cancel order'), danger: true, onClick: () => setPending({ row, to: 'Cancelled' }) }] : []),
              ];
              const orderLineRows = drawerLineRows.filter((line) => line.order.id === row.id);
              const lineColumns: Column<OrderLineView>[] = [
                {
                  key: 'item', header: t('projectDetail.cascade.colItem', 'Item'), kind: 'primary', rowHeader: true,
                  cell: (line) => <span>{line.item?.item_code ? <span className="mr-2 text-xs text-muted-foreground">{line.item.item_code}</span> : null}{line.item?.description ?? line.allocation.boqItemId}</span>,
                  secondaryCell: (line) => t('projectDetail.cascade.contractQuantity', 'Contract quantity {{quantity}} {{unit}}', { quantity: formatNumberExact(line.allocation.quantity), unit: line.item?.unit ?? '' }),
                },
                { key: 'unit', header: t('projectDetail.cascade.colUnit', 'Unit'), cell: (line) => <span className="text-muted-foreground">{line.item?.unit ?? '—'}</span>, kind: 'meta' },
                ...(canViewBilling ? [{ key: 'rate', header: t('projectDetail.cascade.colRate', 'Rate'), align: 'num' as const, kind: 'money' as const,
                  cell: (line: OrderLineView) => <Tooltip content={t('projectDetail.cascade.source.rate', 'Source: the rate on this bill of quantities line.') }><span className="cursor-help tabular-nums">{line.rate === null ? '—' : formatNumberWhole(line.rate)}</span></Tooltip>,
                  exportValue: (line: OrderLineView) => line.rate ?? '',
                }] : []),
                { key: 'ordered', header: t('projectDetail.cascade.colOrdered', 'Ordered'), align: 'num', kind: 'number', cell: (line) => <Tooltip content={t('projectDetail.cascade.source.lineOrdered', 'Source: quantity allocated to this work order.') }><span className="cursor-help tabular-nums">{formatNumberExact(line.allocation.quantity)}</span></Tooltip>, exportValue: (line) => line.allocation.quantity },
                { key: 'delivered', header: t('projectDetail.cascade.colDelivered', 'Delivered'), cell: (line) => {
                  const deliveredQuantity = line.allocation.acceptedQuantity;
                  const short = deliveredQuantity !== null && deliveredQuantity < line.allocation.quantity && line.allocation.final;
                  const percentDone = deliveredQuantity === null || line.allocation.quantity <= 0 ? null : Math.round(deliveredQuantity / line.allocation.quantity * 100);
                  return <div className="min-w-24">
                    <Tooltip content={t('projectDetail.cascade.source.lineDelivered', 'Source: total quantity accepted on confirmed BASTs for this work order.') }>
                      <span data-testid={`contract-accepted-${line.allocation.boqItemId}`} className={cn('cursor-help tabular-nums', short && 'text-warning-foreground')}>
                        {deliveredQuantity === null ? '—' : `${formatNumberExact(deliveredQuantity)} ${line.item?.unit ?? ''}`}
                      </span>
                    </Tooltip>
                    {percentDone !== null && <Tooltip content={t('projectDetail.cascade.source.lineDeliveryProgress', 'Accepted quantity ÷ ordered quantity. A final short delivery is flagged.') }>
                      <span className="mt-1 block w-full max-w-24 cursor-help"><ProgressBar value={percentDone} widthless aria-label={t('projectDetail.cascade.deliveryProgress', 'Delivered percentage')} /></span>
                    </Tooltip>}
                    {short && <span className="block text-[11px] text-warning-foreground">{t('projectDetail.cascade.short', '({{n}} short)', { n: formatNumberExact(line.allocation.quantity - deliveredQuantity) })}</span>}
                  </div>;
                }, exportValue: (line) => line.allocation.acceptedQuantity ?? '' },
                { key: 'invoiced', header: t('projectDetail.cascade.colInvoiced', 'Invoiced'), align: 'num', kind: 'number', cell: (line) => <Tooltip content={t('projectDetail.cascade.source.lineInvoiced', 'Source: quantity already claimed against this work order allocation.') }><span className="cursor-help tabular-nums">{formatNumberExact(line.allocation.claimedQuantity)}</span></Tooltip>, exportValue: (line) => line.allocation.claimedQuantity },
                { key: 'canInvoice', header: t('projectDetail.cascade.colCanInvoice', 'Can invoice'), align: 'num', kind: 'number', cell: (line) => <Tooltip content={t('projectDetail.cascade.source.lineCanInvoice', 'Accepted quantity less already claimed quantity. No figure appears until a BAST is confirmed.') }><span className="cursor-help tabular-nums font-semibold">{line.allocation.acceptedQuantity === null ? '—' : formatNumberExact(Math.max(0, line.allocation.acceptedQuantity - line.allocation.claimedQuantity))}</span></Tooltip>, exportValue: (line) => line.allocation.acceptedQuantity === null ? '' : Math.max(0, line.allocation.acceptedQuantity - line.allocation.claimedQuantity) },
              ];

              return (
                <article key={row.id} data-testid={`customer-order-${row.id}`} className="min-w-0 rounded-md border border-border p-4">
                  <header className="flex flex-col gap-3">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 data-wo-anchor={row.id} tabIndex={-1}
                        className="rounded-sm text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <button type="button"
                          className="touch-target rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                          aria-label={t('projectDetail.workOrders.action.openDetails', 'View details for {{order}}', { order: row.wo_number ?? row.title })}
                          onClick={() => openPoDrawer(row)}>
                          {row.wo_number ?? t('projectDetail.workOrders.notYetIssued', 'Not issued yet')}
                        </button>
                      </h3>
                      <span className="min-w-0 break-words text-sm text-foreground">{row.title}</span>
                      <StatusPill variant={workOrderStatusTone}>{row.status}</StatusPill>
                      {canViewBilling && billingState && billingState !== 'not-billable' && <StatusPill variant={billingStateTones[billingState]}>
                        {billingStateLabels[billingState]}
                      </StatusPill>}
                      {row.client_po_number && <span className="text-xs text-muted-foreground">{t('projectDetail.workOrders.clientPo', 'Customer PO')} {row.client_po_number}</span>}
                      {row.order_date && <span className="text-xs text-muted-foreground">{t('projectDetail.workOrders.orderDate', 'Order date')} {formatDateOnly(row.order_date)}</span>}
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        {canRaiseOrderInvoice && billingRow && <Tooltip content={`${t('projectDetail.workOrders.billing.orderRemainingSource', 'Source: work-order billing balance after invoices and pending drafts.')} ${t('common:projectDetail.workOrders.billing.lineNet', 'Net value {{amount}}', { amount: formatNumberWhole(billingRow.orderNet) })}`}>
                          {/* L6: the amount is the order's "Still to invoice" figure below; the action does not repeat it. */}
                          <Button variant="primary" size="sm" onClick={raiseOrderInvoice}>
                            {t('projectDetail.workOrders.billing.invoiceAction', 'Raise invoice')}
                          </Button>
                        </Tooltip>}
                        {canPrepare && <Button variant="outline" size="sm" onClick={() => setBastFor({ row, draft: null })}>
                          {t('projectDetail.workOrders.action.recordDelivery', 'Record delivery')}
                        </Button>}
                        {orderActions.length > 0 && <MenuButton items={orderActions} ariaLabel={t('projectDetail.workOrders.action.orderMenuLabel', 'Actions for {{order}}', { order: row.wo_number ?? row.title })} />}
                      </div>
                    </div>

                    {canViewBilling && <dl className="flex flex-wrap gap-x-6 gap-y-2" data-testid={`wo-money-${row.id}`} aria-label={t('common:projectDetail.workOrders.billing.column', 'Billing')}>
                      {/* AC-BWO-004: what is still to invoice leads, ahead of invoiced and paid. */}
                      {billingRow?.figuresComplete && row.status !== 'Draft' && row.status !== 'Cancelled' && <div className="min-w-0 text-xs">
                          <dt className="sr-only">{t('common:projectDetail.workOrders.billing.stillToInvoice', 'Still to invoice')}</dt>
                          <dd data-testid={`wo-still-${row.id}`} className="cursor-help text-muted-foreground tabular-nums"><Tooltip content={t('projectDetail.workOrders.billing.pendingNote', 'Drafts and unraised claims count as not yet invoiced.') }><span>{billingRow.remaining < 0
                            ? t('common:projectDetail.workOrders.billing.lineOver', 'Over by {{amount}}', { amount: formatNumberWhole(Math.abs(billingRow.remaining)) })
                            : t('common:projectDetail.workOrders.billing.lineRemaining', 'Still to invoice {{amount}}', { amount: formatNumberWhole(billingRow.remaining) })}</span></Tooltip></dd>
                        </div>}
                      {row.status === 'Closed' && row.closing_value !== null && row.closing_value !== undefined && <div className="min-w-0 text-xs">
                        <dt className="sr-only">{t('projectDetail.workOrders.closingValue', 'Closing value')}</dt>
                        <dd data-testid={`wo-closing-${row.id}`} className="text-muted-foreground tabular-nums">
                          {t('projectTabs:contractQuantities.workOrders.closing.closedAt', 'Closed at {{amount}} (excl. PPN)', {
                            amount: formatCurrency(Number(row.closing_value), currency),
                            interpolation: { escapeValue: false },
                          })}
                        </dd>
                      </div>}
                      {hasInvoiced && settlement?.invoiced !== null && settlement?.invoiced !== undefined && billingRow?.figuresComplete !== false && <MoneyFigure label={t('common:projectDetail.workOrders.billing.invoiced', 'Invoiced')} value={formatNumberWhole(settlement.invoiced)} detail={settlement.balancesKnown
                        ? t('common:projectDetail.workOrders.billing.lineInvoiced', 'Invoiced {{invoiced}} · paid {{paid}}', { invoiced: formatNumberWhole(settlement.invoiced), paid: formatNumberWhole(settlement.paid) })
                        : t('projectDetail.cascade.source.invoiced', 'Source: non-draft, non-cancelled invoice amounts.')} />}
                      {hasInvoiced && settlement?.balancesKnown && billingRow?.figuresComplete !== false && <MoneyFigure label={t('common:projectDetail.workOrders.billing.paid', 'Paid')} value={formatNumberWhole(settlement.paid)} detail={t('projectDetail.cascade.source.paid', 'Source: invoice amount less the accounting balance outstanding.')} />}
                      {hasInvoiced && settlement?.unpaid !== null && settlement?.unpaid !== undefined && billingRow?.figuresComplete !== false && <MoneyFigure label={t('projectDetail.cascade.unpaid', 'Unpaid')} value={formatNumberWhole(settlement.unpaid)} detail={t('projectDetail.cascade.source.invoiceUnpaid', 'Source: accounting balance outstanding for this invoice.')} destructive={settlement.unpaid > 0} />}
                    </dl>}

                    {orderFiguresMissing && <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role={invoicesQuery.isError || billing.isError ? 'alert' : 'status'}>
                      <span>{invoicesQuery.isError || billing.isError
                        ? billing.isError
                          ? t('common:projectDetail.workOrders.billing.loadError', "Couldn't load billing for these work orders")
                          : t('projectDetail.cascade.invoiceError', "Couldn't load invoice figures.")
                        : invoicesQuery.isPending || billing.isPending
                          ? t('projectDetail.cascade.invoiceLoading', 'Invoice figures are loading.')
                          : t('projectDetail.workOrders.billing.figuresIncomplete', 'Invoice figures are incomplete.')}</span>
                      <button type="button" className="touch-target min-h-8 rounded-sm text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" aria-label={t('projectDetail.workOrders.billing.retryFigures', 'Retry invoice figures')} onClick={() => { void invoicesQuery.refetch(); void billing.refetch(); }}>
                        {t('common.retry', 'Retry')}
                      </button>
                    </p>}

                    {canViewBilling && billingRow?.figuresComplete === false && <div className="text-xs text-muted-foreground" role="note">
                      <p>{t('common:projectDetail.workOrders.billing.incompleteNote', 'An invoice on one of these work orders has no amount or is in another currency, so the totals cannot be added up.')}</p>
                      {billingRow.problems && billingRow.problems.length > 0 && <ul className="mt-1 list-inside list-disc">
                        {billingRow.problems.map((problem) => {
                          const invoiceName = problem.number
                            ? `${t('common:projectDetail.workOrders.billing.cause.anInvoice', 'An invoice')} ${problem.number}`
                            : t('common:projectDetail.workOrders.billing.cause.anInvoice', 'An invoice');
                          return <li key={problem.recordId}>{problem.cause === 'no-amount'
                            ? t('common:projectDetail.workOrders.billing.cause.noAmount', '{{number}} has no amount', { number: invoiceName })
                            : t('common:projectDetail.workOrders.billing.cause.otherCurrency', '{{number}} is in {{currency}}', { number: invoiceName, currency: problem.currency ?? '—' })}</li>;
                        })}
                      </ul>}
                    </div>}

                    {canViewBilling && orderOverdue > 0 && <Tooltip content={t('projectDetail.cascade.source.overdue', 'Sum of positive outstanding balances on invoices past their ERP due date.')}>
                      <span className="inline-flex w-fit cursor-help items-center gap-2 text-xs text-warning-foreground tabular-nums">
                        <StatusPill variant="overdue">{t('projectDetail.cascade.overdue', 'Overdue')}</StatusPill>
                        <strong>{formatNumberWhole(orderOverdue)}</strong>
                      </span>
                    </Tooltip>}
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
                    <div className="mt-4" data-testid={`wo-lines-table-scroll-${row.id}`}>
                      <DataTable<OrderLineView>
                        rows={orderLineRows}
                        columns={lineColumns}
                        rowKey={(line) => line.key}
                        rowLabel={(line) => t('projectDetail.cascade.openLine', 'Open {{item}} quantity history', { item: line.item?.description ?? line.allocation.boqItemId })}
                        accessibleName={t('projectDetail.cascade.linesScroll', 'Contract quantities for {{wo}}', { wo: row.wo_number ?? row.title })}
                        onActivate={openLineDrawer}
                        embedded
                        rowMenu={(line) => [
                          { label: t('projectDetail.cascade.viewQuantityHistory', 'View quantity history'), onClick: () => openLineDrawer(line) },
                          ...(canEditLines ? [{ label: t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines'), onClick: () => setLinesFor(row) }] : []),
                        ]}
                        cardBelow={720}
                        tableId={`project-detail-contract-order-${row.id}`}
                      />
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">{t('projectDetail.cascade.moneyOnly', 'Money-only order')}</p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.acceptances.heading', 'BAST state')}</span>
                      {pendingBast ? <StatusPill variant="warn">{t('projectDetail.cascade.pendingAcceptance', 'Delivery awaiting confirmation')}</StatusPill>
                        : latestConfirmedBast ? <StatusPill variant="won">{latestConfirmedBast.is_final
                          ? t('projectTabs:contractQuantities.workOrders.acceptances.finalConfirmed', 'Final confirmed')
                          : t('projectTabs:contractQuantities.workOrders.acceptances.confirmed', 'Confirmed')}</StatusPill>
                          : <StatusPill variant="neutral">{t('projectDetail.cascade.noBast', 'No BAST yet')}</StatusPill>}
                    </div>
                    {canViewBilling && <div className="flex flex-wrap items-center gap-2" aria-label={t('projectDetail.cascade.invoiceStatusLabel', 'Invoice status')}>
                      <span className="text-muted-foreground">{t('projectDetail.cascade.invoices', 'Invoices')}</span>
                      {orderInvoices.length === 0 ? <span className="text-muted-foreground">—</span> : orderInvoices.map((invoice) => {
                        const tone: StatusVariant = invoice.status === 'Paid' ? 'won'
                          : invoice.status === 'Unpaid' || invoice.status === 'Submitted' ? 'warn'
                            : invoice.status === 'Cancelled' ? 'lost' : 'neutral';
                        return <Tooltip key={invoice.id} content={t('projectDetail.cascade.invoicePillSource', 'Source: invoice status mirrored from accounting.') }>
                          <button type="button" className="touch-target rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" aria-label={t('projectDetail.cascade.openInvoice', 'Open invoice {{invoice}}', { invoice: invoice.si_number ?? invoice.status })} onClick={() => openInvoiceDrawer(invoice)}>
                            <span className="mr-1 text-[11px] text-muted-foreground">{invoice.si_number ?? t('projectDetail.cascade.invoiceDraft', 'Invoice draft')}</span>
                            <StatusPill variant={tone}>{invoice.status}</StatusPill>
                          </button>
                        </Tooltip>;
                      })}
                    </div>}
                  </div>

                  <div className="mt-4 flex flex-col gap-3">
                    {lines.isError && <ListState variant="error" title={t('projectTabs:contractQuantities.workOrders.contractLines.loadError', 'Couldn’t load the contract lines')} onRetry={() => void lines.refetch()} />}
                    {acceptancesQuery.isError && <ListState variant="error" title={t('projectTabs:contractQuantities.workOrders.acceptances.error', 'Couldn’t load the BASTs')} onRetry={() => void acceptancesQuery.refetch()} />}
                    {(hasOrderLines || bastList.length > 0 || canPrepare || row.status === 'Issued') && (
                      <details className="group">
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          {t('projectTabs:contractQuantities.workOrders.quantities.summary', 'Contract lines and BAST — {{wo}}', { wo: row.wo_number ?? row.title })}
                          <span className="ml-2">{t('projectTabs:contractQuantities.workOrders.quantities.counts', '{{lines}} lines · {{basts}} BAST', { lines: rawLines.length, basts: bastList.length })}</span>
                        </summary>
                        <div className="mt-3 flex flex-col gap-4">
                          {!hasOrderLines && row.status === 'Issued' && <section aria-label={t('projectTabs:contractQuantities.workOrders.contractLines.heading', 'Contract lines')}>
                            <p className="text-[13px] text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.acceptances.form.noAllocations', 'Allocate contract lines to this work order first.')}</p>
                            {canEditLines && <Button variant="outline" size="sm" className="mt-2" onClick={() => setLinesFor(row)}>
                              {t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines')}
                            </Button>}
                          </section>}
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
                              hasAllocations={rawLines.length > 0}
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

      {canViewBilling && <Card variant="bare" className="min-w-0">
        <CardHead level={2} className="text-base" actions={<div className="flex flex-wrap items-center gap-2">
          {canAssess && boqRows.length > 0 && <Button variant="outline" size="sm" onClick={() => setAssessOpen(true)}>
            {t('projectDetail.billing.assessment.record', 'Record progress')}
          </Button>}
          {canRecordPercent && <Button variant="outline" size="sm" onClick={() => setPercentOpen(true)}>
            {t('projectDetail.billing.assessment.record', 'Record progress')}
          </Button>}
          {canBill && <Button variant="primary" size="sm" onClick={() => setNewClaimOpen(true)}>
            {t('projectDetail.billing.claims.new', 'New claim')}
          </Button>}
        </div>}>
          {t('projectDetail.billing.claims.title', 'Claims & down payment')}
        </CardHead>
        <CardPad>
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border pb-4 sm:grid-cols-3">
            {/* C4: an unknown figure is left out, never a "—"; N13: billing ahead of the work done reads as that, not a negative. */}
            {summary?.unbilledWork !== null && summary?.unbilledWork !== undefined && <div data-testid="claims-gap">
              <dt className="text-xs text-muted-foreground">{summary.unbilledWork < 0
                ? t('projectDetail.billing.summary.billedAhead', 'Billed ahead of progress')
                : t('projectDetail.billing.summary.gap', 'Work done, not yet billed')}</dt>
              <dd className="mt-1 w-fit cursor-help text-base font-semibold tabular-nums"><Tooltip content={t('projectDetail.billing.claims.source.unbilled', 'Computed as earned work from the latest assessment or accepted quantities, less work billed to date.') }><span>{formatNumberWhole(Math.abs(summary.unbilledWork))}</span></Tooltip></dd>
            </div>}
            {summary && <div>
              <dt className="text-xs text-muted-foreground">{t('projectDetail.billing.summary.dpHeld', 'Down payment held')}</dt>
              <dd className="mt-1 w-fit cursor-help text-base font-semibold tabular-nums"><Tooltip content={t('projectDetail.billing.claims.source.dpHeld', 'Computed as invoiced down payment less recovered down payment.') }><span>{formatNumberWhole(summary.dpHeld)}</span></Tooltip></dd>
            </div>}
          </dl>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('projectDetail.billing.claims.evidenceFirst', 'Claims need evidence attached before an invoice draft can be raised.')}
          </p>
          <details className="mb-4 border-b border-border pb-4">
            <summary className="touch-target w-fit cursor-pointer rounded-sm text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              {t('projectDetail.billing.summary.details', 'Billing summary details')}
            </summary>
            {summary ? <dl data-testid="work-orders-billing-detail" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <MoneyFigure label={t('projectDetail.billing.summary.billed', 'Billed to date')} value={formatNumberWhole(summary.workBilled)} detail={t('projectDetail.billing.source.billed', 'Source: work and down-payment claims billed to date.')} />
              <MoneyFigure label={t('projectDetail.billing.summary.contract', 'Contract value')} value={formatNumberWhole(summary.contractNet)} detail={t('projectDetail.billing.source.contract', 'Source: net contract value from the project billing summary.')} />
              <MoneyFigure label={t('projectDetail.billing.summary.remaining', 'Contract not yet billed')} value={formatNumberWhole(summary.remaining)} detail={t('projectDetail.billing.source.remaining', 'Computed as net contract value less claims billed to date.')} />
              <MoneyFigure label={t('projectDetail.billing.summary.assessed', 'Assessed to date')} value={summary.assessedToDate === null ? '—' : formatNumberWhole(summary.assessedToDate)} detail={t('projectDetail.billing.source.assessed', 'Source: earned contract line value or the latest recorded progress assessment.')} />
              {summary.assessment && <p className="col-span-2 text-xs text-muted-foreground sm:col-span-3" data-testid="work-orders-assessment-period">
                {t('projectDetail.billing.summary.assessedAsOf', 'as of {{month}}, {{pct}}% complete', { month: formatUtcMonthYear(new Date(`${summary.assessment.month}T00:00:00Z`)), pct: formatNumberExact(summary.assessment.pctComplete) })}
              </p>}
              {!summary.assessment && <p className="col-span-2 text-xs text-muted-foreground sm:col-span-3" data-testid="work-orders-no-assessment">{t('projectTabs:contractQuantities.billing.summary.noAssessment', 'No assessment yet')}</p>}
              <MoneyFigure label={t('projectDetail.billing.summary.notSubmitted', 'Claims raised, not yet submitted')} value={formatNumberWhole(summary.notSubmitted)} detail={t('projectDetail.billing.source.notSubmitted', 'Source: claim invoices created in accounting but not yet submitted.')} />
            </dl> : <p className="mt-3 text-sm text-muted-foreground">{t('projectDetail.billing.summary.unavailable', 'Billing summary is unavailable.')}</p>}
          </details>
          <DataTable<ProgressClaimWithInvoice>
            rows={claimRows}
            columns={projectClaimColumns}
            rowKey={(claim) => claim.id}
            rowLabel={(claim) => t('projectDetail.billing.claims.openLabel', 'Open {{kind}} claim from {{date}}', {
              kind: claim.kind === 'down_payment' ? t('projectDetail.billing.claims.kind.downPayment', 'Down payment') : t('projectDetail.billing.claims.kind.progress', 'Progress'),
              date: formatDateOnly(claim.created_at),
            })}
            accessibleName={t('projectDetail.billing.claims.title', 'Claims & down payment')}
            onActivate={openClaimDrawer}
            rowMenu={(claim) => {
              const open = !claim.withdrawn_at && !claim.invoice;
              return [
                ...(open && canBill ? [{ label: t('projectDetail.billing.claims.attachEvidence', 'Attach evidence'), onClick: () => setEvidenceFor(claim.id) }] : []),
                ...(open && canBill && (claim.evidence?.length ?? 0) > 0 ? [{ label: t('projectDetail.billing.claims.raise', 'Raise invoice'), onClick: () => setRaiseFor({ claim, idempotencyKey: crypto.randomUUID() }) }] : []),
                ...(open && canBill ? [{ label: t('projectDetail.billing.claims.withdraw', 'Withdraw'), danger: true, onClick: () => setWithdrawClaimFor(claim) }] : []),
              ];
            }}
            state={claimsQuery.isPending ? 'loading' : claimsQuery.isError ? 'error' : claimRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('projectDetail.billing.claims.empty', 'No billing claims yet')}
            emptySub={t('projectDetail.billing.claims.emptySub', 'A claim bills a down payment or accepted quantities as one invoice.')}
            errorTitle={t('projectDetail.billing.claims.error', 'Couldn’t load the billing claims')}
            errorSub={t('projectDetail.billing.claims.errorSub', 'Retry, or reopen the project.')}
            onRetry={() => void claimsQuery.refetch()}
            cardBelow={720}
            tableId="project-detail-claims-register"
          />
        </CardPad>
      </Card>}

      {canViewBilling && (orderlessInvoices.length > 0 || ((!customerOrders.length && !draftOrders.length) && !invoiceReadReady)) && <section className="min-w-0" role="region" aria-label={t('projectDetail.workOrders.billing.orderlessHeading', 'Invoices without a customer order')} data-testid="orderless-invoices">
        <div className="mb-3 border-b border-border pb-2">
          <h2 className="text-sm font-semibold text-foreground">{t('projectDetail.workOrders.billing.orderlessHeading', 'Invoices without a customer order')}</h2>
        </div>
        {invoicesQuery.isPending ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">
            <span>{t('projectDetail.cascade.invoiceLoading', 'Invoice figures are loading.')}</span>
          </p>
        ) : invoicesQuery.isError ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="alert">
            <span>{t('projectDetail.cascade.invoiceError', "Couldn't load invoice figures.")}</span>
            <button type="button" className="touch-target min-h-8 rounded-sm text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => void invoicesQuery.refetch()}>{t('common.retry', 'Retry')}</button>
          </p>
        ) : <>
          {orderlessInvoices.some((invoice) => invoice.status !== 'Draft' && invoice.status !== 'Cancelled' && (invoice.amount === null || invoice.erp_outstanding_amount === null)) && <p className="mb-2 text-xs text-muted-foreground" role="status">
            {t('projectDetail.workOrders.billing.orderlessFiguresIncomplete', 'Paid and unpaid amounts will appear once the accounting system reports an invoice balance.')}
          </p>}
          {/* F10: the shared DataTable (resizable columns, mobile cards, row → drawer). */}
          <DataTable<InvoiceWithWorkOrder>
            rows={orderlessInvoices}
            columns={orderlessColumns}
            rowKey={(invoice) => invoice.id}
            rowLabel={(invoice) => t('projectDetail.cascade.openInvoice', 'Open invoice {{invoice}}', { invoice: invoice.si_number ?? invoice.status })}
            onActivate={openInvoiceDrawer}
            accessibleName={t('projectDetail.workOrders.billing.orderlessHeading', 'Invoices without a customer order')}
            cardBelow={720}
            tableId="project-detail-orderless-invoices"
          />
        </>}
      </section>}

      {deliverySelectorOpen && <Drawer open title={t('projectDetail.workOrders.action.recordDelivery', 'Record delivery')} onClose={() => setDeliverySelectorOpen(false)}>
        <div className="flex flex-col gap-2 p-4">
          <p className="text-sm text-muted-foreground">{t('projectDetail.workOrders.delivery.chooseOrder', 'Choose the customer order receiving this delivery.')}</p>
          {deliveryCandidates.map((order) => <Button key={order.id} variant="outline" className="justify-start" onClick={() => {
            setDeliverySelectorOpen(false);
            setBastFor({ row: order, draft: null });
          }}>{order.wo_number ?? order.title} · {order.title}</Button>)}
        </div>
      </Drawer>}

      {lineDrawerFor && (() => {
        const selected = lineDrawerFor;
        const fact = projectBilling.data?.contractLines.find((line) => line.boqItemId === selected.allocation.boqItemId);
        const split = fact?.allocations ?? [];
        const history = (acceptancesByWo.get(selected.order.id) ?? []).flatMap((acceptance) => acceptance.lines
          .filter((line) => line.boq_item_id === selected.allocation.boqItemId)
          .map((line) => ({ acceptance, quantity: Number(line.quantity) })));
        return <Drawer open title={selected.item?.description ?? selected.allocation.boqItemId}
          subtitle={`${selected.item?.item_code ?? ''}${selected.item?.unit ? ` · ${selected.item.unit}` : ''}`}
          status={<StatusPill variant={selected.order.status === 'Closed' ? 'won' : 'progress'}>{selected.order.status}</StatusPill>}
          onClose={() => closeOpenRecord(selected.key, 'workOrderLine')}
          headerActions={<div className="flex flex-wrap items-center gap-2">
            {may('create', 'workOrderLine', { record: { status: selected.order.status } }) && <Button variant="outline" size="sm" onClick={() => {
              closeOpenRecord(selected.key, 'workOrderLine');
              setLinesFor(selected.order);
            }}>{t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines')}</Button>}
            <Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/projects/${encodeURIComponent(projectId)}/work-orders?wo=${encodeURIComponent(selected.order.id)}`} onClick={() => closeOpenRecord(selected.key, 'workOrderLine')}>
              {t('projectDetail.drawer.openFullPage', 'Open full page')}
            </Link>
          </div>}>
          <div className="flex flex-col gap-5 p-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <QuantityFigure label={t('projectDetail.cascade.colOrdered', 'Ordered')} value={`${formatNumberExact(selected.allocation.quantity)} ${selected.item?.unit ?? ''}`} detail={t('projectDetail.cascade.source.lineOrdered', 'Source: quantity allocated to this work order.')} />
              <QuantityFigure label={t('projectDetail.cascade.colDelivered', 'Delivered')} value={selected.allocation.acceptedQuantity === null ? '—' : `${formatNumberExact(selected.allocation.acceptedQuantity)} ${selected.item?.unit ?? ''}`} detail={t('projectDetail.cascade.source.lineDelivered', 'Source: total quantity accepted on confirmed BASTs for this work order.')} />
              <QuantityFigure label={t('projectDetail.cascade.colInvoiced', 'Invoiced')} value={`${formatNumberExact(selected.allocation.claimedQuantity)} ${selected.item?.unit ?? ''}`} detail={t('projectDetail.cascade.source.lineInvoiced', 'Source: quantity already claimed against this work order allocation.')} />
              <QuantityFigure label={t('projectDetail.cascade.colCanInvoice', 'Can invoice')} value={selected.allocation.acceptedQuantity === null ? '—' : `${formatNumberExact(Math.max(0, selected.allocation.acceptedQuantity - selected.allocation.claimedQuantity))} ${selected.item?.unit ?? ''}`} detail={t('projectDetail.cascade.source.lineCanInvoice', 'Accepted quantity less already claimed quantity. No figure appears until a BAST is confirmed.')} />
              {canViewBilling && selected.rate !== null && <QuantityFigure label={t('projectDetail.cascade.colRate', 'Rate')} value={formatCurrency(selected.rate, currency)} detail={t('projectDetail.cascade.source.rate', 'Source: the rate on this bill of quantities line.')} />}
            </dl>
            <section aria-labelledby="line-order-split">
              <h4 id="line-order-split" className="mb-2 text-sm font-semibold">{t('projectDetail.cascade.lineSplit', 'Per-order split')}</h4>
              {split.length === 0 ? <p className="text-sm text-muted-foreground">{t('projectDetail.cascade.noLineSplit', 'No order allocation history is available.')}</p> : <ul className="divide-y divide-border border-y border-border text-sm">
                {split.map((allocation) => {
                  const order = rows.find((candidate) => candidate.id === allocation.workOrderId);
                  return <li key={allocation.workOrderId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{order?.wo_number ?? order?.title ?? allocation.workOrderId}</span>
                    <Tooltip content={t('projectDetail.cascade.source.lineOrdered', 'Source: quantity allocated to this work order.')}>
                      <span className="cursor-help tabular-nums">{formatNumberExact(allocation.quantity)} {selected.item?.unit ?? ''}</span>
                    </Tooltip>
                  </li>;
                })}
              </ul>}
            </section>
            <section aria-labelledby="line-quantity-history">
              <h4 id="line-quantity-history" className="mb-2 text-sm font-semibold">{t('projectDetail.cascade.quantityHistory', 'Quantity history')}</h4>
              {history.length === 0 ? <p className="text-sm text-muted-foreground">{t('projectDetail.cascade.noConfirmedBastHistory', 'No confirmed BAST quantity history yet.')}</p> : <ul className="divide-y divide-border border-y border-border text-sm">
                {history.map(({ acceptance, quantity }) => <li key={acceptance.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{formatDateOnly(acceptance.acceptance_date)} · {acceptance.is_final ? t('projectTabs:contractQuantities.workOrders.acceptances.final', 'Final') : t('projectTabs:contractQuantities.workOrders.acceptances.stage', 'Stage')}</span>
                  <Tooltip content={t('projectDetail.cascade.source.acceptedHistory', 'Source: quantity recorded on this BAST.') }><span className="cursor-help tabular-nums">{formatNumberExact(quantity)} {selected.item?.unit ?? ''}</span></Tooltip>
                </li>)}
              </ul>}
            </section>
          </div>
        </Drawer>;
      })()}

      {poDrawerFor && <Drawer open title={t('projectDetail.workOrders.action.viewPo', 'View customer PO')} subtitle={poDrawerFor.title}
        status={<StatusPill variant={poDrawerFor.status === 'Closed' ? 'won' : 'progress'}>{poDrawerFor.status}</StatusPill>}
        onClose={() => closeOpenRecord(poDrawerFor.id, 'workOrder')}
        headerActions={<div className="flex flex-wrap items-center gap-2">
          {may('edit', 'workOrder', { record: { status: poDrawerFor.status } }) && <Button variant="outline" size="sm" onClick={() => { closeOpenRecord(poDrawerFor.id, 'workOrder'); setFormFor(poDrawerFor); }}>{t('projectDetail.workOrders.action.editOrder', 'Edit order')}</Button>}
          <Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/projects/${encodeURIComponent(projectId)}/work-orders?wo=${encodeURIComponent(poDrawerFor.id)}`} onClick={() => closeOpenRecord(poDrawerFor.id, 'workOrder')}>{t('projectDetail.drawer.openFullPage', 'Open full page')}</Link>
        </div>}>
        <dl className="space-y-4 p-4 text-sm">
          <div><dt className="text-xs text-muted-foreground">{t('projectDetail.workOrders.clientPo', 'Customer PO')}</dt><dd className="mt-1 font-medium">{poDrawerFor.client_po_number ?? '—'}</dd></div>
          {poDrawerFor.order_date && <div><dt className="text-xs text-muted-foreground">{t('projectDetail.workOrders.orderDate', 'Order date')}</dt><dd className="mt-1 font-medium">{formatDateOnly(poDrawerFor.order_date)}</dd></div>}
          {poDrawerFor.description && <div><dt className="text-xs text-muted-foreground">{t('projectDetail.workOrders.description', 'Description')}</dt><dd className="mt-1 whitespace-pre-wrap">{poDrawerFor.description}</dd></div>}
          {canViewBilling && poDrawerFor.order_value !== null && <div><dt className="text-xs text-muted-foreground">{t('projectDetail.workOrders.orderValue', 'Order value')}</dt><dd className="mt-1 w-fit cursor-help font-semibold tabular-nums"><Tooltip content={t('projectDetail.workOrders.orderValueSource', 'Source: the customer order value set by an authorized reviewer.') }><span>{formatCurrency(Number(poDrawerFor.order_value), currency)} · {basisNote(poDrawerFor)}</span></Tooltip></dd></div>}
          {canViewBilling && poDrawerFor.closing_value !== null && <p className="text-sm font-semibold tabular-nums">{t('projectTabs:contractQuantities.workOrders.closing.closedAt', 'Closed at {{amount}} (excl. PPN)', { amount: formatCurrency(Number(poDrawerFor.closing_value), currency), interpolation: { escapeValue: false } })}</p>}
        </dl>
      </Drawer>}

      {invoiceDrawerFor && <Drawer open title={invoiceDrawerFor.si_number ?? t('projectDetail.cascade.invoiceDraft', 'Invoice draft')}
        status={<StatusPill variant={invoiceDrawerFor.status === 'Paid' ? 'won' : invoiceDrawerFor.status === 'Unpaid' || invoiceDrawerFor.status === 'Submitted' ? 'warn' : invoiceDrawerFor.status === 'Cancelled' ? 'lost' : 'neutral'}>{invoiceDrawerFor.status}</StatusPill>}
        onClose={() => closeOpenRecord(invoiceDrawerFor.id, 'workOrderInvoice')}
        headerActions={<Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/sales-invoices/${encodeURIComponent(invoiceDrawerFor.id)}`} onClick={() => closeOpenRecord(invoiceDrawerFor.id, 'workOrderInvoice')}>{t('projectDetail.drawer.openFullPage', 'Open full page')}</Link>}>
        {(() => {
          const figures = invoiceBalanceFigures(invoiceDrawerFor);
          const invoiceCurrency = invoiceDrawerFor.currency || currency;
          return <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
            {invoiceDrawerFor.invoice_date && <QuantityFigure label={t('projectDetail.cascade.invoiceDate', 'Date')} value={formatDateOnly(invoiceDrawerFor.invoice_date)} />}
            {invoiceDrawerFor.amount !== null && <QuantityFigure label={t('projectDetail.cascade.invoiceAmount', 'Amount')} value={formatCurrency(invoiceDrawerFor.amount, invoiceCurrency)} detail={t('projectDetail.cascade.source.invoiceAmount', 'Source: invoice amount mirrored from accounting.') } />}
            {figures.paid !== null && <QuantityFigure label={t('projectDetail.cascade.paid', 'Paid')} value={formatCurrency(figures.paid, invoiceCurrency)} detail={t('projectDetail.cascade.source.invoicePaid', 'Computed as invoice amount less accounting balance outstanding.') } />}
            {figures.unpaid !== null && <QuantityFigure label={t('projectDetail.cascade.unpaid', 'Unpaid')} value={formatCurrency(figures.unpaid, invoiceCurrency)} detail={t('projectDetail.cascade.source.invoiceUnpaid', 'Source: accounting balance outstanding for this invoice.') } />}
            {invoiceDrawerFor.erp_due_date && <QuantityFigure label={t('projectDetail.cascade.invoiceDueDate', 'Due date')} value={formatDateOnly(invoiceDrawerFor.erp_due_date)} />}
          </dl>;
        })()}
      </Drawer>}

      {claimDrawerFor && <Drawer open title={claimDrawerFor.kind === 'down_payment'
        ? t('projectDetail.billing.claims.kind.downPayment', 'Down payment')
        : t('projectDetail.billing.claims.kind.progress', 'Progress')}
        subtitle={formatDateOnly(claimDrawerFor.created_at)}
        status={<StatusPill variant={claimDrawerFor.withdrawn_at ? 'lost' : claimDrawerFor.invoice?.status === 'Paid' ? 'won' : 'neutral'}>{claimDrawerFor.withdrawn_at ? t('projectDetail.billing.claims.withdrawn', 'Withdrawn') : claimDrawerFor.invoice?.status ?? t('projectDetail.billing.claims.notRaised', 'Not raised')}</StatusPill>}
        onClose={() => closeOpenRecord(claimDrawerFor.id, 'workOrderClaim')}
        headerActions={<div className="flex flex-wrap items-center gap-2">
          {!claimDrawerFor.withdrawn_at && !claimDrawerFor.invoice && canBill && ((claimDrawerFor.evidence?.length ?? 0) > 0
            ? <Button variant="primary" size="sm" onClick={() => { closeOpenRecord(claimDrawerFor.id, 'workOrderClaim'); setRaiseFor({ claim: claimDrawerFor, idempotencyKey: crypto.randomUUID() }); }}>{t('projectDetail.billing.claims.raise', 'Raise invoice')}</Button>
            : <Button variant="outline" size="sm" onClick={() => { closeOpenRecord(claimDrawerFor.id, 'workOrderClaim'); setEvidenceFor(claimDrawerFor.id); }}>{t('projectDetail.billing.claims.attachEvidence', 'Attach evidence')}</Button>)}
          <Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={claimDrawerFor.invoice ? `/sales-invoices/${encodeURIComponent(claimDrawerFor.id)}` : `/projects/${encodeURIComponent(projectId)}/billing`} onClick={() => closeOpenRecord(claimDrawerFor.id, 'workOrderClaim')}>{t('projectDetail.drawer.openFullPage', 'Open full page')}</Link>
        </div>}>
        <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
          <QuantityFigure label={t('projectDetail.billing.claims.column.gross', 'Gross')} value={formatCurrency(Number(claimDrawerFor.gross_amount), currency)} detail={t('projectDetail.billing.claims.source.gross', 'Source: the progress claim gross amount, copied from accepted quantities and contract rates.') } />
          <QuantityFigure label={t('projectDetail.billing.claims.column.recovery', 'DP recovery')} value={formatCurrency(Number(claimDrawerFor.dp_recovery_amount), currency)} detail={t('projectDetail.billing.claims.source.recovery', 'Source: the down-payment amount recovered on this claim.') } />
          <QuantityFigure label={t('projectDetail.billing.claims.column.net', 'Net')} value={formatCurrency(claimNet(Number(claimDrawerFor.gross_amount), Number(claimDrawerFor.dp_recovery_amount)), currency)} detail={t('projectDetail.billing.claims.source.net', 'Computed as gross less down-payment recovery.') } />
          <QuantityFigure label={t('projectDetail.billing.claims.column.evidence', 'Evidence')} value={formatNumberExact(claimDrawerFor.evidence?.length ?? 0)} detail={t('projectDetail.billing.claims.source.evidence', 'Source: linked evidence documents on the claim.') } />
        </dl>
        <section className="border-t border-border px-4 py-3">
          <h3 className="text-sm font-semibold">{t('projectDetail.billing.claims.evidence', 'Evidence')}</h3>
          {(claimDrawerFor.evidence ?? []).length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t('projectDetail.billing.claims.noEvidence', 'No evidence attached yet.')}</p> : <ul className="mt-2 divide-y divide-border border-y border-border text-sm">
            {(claimDrawerFor.evidence ?? []).map((evidence) => <li key={evidence.id} className="flex items-center justify-between gap-3 py-2"><span>{evidence.document_id}</span><StatusPill variant={evidence.document_status === 'active' ? 'won' : 'neutral'}>{evidence.document_status}</StatusPill></li>)}
          </ul>}
        </section>
      </Drawer>}

      {assessOpen && summary && <ProgressAssessmentModal boqItems={boqRows} assessedByBoqItem={summary.assessedByBoqItem} defaultMonth={thisMonth()}
        onClose={() => setAssessOpen(false)} onSave={saveAssessment} onError={fail} />}

      {percentOpen && <RecordProgressModal open onClose={() => setPercentOpen(false)} projectId={projectId} projectName={projectName}
        defaultMonth={thisMonth()} deliveryPct={null} />}

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

      {(claimFor || newClaimOpen) && summary && (
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
          initialWorkOrderId={claimFor?.id}
          onClose={() => { setClaimFor(null); setNewClaimOpen(false); }}
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
                  gross: formatCurrency(Number(raiseFor.claim.gross_amount), currency),
                  recovery: formatCurrency(Number(raiseFor.claim.dp_recovery_amount), currency),
                  net: formatCurrency(claimNet(Number(raiseFor.claim.gross_amount), Number(raiseFor.claim.dp_recovery_amount)), currency),
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

const MoneyFigure: React.FC<{ label: string; value: string; detail?: string; destructive?: boolean }> = ({ label, value, detail, destructive = false }) => (
  <div className="min-w-20">
    <dt className="text-xs text-muted-foreground"><Tooltip content={detail ?? 'Source: billing records for this customer order.'}><span className="cursor-help">{label}</span></Tooltip></dt>
    <dd className={`cursor-help text-lg font-semibold tabular-nums ${destructive ? 'text-destructive-text' : 'text-foreground'}`}><Tooltip content={detail ?? 'Source: billing records for this customer order.'}><span>{value}</span></Tooltip></dd>
  </div>
);

const QuantityFigure: React.FC<{ label: string; value: string; detail?: string }> = ({ label, value, detail }) => (
  <div className="flex items-baseline justify-between gap-2">
    <dt><Tooltip content={detail ?? 'Source: project billing records.'}><span className="cursor-help">{label}</span></Tooltip></dt>
    <dd className="cursor-help tabular-nums text-foreground"><Tooltip content={detail ?? 'Source: project billing records.'}><span>{value}</span></Tooltip></dd>
  </div>
);

export default WorkOrdersTab;
