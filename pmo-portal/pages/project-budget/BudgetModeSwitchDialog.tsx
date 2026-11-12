import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog } from '@/src/components/ui';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatExactCents, parseExactCents } from '@/src/lib/exactDecimal';
import type {
  BudgetLineItemRow,
  BudgetModeSwitchAssignment,
  BudgetModeSwitchLineWitness,
  BudgetVersionMode,
} from '@/src/lib/db/budgets';

export interface BudgetModeSwitchRequest {
  versionId: string;
  targetMode: BudgetVersionMode;
  expectedLines: BudgetModeSwitchLineWitness[];
  assignments: BudgetModeSwitchAssignment[];
}

interface BudgetModeSwitchDialogProps {
  open: boolean;
  versionId: string;
  currentMode: BudgetVersionMode;
  lines: readonly BudgetLineItemRow[];
  fiscalYearNames: readonly string[];
  currency: string;
  /** Includes role, user, project dates, calendar, version and exact source-line revision. */
  contextKey: string;
  loading?: boolean;
  onConfirm: (request: BudgetModeSwitchRequest) => void;
  onCancel: () => void;
}

function toWitness(lines: readonly BudgetLineItemRow[]): BudgetModeSwitchLineWitness[] {
  return [...lines]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((line) => {
      const cents = parseExactCents(String(line.budgeted_amount));
      if (cents === null || cents < 0n) throw new Error('A budget line has an invalid exact amount.');
      return {
        id: line.id,
        category: line.category,
        budgeted_amount: formatExactCents(cents),
        fiscal_year: line.fiscal_year,
      };
    });
}

const BudgetModeSwitchDialog: React.FC<BudgetModeSwitchDialogProps> = ({
  open,
  versionId,
  currentMode,
  lines,
  fiscalYearNames,
  currency,
  contextKey,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation('finance');
  const targetMode: BudgetVersionMode = currentMode === 'whole_project' ? 'per_year' : 'whole_project';
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [stale, setStale] = useState(false);
  const frozenContext = useRef<string | null>(null);
  const witness = useMemo(() => {
    try {
      return { lines: toWitness(lines), error: null };
    } catch (error) {
      return { lines: [] as BudgetModeSwitchLineWitness[], error: error instanceof Error ? error.message : String(error) };
    }
  }, [lines]);

  useEffect(() => {
    if (!open) {
      frozenContext.current = null;
      setStale(false);
      return;
    }
    if (frozenContext.current === null) {
      frozenContext.current = contextKey;
      setAssignments({});
      setStale(false);
      return;
    }
    if (frozenContext.current !== contextKey) setStale(true);
  }, [contextKey, open]);

  const missingAssignments = targetMode === 'per_year' && lines.some((line) => !assignments[line.id]);
  const noCalendar = targetMode === 'per_year' && fiscalYearNames.length === 0;
  const confirmDisabled = loading || stale || Boolean(witness.error) || noCalendar || missingAssignments;
  const description = targetMode === 'whole_project'
    ? t('projectDetail.budget.switchToWholeProjectBody', 'This clears the fiscal-year assignment from each listed line. Every line amount and category is preserved.')
    : t('projectDetail.budget.switchToPerYearBody', 'Assign every line to one of the available fiscal years. Every line amount and category is preserved.');

  const reviewCurrentLines = () => {
    const currentYears = new Set(fiscalYearNames);
    setAssignments((previous) => Object.fromEntries(
      lines.flatMap((line) => {
        const previousValue = previous[line.id];
        const suggestion = previousValue || line.fiscal_year || '';
        return suggestion && currentYears.has(suggestion) ? [[line.id, suggestion]] : [];
      }),
    ));
    frozenContext.current = contextKey;
    setStale(false);
  };

  const confirm = () => {
    if (confirmDisabled) return;
    onConfirm({
      versionId,
      targetMode,
      expectedLines: witness.lines,
      assignments: targetMode === 'whole_project'
        ? []
        : [...lines]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((line) => ({ id: line.id, fiscal_year: assignments[line.id] })),
    });
  };

  const formattedAmount = (amount: string) =>
    formatExactMoney(amount, currency, getNumberLocale(), { trimZeroFraction: false }) ?? `${currency} ${amount}`;

  return (
    <ConfirmDialog
      open={open}
      title={t('projectDetail.budget.changeBudgetMode', 'Change budget mode')}
      description={(
        <div className="space-y-3">
          <p>{description}</p>
          {stale && (
            <div role="alert" className="rounded-md border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm text-foreground">
              <p>{t('projectDetail.budget.modeReviewStale', 'The source lines, role, project dates, or fiscal-year calendar changed. Review the current lines before continuing.')}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={reviewCurrentLines}>
                {t('projectDetail.budget.reviewCurrentLines', 'Review current lines')}
              </Button>
            </div>
          )}
          {witness.error && <p role="alert" className="text-sm text-destructive-text">{witness.error}</p>}
          {noCalendar && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('projectDetail.budget.modeCalendarUnavailable', 'A current fiscal-year calendar is needed before assigning lines.')}
            </p>
          )}
          {targetMode === 'per_year' && missingAssignments && !noCalendar && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('projectDetail.budget.modeAssignmentsRequired', 'All fiscal-year assignments are required before switching modes.')}
            </p>
          )}
          <div className="max-h-[42vh] overflow-auto rounded-md border border-border">
            <table className="min-w-full border-collapse text-sm" aria-label={t('projectDetail.budget.modeLineReview', 'Budget line review')}>
              <thead className="sticky top-0 bg-muted text-left text-sm text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">{t('financeCopy.category', 'Category')}</th>
                  <th scope="col" className="px-3 py-2">{t('projectDetail.budget.description', 'Description')}</th>
                  {targetMode === 'whole_project' && <th scope="col" className="px-3 py-2">{t('financeCopy.fiscalYear', 'Fiscal year')}</th>}
                  <th scope="col" className="px-3 py-2 text-right tabular tabular-nums">{t('financeCopy.amount', 'Amount')}</th>
                  {targetMode === 'per_year' && <th scope="col" className="px-3 py-2">{t('financeCopy.fiscalYear', 'Fiscal year')}</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const category = budgetCategoryLabel(line.category, t);
                  const descriptionText = line.description?.trim() || category;
                  const amount = witness.lines.find((entry) => entry.id === line.id)?.budgeted_amount;
                  return (
                    <tr key={line.id} className="border-t border-border">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{category}</th>
                      <td className="px-3 py-2 text-muted-foreground">{descriptionText}</td>
                      {targetMode === 'whole_project' && <td className="px-3 py-2">{line.fiscal_year ?? t('financeCopy.unPhased', 'Un-phased')}</td>}
                      <td className="px-3 py-2 text-right tabular-nums">{amount ? formattedAmount(amount) : '—'}</td>
                      {targetMode === 'per_year' && (
                        <td className="min-w-52 px-3 py-2">
                          <label className="sr-only" htmlFor={`mode-year-${line.id}`}>
                            {t('projectDetail.budget.fiscalYearForLine', 'Fiscal year for {{description}}', { description: descriptionText })}
                          </label>
                          <select
                            id={`mode-year-${line.id}`}
                            aria-label={t('projectDetail.budget.fiscalYearForLine', 'Fiscal year for {{description}}', { description: descriptionText })}
                            value={assignments[line.id] ?? ''}
                            onChange={(event) => setAssignments((previous) => ({ ...previous, [line.id]: event.target.value }))}
                            className="touch-target h-11 w-full rounded-md border border-input bg-background px-3 text-control text-foreground"
                            disabled={loading || stale || noCalendar}
                          >
                            <option value="">{t('projectDetail.budget.selectFiscalYear', 'Select fiscal year')}</option>
                            {fiscalYearNames.map((year) => <option key={year} value={year}>{year}</option>)}
                          </select>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr><td colSpan={targetMode === 'per_year' ? 4 : 4} className="px-3 py-3 text-muted-foreground">{t('projectDetail.budget.noBudgetLinesForMode', 'This Draft has no budget lines.')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      confirmLabel={targetMode === 'whole_project'
        ? t('projectDetail.budget.switchToWholeProject', 'Switch to whole-project')
        : t('projectDetail.budget.switchToPerYear', 'Switch to per-year')}
      loading={loading}
      confirmDisabled={confirmDisabled}
      onConfirm={confirm}
      onCancel={onCancel}
    />
  );
};

export default BudgetModeSwitchDialog;
