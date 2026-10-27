import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, DataTable, type Column } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatNumberMax2 } from '@/src/lib/format';
import type { CategoryPosition } from '../useProjectPosition';
import { buildBudgetSummaryRows, type BudgetSummaryRow } from './budgetModel';

interface BudgetSummaryProps {
  project: ProjectWithRefs;
  activeVersion: BudgetVersionWithItems | undefined;
  position: {
    isError: boolean;
    refetch: () => unknown;
    rows: CategoryPosition[];
    canSeeActual: boolean;
    unknown: number;
  };
  procurements: ProcurementWithRefs[] | undefined;
  canReadProcurements: boolean;
  canManageAccounting: boolean;
}

function positionCell(value: number | null, budget: number, t: (key: string, fallback: string, options?: Record<string, unknown>) => string) {
  if (value === null) return null;
  const remaining = budget - value;
  return remaining < 0
    ? <span className="text-destructive-text">{t('projectDetail.budget.over', '{{amount}} over', { amount: formatNumberMax2(Math.abs(remaining)) })}</span>
    : formatNumberMax2(remaining);
}

export default function BudgetSummary({
  project,
  activeVersion,
  position,
  procurements,
  canReadProcurements,
  canManageAccounting,
}: BudgetSummaryProps) {
  const { t } = useTranslation();
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const rows = buildBudgetSummaryRows({
    lines: activeVersion?.line_items ?? [],
    actuals: position.rows,
    procurements,
    canReadProcurements,
    currency: project.currency,
  });
  const label = (category: string) => budgetCategoryLabel(category, t);
  const totalBudget = rows.reduce((sum, row) => sum + row.budget, 0);
  const totalSpent = rows.length > 0 && rows.every((row) => row.spent !== null)
    ? rows.reduce((sum, row) => sum + (row.spent ?? 0), 0)
    : null;
  const totalCommitted = rows.length > 0 && rows.every((row) => row.committed !== null)
    ? rows.reduce((sum, row) => sum + (row.committed ?? 0), 0)
    : null;
  const columns: Column<BudgetSummaryRow>[] = [
    {
      key: 'category',
      header: t('financeCopy.category', 'Category'),
      kind: 'primary',
      rowHeader: true,
      size: 220,
      cell: (row) => label(row.category),
    },
    {
      key: 'budget',
      header: t('financeCopy.budget', 'Budget'),
      kind: 'money',
      align: 'num',
      size: 160,
      cell: (row) => formatNumberMax2(row.budget),
    },
    {
      key: 'spent',
      header: t('projectDetail.budget.spent', 'Spent'),
      kind: 'money',
      align: 'num',
      size: 220,
      cell: (row) => (
        <span className="inline-flex flex-wrap justify-end gap-x-1 tabular-nums">
          {row.spent !== null && <span>{formatNumberMax2(row.spent)}</span>}
          {row.committed !== null && row.committed > 0 && (
            <span className="text-muted-foreground">(+{formatNumberMax2(row.committed)} {t('projectDetail.budget.committed', 'committed')})</span>
          )}
        </span>
      ),
    },
    {
      key: 'left',
      header: t('projectDetail.budget.left', 'Left'),
      kind: 'money',
      align: 'num',
      size: 150,
      cell: (row) => positionCell(row.spent, row.budget, t),
    },
  ];
  const totals = [{
    key: 'total',
    label: t('common.total', 'Total'),
    values: {
      category: t('common.total', 'Total'),
      budget: formatNumberMax2(totalBudget),
      spent: (
        <span className="inline-flex flex-wrap justify-end gap-x-1 tabular-nums">
          {totalSpent !== null && <span>{formatNumberMax2(totalSpent)}</span>}
          {totalCommitted !== null && totalCommitted > 0 && (
            <span className="text-muted-foreground">(+{formatNumberMax2(totalCommitted)} {t('projectDetail.budget.committed', 'committed')})</span>
          )}
        </span>
      ),
      left: positionCell(totalSpent, totalBudget, t),
    },
  }];
  const expanded = rows.find((row) => row.category === expandedCategory);

  return (
    <section aria-label={t('projectDetail.budget.summary', 'Budget summary')} className="min-w-0 space-y-3" data-testid="budget-summary">
      {activeVersion ? (
        <>
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.category}
            rowLabel={(row) => `${expandedCategory === row.category ? 'Collapse' : 'Expand'} ${label(row.category)} details`}
            onActivate={(row) => setExpandedCategory((current) => current === row.category ? null : row.category)}
            selectedKey={expandedCategory ?? undefined}
            totals={totals}
            tableId="project-budget-summary"
            accessibleName={t('projectDetail.budget.tableName', 'Budget by category')}
            cardBelow={600}
          />
          {expanded && (
            <section
              aria-label={t('projectDetail.budget.lineItemsFor', '{{category}} line items', { category: label(expanded.category) })}
              className="rounded-md border border-border px-3 sm:px-4"
              data-testid="budget-category-details"
            >
              <ul className="divide-y divide-border">
                {expanded.lines.map((line) => (
                  <li key={line.id} className="flex min-w-0 items-start justify-between gap-4 py-2 text-sm">
                    <span className="min-w-0 break-words text-muted-foreground">{line.description || '—'}</span>
                    <span className="shrink-0 tabular-nums">{formatNumberMax2(Number(line.budgeted_amount))}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {position.canSeeActual && position.unknown > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('projectDetail.cost.unknownNote', '{{count}} categories have no spending linked yet, so they’re left out.', { count: position.unknown })}{' '}
              {canManageAccounting
                ? <Link to="/administration/accounting#budget-account-map" className="font-medium text-primary-text underline underline-offset-2 hover:text-foreground">{t('projectDetail.cost.finishSetup', 'Finish spending setup')}</Link>
                : t('projectDetail.cost.askAdmin', 'An administrator can finish the setup.')}
            </p>
          )}
          {position.isError && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('projectDetail.budget.actualsError', 'Actual spending could not be loaded.')}{' '}
              <Button variant="ghost" size="sm" onClick={() => void position.refetch()}>{t('common.retry', 'Retry')}</Button>
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('uxs04.noActiveBudget', 'No active budget')}</p>
      )}
    </section>
  );
}
