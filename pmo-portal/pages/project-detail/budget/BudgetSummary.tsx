import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, DataTable, type Column } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatNumberMax2, formatNumberWhole } from '@/src/lib/format';
import type { CategoryPosition } from '../useProjectPosition';
import { buildBudgetSummaryRows, type BudgetSummaryRow } from './budgetModel';

interface BudgetSummaryProps {
  project: ProjectWithRefs;
  activeVersion: BudgetVersionWithItems | undefined;
  position: {
    actualsPending: boolean;
    actualsError: boolean;
    refetchActuals: () => unknown;
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
    ? <span className="text-destructive-text">{t('projectDetail.budget.over', '{{amount}} over', { amount: formatNumberWhole(Math.abs(remaining)) })}</span>
    : formatNumberWhole(remaining);
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
  const totalRemaining = totalSpent === null ? null : totalBudget - totalSpent;
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
          {row.spent !== null && <span>{formatNumberWhole(row.spent)}</span>}
          {row.committed !== null && row.committed > 0 && (
            <span className="text-muted-foreground">(+{formatNumberWhole(row.committed)} {t('projectDetail.budget.committed', 'committed')})</span>
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
  const expanded = rows.find((row) => row.category === expandedCategory);

  return (
    <section aria-label={t('projectDetail.budget.summary', 'Budget summary')} className="min-w-0 space-y-3" data-testid="budget-summary">
      {activeVersion ? (
        <>
          <div className="space-y-1" data-testid="budget-answer">
            <p className={`text-xl font-semibold tabular-nums ${totalRemaining !== null && totalRemaining < 0 ? 'text-destructive-text' : 'text-foreground'}`}>
              {totalRemaining === null
                ? t('projectDetail.cost.budgetOnly', 'Budget {{budget}}', { budget: formatNumberWhole(totalBudget) })
                : totalRemaining < 0
                  ? t('projectDetail.budget.overBudgetHeadline', '{{amount}} over budget', { amount: formatNumberWhole(Math.abs(totalRemaining)) })
                  : t('projectDetail.budget.leftHeadline', '{{amount}} left', { amount: formatNumberWhole(totalRemaining) })}
            </p>
            {totalSpent !== null && <p className="text-sm text-muted-foreground">{t('projectDetail.budget.spentOf', 'Spent {{spent}} of {{budget}}', { spent: formatNumberWhole(totalSpent), budget: formatNumberWhole(totalBudget) })}</p>}
          </div>
          {position.canSeeActual && position.actualsPending && (
            <p className="text-sm text-muted-foreground">{t('projectDetail.cost.spendingChecking', 'Checking spending…')}</p>
          )}
          {position.canSeeActual && position.unknown > 0 && !position.actualsPending && !position.actualsError && (
            <p className="text-sm text-muted-foreground">
              {t('projectDetail.cost.spendingUnlinked', "Spending isn't linked yet.")}{' '}
              {canManageAccounting
                ? <Link to="/administration/accounting#budget-account-map" className="font-medium text-primary-text underline underline-offset-2 hover:text-foreground">{t('projectDetail.cost.finishSetup', 'Finish spending setup')}</Link>
                : t('projectDetail.cost.askAdmin', 'An administrator can finish the setup.')}
            </p>
          )}
          <ul aria-label={t('projectDetail.budget.tableName', 'Budget categories')} className="divide-y divide-border md:hidden">
            {rows.map((row) => {
              const remaining = row.spent === null ? null : row.budget - row.spent;
              const expandedRow = expandedCategory === row.category;
              return (
                <li key={row.category}>
                  <button type="button" className="touch-target flex w-full flex-wrap items-baseline gap-x-1 py-2 text-left text-sm" aria-expanded={expandedRow} onClick={() => setExpandedCategory((current) => current === row.category ? null : row.category)}>
                    <span className="font-medium">{label(row.category)}</span>
                    {row.spent !== null
                      ? <span className="tabular-nums">· {formatNumberWhole(row.spent)} of {formatNumberMax2(row.budget)}</span>
                      : <span className="tabular-nums">· {t('financeCopy.budget', 'Budget')} {formatNumberMax2(row.budget)}</span>}
                    {remaining !== null && <span className={`tabular-nums ${remaining < 0 ? 'text-destructive-text' : 'text-muted-foreground'}`}>· {remaining < 0 ? positionCell(row.spent, row.budget, t) : `${formatNumberWhole(remaining)} ${t('projectDetail.budget.left', 'left')}`}</span>}
                    {row.committed !== null && row.committed > 0 && <span className="basis-full pl-2 text-xs text-muted-foreground">+{formatNumberWhole(row.committed)} {t('projectDetail.budget.committed', 'committed')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.category}
              rowLabel={(row) => `${expandedCategory === row.category ? 'Collapse' : 'Expand'} ${label(row.category)} details`}
              onActivate={(row) => setExpandedCategory((current) => current === row.category ? null : row.category)}
              selectedKey={expandedCategory ?? undefined}
              tableId="project-budget-summary"
              accessibleName={t('projectDetail.budget.tableName', 'Budget by category')}
              className="rounded-none border-0 bg-transparent"
            />
          </div>
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
                    <span className="shrink-0 tabular-nums">{formatNumberWhole(Number(line.budgeted_amount))}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {position.actualsError && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('projectDetail.budget.actualsError', "Couldn't check spending.")}{' '}
              <Button variant="ghost" size="sm" onClick={() => void position.refetchActuals()}>{t('common.retry', 'Retry')}</Button>
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('uxs04.noActiveBudget', 'No active budget')}</p>
      )}
    </section>
  );
}
