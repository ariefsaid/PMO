import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { buttonClasses, ListState, StatusPill, TaxBasisLabel, Tooltip, type StatusVariant } from '@/src/components/ui';
import { Block } from './ProjectBlocks';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useWorkOrderAcceptanceAge, useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { deriveBillingMilestoneStatus, sortBillingMilestones, type BillingMilestoneStatus } from '@/src/lib/billingMilestones';
import { canInvoiceWorkOrder } from '@/src/lib/workOrderBilling';
import { formatCurrencyAuto, formatDateOnly } from '@/src/lib/format';

const TONE: Record<BillingMilestoneStatus, StatusVariant> = { unknown: 'warn', planned: 'open', 'in-progress': 'progress', invoiced: 'neutral', paid: 'won' };

/** #1640: the client's work orders as billing milestones (same records as Contract & billing; no second entry). */
const Body: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const canCreate = may('create', 'salesInvoice');
  const orders = useProjectWorkOrders(projectId);
  const billing = useWorkOrderBilling(projectId);
  const age = useWorkOrderAcceptanceAge(projectId);
  const title = t('projectDetail.billingMilestones.title', 'Billing milestones');
  const rows = useMemo(() => sortBillingMilestones((orders.data ?? []).filter((w) => w.status !== 'Cancelled')), [orders.data]);
  const billingById = useMemo(() => new Map((billing.data ?? []).map((b) => [b.workOrderId, b] as const)), [billing.data]);
  const ageById = useMemo(() => new Map((age.data ?? []).map((a) => [a.workOrderId, a] as const)), [age.data]);
  const contractHref = `/projects/${projectId}/contract`;
  const shell = (children: React.ReactNode) => (
    <Block id="pd-billing-milestones" title={title}
      unit={t('projectDetail.billingMilestones.subline', "The client's work orders. Billing follows each work order.")}>{children}</Block>
  );
  if (orders.isPending || billing.isPending || age.isPending) return shell(<ListState variant="loading" rows={3} />);
  if (orders.isError || billing.isError || age.isError) {
    return shell(<ListState variant="error" title={t('projectDetail.billingMilestones.error', "Couldn't load the billing milestones")}
      onRetry={() => { void orders.refetch(); void billing.refetch(); void age.refetch(); }} />);
  }
  if (rows.length === 0) {
    return shell(<p className="text-sm text-muted-foreground">{t('projectDetail.billingMilestones.empty', 'No work orders yet.')}{' '}
      <Link to={contractHref} className="font-semibold text-primary-text hover:underline">{t('projectDetail.billingMilestones.openContract', 'Open contract & billing')}</Link></p>);
  }
  const statusLabel: Record<BillingMilestoneStatus, string> = {
    unknown: t('common:projectDetail.workOrders.billing.status.incomplete', "Can't total"),
    planned: t('projectDetail.billingMilestones.status.planned', 'Planned'),
    'in-progress': t('projectDetail.billingMilestones.status.inProgress', 'In progress'),
    invoiced: t('projectDetail.billingMilestones.status.invoiced', 'Invoiced'),
    paid: t('projectDetail.billingMilestones.status.paid', 'Paid'),
  };
  const dates = (w: (typeof rows)[number]) =>
    w.start_date && w.end_date ? t('projectDetail.billingMilestones.dates', '{{start}} – {{end}}', { start: formatDateOnly(w.start_date), end: formatDateOnly(w.end_date) })
      : w.start_date ? t('projectDetail.billingMilestones.startOnly', 'From {{date}}', { date: formatDateOnly(w.start_date) })
      : w.end_date ? t('projectDetail.billingMilestones.endOnly', 'Due {{date}}', { date: formatDateOnly(w.end_date) })
      : w.order_date ? t('projectDetail.billingMilestones.ordered', 'Ordered {{date}}', { date: formatDateOnly(w.order_date) })
      : t('projectDetail.billingMilestones.noDates', 'No dates');
  return shell(
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((w) => {
        const b = billingById.get(w.id);
        const derived = b ? deriveBillingMilestoneStatus(w.status, b) : null;
        const aged = ageById.get(w.id);
        return (
          <li key={w.id} data-testid={`billing-milestone-${w.id}`} className="flex min-w-0 flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <Link to={`${contractHref}?wo=${encodeURIComponent(w.id)}`} className="font-medium text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                {w.wo_number ?? t('projectDetail.billingMilestones.notIssued', 'Not issued yet')}
              </Link>
              <span className="ml-2 break-words text-sm text-foreground">{w.title}</span>
              <p className="text-xs text-muted-foreground tabular-nums">{dates(w)}</p>
              {aged && <Tooltip content={t('projectDetail.workOrders.acceptanceAgeSource', 'Counted from the earliest confirmed BAST not yet followed by a submitted invoice.')}>
                <p tabIndex={0} className="text-xs font-semibold text-warning-foreground">{t('projectDetail.workOrders.acceptanceAge', 'Days since acceptance, not invoiced: {{days}}', { days: aged.days })}</p>
              </Tooltip>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {b && <span className="text-sm font-semibold tabular-nums">{formatCurrencyAuto(b.orderNet, b.currency)}{' '}
                <TaxBasisLabel treatment="exclusive" showDetails={false} /></span>}
              {derived && <Tooltip content={t('projectDetail.billingMilestones.statusSource', "Source: this work order's invoices and drafts (Contract & billing).")}>
                <span tabIndex={0}><StatusPill variant={TONE[derived.status]}>{statusLabel[derived.status]}</StatusPill></span></Tooltip>}
              {derived?.overInvoiced && <StatusPill variant="lost">{t('common:projectDetail.workOrders.billing.status.overInvoiced', 'Over-invoiced')}</StatusPill>}
              {/* Navigation into the shipped flow, never a second dialog: WorkOrdersTab re-applies the full gate on arrival (#1640 D5). */}
              {canCreate && b && canInvoiceWorkOrder(w.status, b) && (
                <Link to={`${contractHref}?wo=${encodeURIComponent(w.id)}&invoice=1`}
                  aria-label={t('projectDetail.billingMilestones.invoiceThisLabel', 'Invoice {{order}}', { order: w.wo_number ?? w.title })}
                  className={buttonClasses('primary', 'sm')}>
                  {t('projectDetail.billingMilestones.invoiceThis', 'Invoice this')}
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>,
  );
};

/** Mounted only for the revenue read set; the queries never run otherwise (same gate as the Money block). */
export const BillingMilestonesBlock: React.FC<{ projectId: string }> = ({ projectId }) => {
  const may = usePermission();
  return may('view', 'salesInvoice') ? <Body projectId={projectId} /> : null;
};
export default BillingMilestonesBlock;
