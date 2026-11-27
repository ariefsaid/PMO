import React, { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { Icon } from '@/src/components/ui';
import { formatTableMoney } from '@/src/lib/format';
import { useWorkOrderCostLeftOut } from '@/src/hooks/useWorkOrderCostLeftOut';
import { summarizeLeftOut, type LeftOutItem, type WorkOrderCostLeftOut } from '@/src/lib/db/workOrderCostLeftOut';

interface Props {
  workOrderId: string;
  /** Optional pre-loaded data (used in unit tests without a live session). */
  data?: WorkOrderCostLeftOut | null;
}

/**
 * #3026: Shows amounts left out of a work order's direct cost directly under the direct-cost table.
 * Renders nothing when all left-out counts are zero (zero standing words).
 * Starts collapsed as one line ('Not yet counted: N records' plus total when every kind has one)
 * and expands to the per-kind breakdown.
 */
export const CostLeftOutBlock: React.FC<Props> = ({ workOrderId, data }) => {
  const signedIn = useContext(AuthContext) !== undefined;
  if (data !== undefined) {
    return data && data.items.length > 0 ? <CostLeftOutView data={data} /> : null;
  }
  return signedIn ? <CostLeftOutLive workOrderId={workOrderId} /> : null;
};

const CostLeftOutLive: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const q = useWorkOrderCostLeftOut(workOrderId);
  if (!q.data || q.data.items.length === 0) return null;
  return <CostLeftOutView data={q.data} />;
};

const CostLeftOutView: React.FC<{ data: WorkOrderCostLeftOut }> = ({ data }) => {
  const { t } = useTranslation('workOrderPva');
  const [open, setOpen] = useState(false);
  const summary = summarizeLeftOut(data);

  const combinedMoney = summary.combinedTotal
    ? formatTableMoney(summary.combinedTotal.amount, summary.combinedTotal.currency)
    : null;

  const summaryLabel = combinedMoney
    ? t('leftOut.summaryWithTotal', {
        count: summary.totalCount,
        total: combinedMoney,
        defaultValue: summary.totalCount === 1
          ? 'Not yet counted: {{count}} record ({{total}})'
          : 'Not yet counted: {{count}} records ({{total}})',
      })
    : t('leftOut.summary', {
        count: summary.totalCount,
        defaultValue: summary.totalCount === 1
          ? 'Not yet counted: {{count}} record'
          : 'Not yet counted: {{count}} records',
      });

  const settingNote = (item: LeftOutItem): string | null => {
    if (item.kind === 'unrated_labour' && !data.labourCostEnabled) {
      return t('leftOut.labourCostOff', 'Labour costing is off');
    }
    if (item.kind === 'uncounted_stock' && !data.stockIssueCostEnabled) {
      return t('leftOut.stockCostOff', 'Stock issue costing is off');
    }
    return null;
  };

  return (
    <div className="mt-3" data-testid="wo-cost-left-out">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="wo-cost-left-out-panel"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 text-control text-muted-foreground hover:text-foreground"
        data-testid="wo-cost-left-out-toggle"
      >
        <Icon name={open ? 'down' : 'chev'} className="size-3.5" />
        <span>{summaryLabel}</span>
      </button>

      {open && (
        <ul
          id="wo-cost-left-out-panel"
          className="mt-2 space-y-1.5 border-t border-border-subtle pt-2 text-control"
          data-testid="wo-cost-left-out-list"
        >
          {data.items.map((item) => {
            const note = settingNote(item);
            const totalText = item.total !== null && item.currency !== null
              ? formatTableMoney(item.total, item.currency)
              : null;
            return (
              <li
                key={item.kind}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
                data-testid={`wo-cost-left-out-item-${item.kind}`}
              >
                <span className="text-foreground">
                  {t(`leftOut.kind.${item.kind}`, item.kind)}
                  {' · '}
                  <span className="text-muted-foreground">
                    {t('leftOut.count', {
                      count: item.count,
                      defaultValue: item.count === 1 ? '{{count}} record' : '{{count}} records',
                    })}
                    {note ? ` · ${note}` : ''}
                  </span>
                </span>
                <span className="tabular-nums text-right text-muted-foreground" data-testid={`wo-cost-left-out-amount-${item.kind}`}>
                  {totalText ?? t('leftOut.countOnly', 'Count only')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
