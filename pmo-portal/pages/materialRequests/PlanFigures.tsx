import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { cn } from '@/src/components/ui';
import { PriorRequestsList, PriorRequestsToggle } from './PriorRequests';

interface Props {
  workOrderId: string;
  itemId: string;
  excludeRequestId?: string | null;
  unit: string;
  plan: number;
  prior: number;
  newTotal: number | undefined;
  overPlan: boolean;
  /** Where the plan figure comes from, said once under it. */
  source?: React.ReactNode;
  /** The section's own plan and earlier requests, when the request names a section. */
  section?: { label: string; plan: number; prior: number } | null;
}

/**
 * A line's position against the work order's plan as figures, not a sentence: Plan, Requested before (tap for the
 * earlier requests), New total (this request included). One figure per cell, the unit beside it; the over-plan mark
 * sits on the total it is about. A section's own plan is a second row on the same columns.
 */
export const PlanFigures: React.FC<Props> = ({ workOrderId, itemId, excludeRequestId, unit, plan, prior, newTotal, overPlan, source, section }) => {
  const { t } = useTranslation('materialRequests');
  const [open, setOpen] = React.useState(false);
  const loc = getNumberLocale();
  const figure = (n: number | undefined) => n === undefined ? '—' : <span>{formatQuantity(String(n), loc)}{unit && <span className="text-muted-foreground"> {unit}</span>}</span>;
  const label = 'text-control text-muted-foreground';
  const value = 'flex min-h-11 items-center whitespace-nowrap text-group font-medium tabular-nums text-foreground';
  return (
    <div className="space-y-2">
      {/* Labels on row 1, figures on row 2, captions on row 3: a label that wraps never moves its figure off the shared baseline. */}
      <div className="space-y-2 rounded-md bg-secondary px-3 py-2" data-testid="mrq-plan">
        <dl className="grid grid-cols-3 gap-x-3">
          <dt className={cn(label, 'col-start-1 row-start-1')}>{t('form.figures.plan', 'Plan')}</dt>
          <dd className={cn(value, 'col-start-1 row-start-2')} data-testid="mrq-plan-qty">{figure(plan)}</dd>
          {source && <dd className="col-start-1 row-start-3 text-control text-muted-foreground" data-testid="mrq-plan-source">{source}</dd>}
          <dt className={cn(label, 'col-start-2 row-start-1')}>{t('form.figures.prior', 'Requested before')}</dt>
          <dd className={cn(value, 'col-start-2 row-start-2')} data-testid="mrq-prior-qty">
            <PriorRequestsToggle prior={prior} open={open} onToggle={() => setOpen((v) => !v)}>{figure(prior)}</PriorRequestsToggle>
          </dd>
          <dt className={cn(label, 'col-start-3 row-start-1')}>{t('form.figures.total', 'New total')}</dt>
          <dd className={cn(value, 'col-start-3 row-start-2')} data-testid="mrq-new-total">{figure(newTotal)}</dd>
          {overPlan && <dd className="col-start-3 row-start-3 text-control font-medium text-warning-foreground">{t('form.overPlan', 'Over plan')}</dd>}
        </dl>
        {section && <dl className="grid grid-cols-3 gap-x-3 border-t border-border pt-2" data-testid="mrq-section-plan">
          <dt className={cn(label, 'col-start-1 row-start-1')}>{t('form.figures.sectionPlan', '{{section}} plan', { section: section.label })}</dt>
          <dd className={cn(value, 'col-start-1 row-start-2')} data-testid="mrq-section-plan-qty">{figure(section.plan)}</dd>
          <dt className={cn(label, 'col-start-2 row-start-1')}>{t('form.figures.prior', 'Requested before')}</dt>
          <dd className={cn(value, 'col-start-2 row-start-2')} data-testid="mrq-section-prior-qty">{figure(section.prior)}</dd>
        </dl>}
      </div>
      <PriorRequestsList workOrderId={workOrderId} itemId={itemId} excludeRequestId={excludeRequestId} prior={prior} open={open} />
    </div>
  );
};
