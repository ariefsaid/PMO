import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Button,
  Card,
  CardHead,
  CardPad,
  ConfirmDialog,
  DataTable,
  GateNotice,
  SearchMini,
  ListState,
  StatusPill,
  TaxBasisLabel,
  Toolbar,
  useToast,
  type Column,
  type StatusVariant,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency, formatCurrencyCents, formatDateOnly, formatNumberExact, currencySymbol } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  isOverCommitmentRefusal,
  type WorkOrderRow,
  type WorkOrderStatus,
  isLegalWorkOrderTransition,
} from '@/src/lib/db/workOrders';
import { useProjectWorkOrders, useWorkOrderMutations } from '@/src/hooks/useWorkOrders';
import ProjectDrawdown from '../ProjectDrawdown';
import WorkOrderFormModal from '../WorkOrderFormModal';
import WorkOrderValueModal from '../WorkOrderValueModal';
import InvoiceWorkOrderModal from '../InvoiceWorkOrderModal';
import { useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { useBoqItems, useProjectBilling } from '@/src/hooks/useProgressBilling';
import { useDocuments } from '@/src/hooks/useDocuments';
import {
  useWorkOrderAcceptanceMutations, useWorkOrderAcceptances, useProjectWorkOrderLines,
} from '@/src/hooks/useWorkOrderAcceptances';
import type { WorkOrderAcceptanceWithLines, WorkOrderLineRow } from '@/src/lib/db/workOrderAcceptances';
import WorkOrderLinesModal from '../WorkOrderLinesModal';
import WorkOrderAcceptanceModal from '../WorkOrderAcceptanceModal';
import WorkOrderAcceptances from '../WorkOrderAcceptances';
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
}

/** `YYYY-MM-DD` in the browser's zone — only the BAST date dialog's default. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** OD-BILL-1: the billing pill per derived state ('not-billable' renders a dash, no pill). Workflow family (DESIGN.md):
 *  a draft someone still has to submit is needs-you (`warn`). */
const BILLING_VARIANT: Record<Exclude<WorkOrderBillingState, 'not-billable'>, StatusVariant> = {
  'not-invoiced': 'draft',
  'partly-invoiced': 'progress',
  'awaiting-submission': 'warn',
  'fully-invoiced': 'progress',
  paid: 'won',
  'over-invoiced': 'overdue',
  incomplete: 'warn',
};
/** The billing state is a property of the money, not the work order: it sits on a quiet `secondary` chip so it never
 *  reads as the work order's own status mark beside it (an Issued work order and a partly invoiced one share a hue). */
const BILLING_CHIP = 'rounded-sm bg-secondary px-1.5 py-0.5';
const ROLE_RANK: Record<string, number> = {
  Engineer: 10,
  'Project Manager': 20,
  Finance: 30,
  Executive: 40,
  Admin: 50,
};

const WORK_ORDER_STATUSES: WorkOrderStatus[] = ['Draft', 'Issued', 'Closed', 'Cancelled'];

const STATUS_VARIANT: Record<WorkOrderStatus, StatusVariant> = {
  Draft: 'draft',
  Issued: 'progress',
  Closed: 'won',
  Cancelled: 'lost',
};

/** A pending status move awaiting its confirm. */
interface PendingTransition {
  row: WorkOrderRow;
  to: WorkOrderStatus;
}

const WorkOrdersTab: React.FC<WorkOrdersTabProps> = ({ projectId, currency, clientId = null, focusWorkOrderId = null, projectManagerId = null }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const { data, isPending, isError, refetch } = useProjectWorkOrders(projectId);
  const { create, update, setValue, transition } = useWorkOrderMutations(projectId);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | 'all'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

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
  const boqRows = useMemo(() => boq.data ?? [], [boq.data]);
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
  const billing = useWorkOrderBilling(projectId, canViewBilling);
  const billingById = useMemo(
    () => new Map((billing.data ?? []).map((b) => [b.workOrderId, b] as const)),
    [billing.data],
  );
  const totals = summarizeProjectWorkOrderBilling(billing.data ?? []);
  const [invoiceFor, setInvoiceFor] = useState<{ row: WorkOrderRow; remaining: number } | null>(null);
  const [createdInvoice, setCreatedInvoice] = useState<{ id: string; native: boolean } | null>(null);
  // Every billing figure is normalised excl. tax (DD-BWO-3): ONE shared basis label qualifies a whole cell (OD-TAX-1).
  const excl = <TaxBasisLabel treatment="exclusive" showDetails={false} testId="wo-billing-basis" className="whitespace-nowrap" />;

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

  const billingLabel = (state: Exclude<WorkOrderBillingState, 'not-billable'>): string => {
    switch (state) {
      case 'not-invoiced':
        return t('projectDetail.workOrders.billing.status.notInvoiced', 'Not invoiced');
      case 'partly-invoiced':
        return t('projectDetail.workOrders.billing.status.partlyInvoiced', 'Partly invoiced');
      case 'awaiting-submission':
        return t('projectDetail.workOrders.billing.status.awaitingSubmission', 'Awaiting submission');
      case 'fully-invoiced':
        return t('projectDetail.workOrders.billing.status.fullyInvoiced', 'Fully invoiced');
      case 'paid':
        return t('projectDetail.workOrders.billing.status.paid', 'Paid');
      case 'over-invoiced':
        return t('projectDetail.workOrders.billing.status.overInvoiced', 'Over-invoiced');
      default:
        return t('projectDetail.workOrders.billing.status.incomplete', "Can't total");
    }
  };

  const billingColumn: Column<WorkOrderRow> = {
    key: 'billing',
    header: t('projectDetail.workOrders.billing.column', 'Billing'),
    cell: (row) => {
      const f = billingById.get(row.id);
      if (billing.isPending) {
        return <ListState variant="loading" rows={2} className="w-28 p-0" testId={`wo-billing-loading-${row.id}`} />;
      }
      if (billing.isError || !f) {
        return (
          <span data-testid={`wo-billing-${row.id}`} className="text-[12px] text-muted-foreground">
            {t('projectDetail.workOrders.billing.unavailable', 'Unavailable')}
          </span>
        );
      }
      const state = deriveWorkOrderBillingState(row.status, f);
      if (state === 'not-billable') return <span data-testid={`wo-billing-${row.id}`}>—</span>;
      const money = (amount: number) => formatCurrencyCents(amount, f.currency);
      const line = 'text-[11px] tabular text-muted-foreground';
      return (
        <div className="flex flex-col items-start gap-0.5 whitespace-normal" data-testid={`wo-billing-${row.id}`}>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <StatusPill variant={BILLING_VARIANT[state]} className={BILLING_CHIP}>{billingLabel(state)}</StatusPill>
          </span>
          {state === 'incomplete' ? (
            // DD-BWO-3: say which invoice stops the total, when the cause could be read.
            (f.problems ?? []).map((p) => (
              <span key={p.recordId} className={line}>
                {p.cause === 'no-amount'
                  ? t('projectDetail.workOrders.billing.cause.noAmount', {
                      defaultValue: '{{number}} has no amount',
                      number: p.number ?? t('projectDetail.workOrders.billing.cause.anInvoice', 'An invoice'),
                      interpolation: { escapeValue: false },
                    })
                  : t('projectDetail.workOrders.billing.cause.otherCurrency', {
                      defaultValue: '{{number}} is in {{currency}}',
                      number: p.number ?? t('projectDetail.workOrders.billing.cause.anInvoice', 'An invoice'),
                      currency: p.currency ?? '?',
                      interpolation: { escapeValue: false },
                    })}
              </span>
            ))
          ) : (
            <>
              <span className="text-[11px] font-semibold tabular">
                {state === 'over-invoiced'
                  ? t('projectDetail.workOrders.billing.lineOver', {
                      defaultValue: 'Over by {{amount}}',
                      amount: money(-f.remaining),
                      interpolation: { escapeValue: false },
                    })
                  : t('projectDetail.workOrders.billing.lineRemaining', {
                      defaultValue: 'Still to invoice {{amount}}',
                      amount: money(Math.max(f.remaining, 0)),
                      interpolation: { escapeValue: false },
                    })}
              </span>
              {Math.round(f.invoiced * 100) > 0 && (
                <span className={line}>
                  {t('projectDetail.workOrders.billing.lineInvoiced', {
                    defaultValue: 'Invoiced {{invoiced}} · paid {{paid}}',
                    invoiced: money(f.invoiced),
                    paid: money(f.paid),
                    interpolation: { escapeValue: false },
                  })}
                </span>
              )}
              {/* Drafts and unraised claims use up the work order before they are invoiced: shown, so a work order
                  that is "full" only because of a draft never reads as invoiced (AC-BWO-003, DD-BWO-1). */}
              {Math.round(f.pending * 100) > 0 && (
                <span className={line}>
                  {t('projectDetail.workOrders.billing.lineNotSubmitted', {
                    defaultValue: 'Not yet submitted {{amount}}',
                    amount: money(f.pending),
                    interpolation: { escapeValue: false },
                  })}
                </span>
              )}
              {/* An incl.-PPN order value is not what these figures add up to: show the net they reconcile against. */}
              {row.tax_treatment === 'inclusive' && (
                <span className={line}>
                  {t('projectDetail.workOrders.billing.lineNet', {
                    defaultValue: 'Net value {{amount}}',
                    amount: money(f.orderNet),
                    interpolation: { escapeValue: false },
                  })}
                </span>
              )}
            </>
          )}
        </div>
      );
    },
  };

  const statusLabel = (status: WorkOrderStatus): string => {
    switch (status) {
      case 'Draft':
        return t('projectDetail.workOrders.status.draft', 'Draft');
      case 'Issued':
        return t('projectDetail.workOrders.status.issued', 'Issued');
      case 'Closed':
        return t('projectDetail.workOrders.status.closed', 'Closed');
      default:
        return t('projectDetail.workOrders.status.cancelled', 'Cancelled');
    }
  };

  const query = search.trim().toLocaleLowerCase();
  const visibleRows = useMemo(() => [...rows]
    .sort((left, right) => {
      if (left.order_date === null) return right.order_date === null ? left.id.localeCompare(right.id) : 1;
      if (right.order_date === null) return -1;
      const leftDate = left.order_date ?? '';
      const rightDate = right.order_date ?? '';
      const dateOrder = leftDate.localeCompare(rightDate);
      const ordered = sortOrder === 'newest' ? -dateOrder : dateOrder;
      return ordered || left.id.localeCompare(right.id);
    })
    .filter((row) => {
      const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
      const matchesSearch = !query || [row.wo_number, row.title, row.client_po_number, row.id]
        .some((value) => value?.toLocaleLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    }), [rows, query, sortOrder, statusFilter]);
  const hasActiveFilters = query.length > 0 || statusFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
  };

  /**
   * OD-TAX-1: no bare money figure anywhere a treatment exists. `tax_treatment` is a flat NOT NULL
   * on this table, so there is always an answer and this never has to render "unknown".
   */
  const treatmentLabel = (treatment: string): string =>
    treatment === 'inclusive'
      ? t('projectDetail.workOrders.tax.inclusive', 'incl. PPN')
      : t('projectDetail.workOrders.tax.exclusive', 'excl. PPN');

  // SUB-C: the rate and DPP are detail — shown only when they change the reading (rate missing, or DPP is not 1/1).
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
    toast(
      t('projectDetail.workOrders.toast.valueSet', 'Work order value set'),
      formatCurrency(input.value, currency),
      'success',
    );
    setValueFor(null);
  };

  /** The confirmed status move. The over-ceiling refusal is caught and re-offered, never retried. */
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

  /** The SECOND, separately-confirmed action: issue with the acknowledgement stamped. */
  const runAcknowledgedIssue = async (row: WorkOrderRow) => {
    try {
      await transition.mutateAsync({ id: row.id, to: 'Issued', overCommitAck: true });
      toast(
        t('projectDetail.workOrders.toast.issuedOverCeiling', 'Work order issued over the ceiling'),
        t(
          'projectDetail.workOrders.toast.issuedOverCeilingSub',
          'Your acknowledgement is recorded against this work order.',
        ),
        'success',
      );
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

  /** The server's refusal (over order net, below billed, SoD, missing document) stays in the dialog. */
  const runConfirmBast = async () => {
    if (!confirmFor) return;
    try {
      const result = await quantityMutations.confirm.mutateAsync(confirmFor.acceptance.id);
      if (confirmFor.acceptance.is_final && result && result.dpHeld > 0) setDpHeldAfterClose(result.dpHeld);
      toast(
        result && result.closingValue !== null
          ? t('projectTabs:contractQuantities.workOrders.acceptances.toast.closed', 'Final BAST confirmed — closed at {{amount}}', {
            amount: formatCurrency(result.closingValue, currency), interpolation: { escapeValue: false },
          })
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

  const columns: Column<WorkOrderRow>[] = [
    {
      key: 'number',
      header: t('projectDetail.workOrders.column.number', 'WO number'),
      cell: (row) => (
        <div className="flex flex-col">
          {/* The arrival target for a `?wo=` link: programmatically focusable, never in the Tab order. */}
          <span
            className="font-semibold tabular rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-wo-anchor={row.id}
            tabIndex={-1}
          >
            {row.wo_number ??
              t('projectDetail.workOrders.notYetIssued', 'Not issued yet')}
          </span>
          {/* The scope rides under the WO number (not its own column) so Billing and Invoice stay in view beside
              the record panel; it wraps to two lines rather than widening the table. */}
          <span className="line-clamp-2 max-w-56 whitespace-normal" title={row.title}>{row.title}</span>
          {/* Folded status: only while the table is too narrow for the Status column (below), and never on a
              record card (mobile, or a column too narrow for the table), which already lists Status as a field. */}
          <span className="mt-0.5 max-md:hidden @2xl:hidden [[data-dt-cards]_&]:hidden">
            <StatusPill variant={STATUS_VARIANT[row.status]}>{statusLabel(row.status)}</StatusPill>
          </span>
          {row.client_po_number && (
            <span className="text-[11px] text-muted-foreground">
              {t('projectDetail.workOrders.clientPo', 'Client PO')} {row.client_po_number}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'value',
      header: t('projectDetail.workOrders.column.value', 'Order value'),
      align: 'num',
      cell: (row) => (
        <span className="flex flex-col items-end tabular" data-testid={`wo-value-${row.id}`}>
          <span>{formatCurrency(row.order_value, row.currency)}</span>{' '}
          <span className="whitespace-normal text-[11px] text-muted-foreground">{basisNote(row)}</span>
          {row.closing_value != null && (
            <span className="mt-0.5 whitespace-normal text-[11px] font-semibold" data-testid={`wo-closing-${row.id}`}>
              {t('projectTabs:contractQuantities.workOrders.closing.closedAt', 'Closed at {{amount}} (excl. PPN)', {
                amount: formatCurrency(Number(row.closing_value), row.currency),
                interpolation: { escapeValue: false },
              })}
            </span>
          )}
        </span>
      ),
    },
    ...(canViewBilling ? [billingColumn] : []),
    // Secondary columns hide on the TABLE'S OWN width (container query on the DataTable), not the viewport: beside
    // the record panel the table is far narrower than the viewport implies (DESIGN.md, record-layout column).
    {
      key: 'status',
      header: t('projectDetail.workOrders.column.status', 'Status'),
      colClassName: 'hidden @2xl:table-cell',
      cell: (row) => (
        <StatusPill variant={STATUS_VARIANT[row.status]}>{statusLabel(row.status)}</StatusPill>
      ),
    },
    {
      key: 'orderDate',
      header: t('projectDetail.workOrders.column.orderDate', 'Order date'),
      colClassName: 'hidden @4xl:table-cell',
      cell: (row) => <span>{formatDateOnly(row.order_date)}</span>,
    },
    {
      key: 'actions',
      header: t('projectDetail.workOrders.column.actions', 'Actions'),
      cell: (row) => {
        // ⚑ Consult the shared transition map rather than re-encoding the graph here (spec review:
        // the map was exported with zero consumers while this file hardcoded the same rules). One
        // source for "what may follow this status", shared with the DAL and mirroring 0193's
        // server-side graph — so an illegal move is never offered rather than offered and refused.
        const isDraft = isLegalWorkOrderTransition(row.status, 'Issued');
        const isIssued = isLegalWorkOrderTransition(row.status, 'Closed');
        const canEdit = may('edit', 'workOrder', { record: { status: row.status } });
        const canSetValue = may('setValue', 'workOrder', { record: { status: row.status } });
        const canTransition = may('transition', 'workOrder');
        // Mirrors transition_work_order's complete visible author predicate (0197 §8, lines 387–393):
        // only positive-value drafts issued below Finance need a distinct, active author who is the
        // issuer's manager or outranks them. The RPC remains authoritative for auth.users bans.
        const issuerRole = currentUser?.role ?? '';
        const author = row.value_author;
        const authorIsSelf = row.order_value_set_by === currentUser?.id;
        const authorRelationshipFails = authorIsSelf
          || !author
          || author.status !== 'active'
          || !currentUser?.id
          || !(author.manager_id === currentUser.id
            || (ROLE_RANK[author.role] ?? 0) > (ROLE_RANK[issuerRole] ?? 0));
        // The RPC also checks auth.users membership/ban state, which is not exposed to this client gate.
        const issueBlockedByValueAuthor = Number(row.order_value ?? 0) > 0
          && !['Finance', 'Executive', 'Admin'].includes(issuerRole)
          && (!row.order_value_set_at || authorRelationshipFails);
        const issueGateBody = !row.order_value_set_at
          ? t('projectDetail.workOrders.issueGate.unstampedBody', 'The value must be set by an authorized reviewer before this order can be issued.')
          : authorIsSelf
            ? t('projectDetail.workOrders.issueGate.body', 'You set its value. Ask another authorized reviewer to review and issue it.')
            : t('projectDetail.workOrders.issueGate.peerBody', 'The value must be set by your supervisor or a more senior active reviewer before this order can be issued.');
        return (
          <div className="flex flex-wrap gap-1.5">
            {isDraft && canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setFormFor(row)}>
                {t('projectDetail.workOrders.action.edit', 'Edit')}
              </Button>
            )}
            {isDraft && canSetValue && (
              <Button variant="outline" size="sm" onClick={() => setValueFor(row)}>
                {t('projectDetail.workOrders.action.setValue', 'Set value')}
              </Button>
            )}
            {isDraft && canTransition && issueBlockedByValueAuthor ? (
              <GateNotice variant="blocked" className="max-w-sm px-2 py-1.5 text-xs">
                {issueGateBody}
              </GateNotice>
            ) : isDraft && canTransition ? (
              <Button variant="primary" size="sm" onClick={() => setPending({ row, to: 'Issued' })}>
                {t('projectDetail.workOrders.action.issue', 'Issue')}
              </Button>
            ) : null}
            {isIssued && canTransition && !closeByBast(row.id) && (
              <Button variant="outline" size="sm" onClick={() => setPending({ row, to: 'Closed' })}>
                {t('projectDetail.workOrders.action.close', 'Close')}
              </Button>
            )}
            {canInvoice && (() => {
              const f = billingById.get(row.id);
              return f && canInvoiceWorkOrder(row.status, f) ? (
                <Button variant="primary" size="sm" onClick={() => {
                  setCreatedInvoice(null);
                  setInvoiceFor({ row, remaining: f.remaining });
                }}>
                  {t('projectDetail.workOrders.billing.invoiceAction', 'Invoice')}
                </Button>
              ) : null;
            })()}
            {(isDraft || isIssued) && canTransition && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                onClick={() => setPending({ row, to: 'Cancelled' })}
              >
                {t('projectDetail.workOrders.action.cancel', 'Cancel')}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const tableState = isPending ? 'loading' : isError ? 'error' : visibleRows.length === 0 ? 'empty' : undefined;

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

  const billingPosition = canViewBilling && rows.length > 0 ? (
    <section data-testid="wo-billing-summary" aria-labelledby="wo-billing-summary-heading">
      <h3 id="wo-billing-summary-heading" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {t('projectDetail.workOrders.billing.summaryTitle', 'Billing against work orders')}
        {billing.data && totals.complete && excl}
      </h3>
      <div className="mt-3">
        {billing.isPending ? (
          <ListState variant="loading" rows={1} testId="wo-billing-loading" />
        ) : billing.isError || !billing.data ? (
          <ListState
            variant="error"
            title={t('projectDetail.workOrders.billing.loadError', "Couldn't load billing for these work orders")}
            onRetry={() => billing.refetch()}
          />
        ) : (
          <>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
              {([
                ['wo-billing-total-still', t('projectDetail.workOrders.billing.stillToInvoice', 'Still to invoice'), totals.stillToInvoice],
                ['wo-billing-total-invoiced', t('projectDetail.workOrders.billing.invoiced', 'Invoiced'), totals.invoiced],
                ['wo-billing-total-paid', t('projectDetail.workOrders.billing.paid', 'Paid'), totals.paid],
                ...(totals.inDraft > 0
                  ? [['wo-billing-total-draft', t('projectDetail.workOrders.billing.notSubmitted', 'Not yet submitted'), totals.inDraft] as const]
                  : []),
              ] as const).map(([testId, label, value]) => (
                <div key={testId} data-testid={testId}>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-[15px] font-bold tabular">
                    {totals.complete
                      ? formatCurrencyCents(value, currency)
                      : t('projectDetail.workOrders.billing.unavailable', 'Unavailable')}
                  </dd>
                </div>
              ))}
            </dl>
            {!totals.complete && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                {t('projectDetail.workOrders.billing.incompleteNote', 'An invoice on one of these work orders has no amount or is in another currency, so the totals cannot be added up.')}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  ) : null;

  return (
    <div className="space-y-6">
      <ProjectDrawdown
        projectId={projectId}
        title={t('projectDetail.workOrders.positionTitle', 'Contract headroom and billing position')}
        alwaysShow={rows.length > 0}
        afterFigures={(
          <>
            {billingPosition}
            {dpNotice !== null && (
              <div role="status" data-testid="wo-dp-held-notice" className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[13px]">
                {t('projectTabs:contractQuantities.workOrders.closing.dpHeld',
                  '{{amount}} of the down payment is still held after closing. Finance should recover the rest with the next progress claim, or refund it explicitly — closing does not clear it.',
                  { amount: formatCurrency(dpNotice, currency), interpolation: { escapeValue: false } })}
              </div>
            )}
          </>
        )}
      />

      <section aria-labelledby="project-work-orders-heading">
        <Toolbar standalone role="group" aria-label={t('projectDetail.workOrders.toolbar.label', 'Work order tools')}>
          <SearchMini
            placeholder={t('projectDetail.workOrders.toolbar.searchPlaceholder', 'Search by WO number, title, or client PO…')}
            aria-label={t('projectDetail.workOrders.toolbar.searchLabel', 'Search work orders')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            containerClassName="max-sm:h-11 max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:flex-1"
          />
          <select
            aria-label={t('projectDetail.workOrders.toolbar.statusFilter', 'Filter work orders by status')}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as WorkOrderStatus | 'all')}
            className="h-8 max-sm:h-11 w-full sm:w-auto rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="all">{t('projectDetail.workOrders.toolbar.allStatuses', 'All statuses')}</option>
            {WORK_ORDER_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select>
          <select
            aria-label={t('projectDetail.workOrders.toolbar.sortOrders', 'Sort work orders')}
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as 'newest' | 'oldest')}
            className="h-8 max-sm:h-11 w-full sm:w-auto rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="newest">{t('projectDetail.workOrders.toolbar.newest', 'Newest order date')}</option>
            <option value="oldest">{t('projectDetail.workOrders.toolbar.oldest', 'Oldest order date')}</option>
          </select>
          {may('create', 'workOrder') && (
            <Button variant="primary" size="sm" className="max-sm:min-h-11 max-sm:w-full" onClick={() => setFormFor(null)}>
              {t('projectDetail.workOrders.action.new', 'New work order')}
            </Button>
          )}
        </Toolbar>

        {createdInvoice && (
          <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <p className="text-sm text-muted-foreground">
              {createdInvoice.native
                ? t('projectDetail.workOrders.billing.draftHandoffNative', 'Draft created. A different Finance or Admin user must approve it.')
                : t('projectDetail.workOrders.billing.draftHandoffErp', 'Draft created. A different Finance or Admin user must submit it.')}
            </p>
            <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/sales-invoices/${encodeURIComponent(createdInvoice.id)}`}>
              {t('projectDetail.workOrders.billing.openDraft', 'Open draft')}
            </Link>
          </div>
        )}

        <h2 id="project-work-orders-heading" className="mb-3.5 text-[16px] font-bold tracking-[-0.01em]">
          {t('projectDetail.workOrders.title', 'Work orders')}
        </h2>
        {/* Beside the record panel at 1024px the column is ~350px and the table needs ~530px: below Tailwind's `@xl`
            container size (36rem = 576px) of its own width it becomes the record cards (AC-TBL-CARDS-001) instead of
            scrolling Invoice out of sight. */}
        <DataTable<WorkOrderRow>
            className="@container"
            rows={visibleRows}
            columns={columns}
            rowKey={(row) => row.id}
            selectedKey={focusWorkOrderId ?? undefined}
            state={tableState}
            emptyTitle={hasActiveFilters
              ? t('projectDetail.workOrders.toolbar.noMatches', 'No work orders match these search and filters')
              : t('projectDetail.workOrders.empty.title', 'No work orders on this project yet')}
            emptySub={!hasActiveFilters ? t(
              'projectDetail.workOrders.empty.sub',
              'Record the client’s purchase orders here. Once issued, they draw down the project’s contract value.',
            ) : undefined}
            errorTitle={t('projectDetail.workOrders.error.title', 'Couldn’t load the work orders')}
            errorSub={t(
              'projectDetail.workOrders.error.sub',
              'The client’s purchase orders for this project could not be read. Retry, or reopen the project.',
            )}
            onRetry={() => refetch()}
            emptyAction={hasActiveFilters ? {
              label: t('projectDetail.workOrders.toolbar.clearFilters', 'Clear search and filters'),
              onClick: clearFilters,
            } : undefined}
            cardBelow={576}
            tableId="project-detail-tabs-workorderstab-table" />
      </section>

      {showQuantities && rows.length > 0 && (
        <Card variant="bare" data-testid="wo-quantities">
          <CardHead level={2} className="text-base">
            {t('projectTabs:contractQuantities.workOrders.quantities.title', 'Contract quantities')}
          </CardHead>
          <CardPad>
            {lines.isError && (
              <ListState variant="error" title={t('projectTabs:contractQuantities.workOrders.contractLines.loadError', 'Couldn’t load the contract lines')} onRetry={() => void lines.refetch()} />
            )}
            <div className="flex flex-col gap-2">
              {rows.map((row) => {
                const mine = allocationsByWo.get(row.id) ?? [];
                const bastList = acceptancesByWo.get(row.id) ?? [];
                const woLabel = row.wo_number ?? row.title;
                const editableLines = may('create', 'workOrderLine', { record: { status: row.status } });
                return (
                  <details key={row.id} data-testid={`wo-quantities-${row.id}`} className="rounded-md border border-border p-3">
                    <summary className="cursor-pointer rounded text-[13.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      {t('projectTabs:contractQuantities.workOrders.quantities.summary', 'Contract lines and BAST — {{wo}}', { wo: woLabel })}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {t('projectTabs:contractQuantities.workOrders.quantities.counts', '{{lines}} lines · {{basts}} BAST', { lines: mine.length, basts: bastList.length })}
                      </span>
                    </summary>
                    <div className="mt-3 flex flex-col gap-4">
                      <section aria-label={t('projectTabs:contractQuantities.workOrders.contractLines.heading', 'Contract lines')}>
                        <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                          {t('projectTabs:contractQuantities.workOrders.contractLines.heading', 'Contract lines')}
                        </h3>
                        {mine.length === 0 ? (
                          <p className="text-[13px] text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.contractLines.none', 'No contract lines allocated yet')}</p>
                        ) : (
                          <ul className="flex flex-col gap-0.5 text-[13px]" data-testid={`wo-lines-${row.id}`}>
                            {mine.map((l) => {
                              const item = boqRows.find((b) => b.id === l.boq_item_id);
                              return (
                                <li key={l.id} className="tabular">
                                  {item ? `${item.item_code} — ${item.description}` : l.boq_item_id}{' '}
                                  <span className="font-semibold">{formatNumberExact(Number(l.quantity))}{item ? ` ${item.unit}` : ''}</span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {editableLines && (
                          <div className="mt-2">
                            <Button variant="outline" size="sm" onClick={() => setLinesFor(row)}>
                              {t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Edit lines')}
                            </Button>
                          </div>
                        )}
                      </section>
                      <section aria-label={t('projectTabs:contractQuantities.workOrders.acceptances.heading', 'Acceptances (BAST)')}>
                        <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                          {t('projectTabs:contractQuantities.workOrders.acceptances.heading', 'Acceptances (BAST)')}
                        </h3>
                        <WorkOrderAcceptances
                          workOrder={row}
                          boqItems={boqRows}
                          documents={documents.data ?? []}
                          acceptances={bastList}
                          state={acceptancesQuery.isError ? 'error' : acceptancesQuery.isPending ? 'loading' : 'ready'}
                          onRetry={() => void acceptancesQuery.refetch()}
                          currentUserId={currentUser?.id ?? null}
                          projectManagerId={projectManagerId}
                          hasAllocations={mine.length > 0}
                          onPrepare={() => setBastFor({ row, draft: null })}
                          onEdit={(a) => setBastFor({ row, draft: a })}
                          onWithdraw={setWithdrawFor}
                          onConfirm={(a) => setConfirmFor({ acceptance: a, error: null })}
                        />
                      </section>
                    </div>
                  </details>
                );
              })}
            </div>
          </CardPad>
        </Card>
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
