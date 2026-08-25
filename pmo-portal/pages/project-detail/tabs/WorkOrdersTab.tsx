import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardHead,
  CardPad,
  ConfirmDialog,
  DataTable,
  StatusPill,
  useToast,
  type Column,
  type StatusVariant,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatCurrency, formatDate, currencySymbol } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  isOverCommitmentRefusal,
  type WorkOrderRow,
  type WorkOrderStatus,
} from '@/src/lib/db/workOrders';
import { useProjectWorkOrders, useWorkOrderMutations } from '@/src/hooks/useWorkOrders';
import ProjectDrawdown from '../ProjectDrawdown';
import WorkOrderFormModal from '../WorkOrderFormModal';
import WorkOrderValueModal from '../WorkOrderValueModal';

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
}

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

const WorkOrdersTab: React.FC<WorkOrdersTabProps> = ({ projectId, currency }) => {
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

  const valueWithBasis = (row: WorkOrderRow): string =>
    `${formatCurrency(row.order_value, row.currency)} ${treatmentLabel(row.tax_treatment)}`;

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
          <span className="font-semibold tabular">
            {row.wo_number ??
              t('projectDetail.workOrders.notYetIssued', 'Not issued yet')}
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
      key: 'title',
      header: t('projectDetail.workOrders.column.title', 'Scope'),
      cell: (row) => <span>{row.title}</span>,
    },
    {
      key: 'status',
      header: t('projectDetail.workOrders.column.status', 'Status'),
      cell: (row) => (
        <StatusPill variant={STATUS_VARIANT[row.status]}>{statusLabel(row.status)}</StatusPill>
      ),
    },
    {
      key: 'value',
      header: t('projectDetail.workOrders.column.value', 'Order value'),
      align: 'num',
      cell: (row) => (
        <span className="tabular" data-testid={`wo-value-${row.id}`}>
          {valueWithBasis(row)}
        </span>
      ),
    },
    {
      key: 'orderDate',
      header: t('projectDetail.workOrders.column.orderDate', 'Order date'),
      colClassName: 'hidden lg:table-cell',
      cell: (row) => <span>{formatDate(row.order_date)}</span>,
    },
    {
      key: 'actions',
      header: t('projectDetail.workOrders.column.actions', 'Actions'),
      cell: (row) => {
        const isDraft = row.status === 'Draft';
        const isIssued = row.status === 'Issued';
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
            {(isDraft || isIssued) && canTransition && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
          <DataTable<WorkOrderRow>
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
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
