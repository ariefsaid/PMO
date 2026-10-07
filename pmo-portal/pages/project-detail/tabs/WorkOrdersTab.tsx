import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardHead,
  CardPad,
  ConfirmDialog,
  DataTable,
  ListState,
  StatusPill,
  TaxBasisLabel,
  useToast,
  type Column,
  type StatusVariant,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatCurrency, formatCurrencyCents, formatDateOnly, currencySymbol } from '@/src/lib/format';
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
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
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

const WorkOrdersTab: React.FC<WorkOrdersTabProps> = ({ projectId, currency, clientId = null, focusWorkOrderId = null }) => {
  const { t } = useTranslation();
  const may = usePermission();
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

  // ── OD-BILL-1 (#913): billing by work order. Read = the revenue read set; Invoice = the invoice-create authority
  //    (Admin/Finance — the same `can()` the native create's RPC enforces) with a client to invoice, in EITHER revenue
  //    mode: the dialog branches its copy and the repository routes the write. Read through `useRevenueMode` (not the
  //    module cache) so the action appears the moment ownership resolves. UX only — the database refuses
  //    past-the-value invoices before any write (0262), ERP or native.
  const revenueMode = useRevenueMode();
  const canViewBilling = may('view', 'salesInvoice');
  const canInvoice = may('create', 'salesInvoice') && revenueMode !== undefined && Boolean(clientId);
  const billing = useWorkOrderBilling(projectId, canViewBilling);
  const billingById = useMemo(
    () => new Map((billing.data ?? []).map((b) => [b.workOrderId, b] as const)),
    [billing.data],
  );
  const totals = summarizeProjectWorkOrderBilling(billing.data ?? []);
  const [invoiceFor, setInvoiceFor] = useState<{ row: WorkOrderRow; remaining: number } | null>(null);
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
            {state !== 'incomplete' && excl}
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
              <span className={line}>
                {t('projectDetail.workOrders.billing.lineInvoiced', {
                  defaultValue: 'Invoiced {{invoiced}} · paid {{paid}}',
                  invoiced: money(f.invoiced),
                  paid: money(f.paid),
                  interpolation: { escapeValue: false },
                })}
              </span>
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

  /**
   * OD-TAX-1: no bare money figure anywhere a treatment exists. `tax_treatment` is a flat NOT NULL
   * on this table, so there is always an answer and this never has to render "unknown".
   */
  const treatmentLabel = (treatment: string): string =>
    treatment === 'inclusive'
      ? t('projectDetail.workOrders.tax.inclusive', 'incl. PPN')
      : t('projectDetail.workOrders.tax.exclusive', 'excl. PPN');

  const basisNote = (row: WorkOrderRow): string =>
    `${treatmentLabel(row.tax_treatment)}${row.tax_rate != null ? `\u00a0${row.tax_rate}%` : ` · ${t('tax.details.unknownRate', 'rate not recorded')}`} · DPP\u00a0${row.tax_base_numerator ?? 1}/${row.tax_base_denominator ?? 1}`;
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
            {isDraft && canTransition && (
              <Button variant="primary" size="sm" onClick={() => setPending({ row, to: 'Issued' })}>
                {t('projectDetail.workOrders.action.issue', 'Issue')}
              </Button>
            )}
            {isIssued && canTransition && (
              <Button variant="outline" size="sm" onClick={() => setPending({ row, to: 'Closed' })}>
                {t('projectDetail.workOrders.action.close', 'Close')}
              </Button>
            )}
            {canInvoice && (() => {
              const f = billingById.get(row.id);
              return f && canInvoiceWorkOrder(row.status, f) ? (
                <Button variant="primary" size="sm" onClick={() => setInvoiceFor({ row, remaining: f.remaining })}>
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

  const tableState = isPending ? 'loading' : isError ? 'error' : rows.length === 0 ? 'empty' : undefined;

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

  return (
    <div className="space-y-6">
      <ProjectDrawdown projectId={projectId} />

      {canViewBilling && (
        <Card variant="bare" data-testid="wo-billing-summary">
          <CardHead>{t('projectDetail.workOrders.billing.summaryTitle', 'Billing against work orders')}</CardHead>
          <CardPad>
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
                {/* auto-fit sizes the totals off the card's OWN width (DESIGN.md, record-layout column): beside the record
                    panel four IDR billions do not fit one row, so the fourth wraps instead of colliding. */}
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
                      {totals.complete && <dd>{excl}</dd>}
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {totals.complete
                    ? t('projectDetail.workOrders.billing.summaryNote', 'Issued and closed work orders, less what has been invoiced or drafted against them.')
                    : t('projectDetail.workOrders.billing.incompleteNote', 'An invoice on one of these work orders has no amount or is in another currency, so the totals cannot be added up.')}
                </p>
              </>
            )}
          </CardPad>
        </Card>
      )}

      <Card variant="bare">
        <CardHead className="justify-between">
          <span>{t('projectDetail.workOrders.title', 'Work orders')}</span>
          {may('create', 'workOrder') && (
            <Button variant="primary" size="sm" onClick={() => setFormFor(null)}>
              {t('projectDetail.workOrders.action.new', 'New work order')}
            </Button>
          )}
        </CardHead>
        <CardPad>
          {/* Beside the record panel at 1024px the column is ~350px and the table needs ~530px: below Tailwind's `@xl`
              container size (36rem = 576px) of its own width it becomes the record cards (AC-TBL-CARDS-001) instead of
              scrolling Invoice out of sight. */}
          <DataTable<WorkOrderRow>
            className="@container"
            cardBelow={576}
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            selectedKey={focusWorkOrderId ?? undefined}
            state={tableState}
            emptyTitle={t('projectDetail.workOrders.empty.title', 'No work orders on this project yet')}
            emptySub={t(
              'projectDetail.workOrders.empty.sub',
              'Record the client’s purchase orders here. Once issued, they draw down the project’s contract value.',
            )}
            errorTitle={t('projectDetail.workOrders.error.title', 'Couldn’t load the work orders')}
            errorSub={t(
              'projectDetail.workOrders.error.sub',
              'The client’s purchase orders for this project could not be read. Retry, or reopen the project.',
            )}
            onRetry={() => refetch()}
          />
        </CardPad>
      </Card>

      {formFor !== undefined && (
        <WorkOrderFormModal
          workOrder={formFor}
          currencySymbolPrefix={prefix}
          onClose={() => setFormFor(undefined)}
          onCreate={runCreate}
          onUpdate={runUpdate}
          onError={fail}
        />
      )}

      {valueFor && (
        <WorkOrderValueModal
          workOrder={valueFor}
          currentValueText={valueWithBasis(valueFor)}
          currencySymbolPrefix={prefix}
          onClose={() => setValueFor(null)}
          onSave={runSetValue}
          onError={fail}
        />
      )}

      {invoiceFor && clientId && (
        <InvoiceWorkOrderModal
          workOrder={invoiceFor.row}
          projectId={projectId}
          clientId={clientId}
          remaining={invoiceFor.remaining}
          onClose={() => setInvoiceFor(null)}
          onCreated={(siNumber) => {
            if (revenueMode === 'native') {
              // #913: a PMO Draft has no number yet (DD-NAR-9 mints it on approval) — name it by its work order.
              toast(
                t('projectDetail.workOrders.billing.toast.nativeCreated', 'Draft invoice created in PMO'),
                t('projectDetail.workOrders.billing.toast.nativeCreatedSub', {
                  defaultValue: '{{wo}} — a second Finance/Admin person approves it from Sales Invoices.',
                  wo: invoiceFor.row.wo_number ?? invoiceFor.row.title,
                  interpolation: { escapeValue: false },
                }),
                'success',
              );
            } else {
              toast(
                t('projectDetail.workOrders.billing.toast.created', 'Draft invoice created'),
                t('projectDetail.workOrders.billing.toast.createdSub', {
                  defaultValue: '{{number}} — submit it from Sales Invoices.',
                  number: siNumber,
                  interpolation: { escapeValue: false },
                }),
                'success',
              );
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
