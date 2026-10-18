import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FinancialStatementsSection, type FinancialStatementsSectionState } from '@/src/components/financial-statements/FinancialStatementsSection';
import { ProjectStatementTotals } from '@/src/components/financial-statements/ProjectStatementTotals';
import { StatementPeriodPicker, type StatementPeriodKind } from '@/src/components/financial-statements/StatementPeriodPicker';
import { FormGrid } from '@/src/components/ui/FormFields';
import { useFinancialStatement, useFinancialStatementCatalogue } from '@/src/hooks/useFinancialStatements';
import type { GetFinancialStatementInput } from '@/src/lib/db/financialStatements';
import type { FinancialStatementPair, FinancialStatementRead } from '@/src/lib/financialStatements';
import { formatDateOnly, formatDateTime } from '@/src/lib/format';

export interface ProjectProfitLossSectionProps {
  projectId: string;
}

function latestSuppliedPair(periods: readonly FinancialStatementPair[], kind: StatementPeriodKind): FinancialStatementPair | null {
  const choices = periods.filter((pair) => pair.kind === kind).slice().sort((left, right) => left.currentStart.localeCompare(right.currentStart));
  if (choices.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const begun = choices.filter((pair) => pair.currentStart <= today);
  return begun[begun.length - 1] ?? choices[choices.length - 1] ?? null;
}

function isTotalsRead(value: FinancialStatementRead | undefined): value is FinancialStatementRead & {
  state: 'complete';
  generation: NonNullable<FinancialStatementRead['generation']>;
  result: Extract<NonNullable<FinancialStatementRead['result']>, { viewKind: 'project_totals' }>;
} {
  return value?.state === 'complete' && value.generation !== null && value.generation !== undefined &&
    value.result?.viewKind === 'project_totals';
}

function totalsContext(read: FinancialStatementRead, currentLabel: string, priorLabel: string, captureWindowLabel: string): string {
  if (!isTotalsRead(read)) return '';
  const started = formatDateTime(new Date(read.generation.captureStartedAt));
  const completed = formatDateTime(new Date(read.generation.captureCompletedAt));
  return [
    read.generation.currency,
    `${currentLabel}: ${formatDateOnly(read.result.period.currentStart)} – ${formatDateOnly(read.result.period.currentEnd)}`,
    `${priorLabel}: ${formatDateOnly(read.result.period.priorStart)} – ${formatDateOnly(read.result.period.priorEnd)}`,
    `${captureWindowLabel}: ${started} – ${completed}`,
  ].join(' · ');
}

const ProjectProfitLossSection: React.FC<ProjectProfitLossSectionProps> = ({ projectId }) => {
  const { t } = useTranslation();
  const catalogueQuery = useFinancialStatementCatalogue({ kind: 'project', projectId });
  const catalogue = catalogueQuery.data;
  const [periodKind, setPeriodKind] = useState<StatementPeriodKind>('month');
  const [periodStart, setPeriodStart] = useState<string | null>(null);
  const choices = useMemo(
    () => (catalogue?.state === 'complete' ? catalogue.periods : []).filter((pair) => pair.kind === periodKind),
    [catalogue, periodKind],
  );
  const initialPair = useMemo(() => latestSuppliedPair(catalogue?.periods ?? [], periodKind), [catalogue, periodKind]);
  const selectedPair = periodStart === null
    ? initialPair
    : choices.find((pair) => pair.currentStart === periodStart) ?? null;
  const projectScope = catalogue?.scopes.find((scope) =>
    scope.scopeKind === 'project' && scope.projectId === projectId &&
    scope.statements.includes('profit_and_loss') && scope.viewKinds.includes('project_totals'));
  const selection: GetFinancialStatementInput | null = catalogue?.state === 'complete' && projectScope && selectedPair
    ? {
        periodKind,
        periodStart: selectedPair.currentStart,
        statement: 'profit_and_loss',
        projectId,
        viewKind: 'project_totals',
      }
    : null;
  const readQuery = useFinancialStatement(selection, Boolean(catalogueQuery.eligible && selection));
  const totalsRead = readQuery.data;
  const validRead = selection !== null && isTotalsRead(totalsRead);
  const unexpectedResult = selection !== null && totalsRead?.state === 'complete' && totalsRead.result !== null &&
    totalsRead.result.viewKind !== 'project_totals';

  let sectionState: FinancialStatementsSectionState;
  let onRetry = () => undefined;
  if (catalogueQuery.isPending && !catalogue) {
    sectionState = { kind: 'loading' };
  } else if (catalogueQuery.isError && !catalogue) {
    sectionState = { kind: 'error' };
    onRetry = () => { void catalogueQuery.refetch(); };
  } else if (!catalogue || catalogue.state === 'unavailable' || selection === null) {
    sectionState = { kind: 'unavailable' };
  } else if (unexpectedResult) {
    sectionState = { kind: 'error' };
    onRetry = () => { if (readQuery.eligible) void readQuery.refetch(); };
  } else if (validRead) {
    onRetry = () => { if (readQuery.eligible && selection) void readQuery.refetch(); };
    sectionState = {
      kind: 'complete',
      asOf: totalsRead.generation.asOf,
      hasActivity: totalsRead.result.hasActivity,
      delayed: totalsRead.generation.delayed,
      background: readQuery.isFetching ? 'pending' : readQuery.isError ? 'failed' : 'idle',
    };
  } else if (totalsRead?.state === 'unavailable') {
    sectionState = { kind: 'unavailable' };
  } else if (readQuery.isError) {
    sectionState = { kind: 'error' };
    onRetry = () => { if (readQuery.eligible) void readQuery.refetch(); };
  } else if (readQuery.isPending || readQuery.isFetching) {
    sectionState = { kind: 'loading' };
  } else {
    sectionState = { kind: 'unavailable' };
  }

  const currentLabel = t('financialStatements.current', 'Current period');
  const priorLabel = t('financialStatements.prior', 'Previous period');
  const currentColumnLabel = t('financialStatements.currentColumn', 'Current');
  const priorColumnLabel = t('financialStatements.priorColumn', 'Previous');
  const captureWindowLabel = t('financialStatements.captureWindow', 'Capture window');
  const sectionLabels = {
    unavailable: t('financialStatements.unavailable', 'Statements are not available yet'),
    unavailableDescription: t('financialStatements.unavailableDescription', 'Saved statements will appear here when available.'),
    noActivity: t('financialStatements.noActivity', 'No activity in this period'),
    noActivityDescription: t('financialStatements.noActivityDescription', 'There was no activity in the selected period.'),
    error: t('financialStatements.error', "Couldn't load financial statements"),
    errorDescription: t('financialStatements.errorDescription', 'The request failed. Check your connection and try again.'),
    retry: t('financialStatements.retry', 'Retry'),
    updated: t('financialStatements.updated', 'Updated'),
    delayed: t('financialStatements.delayed', 'Update delayed'),
    refreshing: t('financialStatements.refreshing', 'Refreshing statements…'),
  };

  return (
    <div className="mt-8 min-w-0">
      {catalogue?.state === 'complete' && (
        <FormGrid className="mb-4 min-w-0">
          <StatementPeriodPicker
            kind={periodKind}
            periodStart={selectedPair?.currentStart ?? null}
            periods={choices.map((pair) => ({ kind: pair.kind, periodStart: pair.currentStart, label: `${formatDateOnly(pair.currentStart)} – ${formatDateOnly(pair.currentEnd)} · ${priorLabel}: ${formatDateOnly(pair.priorStart)} – ${formatDateOnly(pair.priorEnd)}` }))}
            labels={{
              kind: t('financialStatements.periodKind', 'Period type'),
              period: t('financialStatements.period', 'Period'),
              month: t('financialStatements.month', 'Month'),
              quarter: t('financialStatements.quarter', 'Quarter'),
              fiscalYear: t('financialStatements.fiscalYear', 'Fiscal year'),
              choosePeriod: t('financialStatements.choosePeriod', 'Choose a period'),
              noPeriods: t('financialStatements.noPeriods', 'No periods available'),
            }}
            onKindChange={(nextKind) => {
              setPeriodKind(nextKind);
              setPeriodStart(latestSuppliedPair(catalogue.periods, nextKind)?.currentStart ?? null);
            }}
            onPeriodChange={setPeriodStart}
            disabled={!catalogueQuery.eligible}
          />
        </FormGrid>
      )}
      <FinancialStatementsSection
        title={t('financialStatements.projectProfitAndLoss', 'Project profit and loss')}
        context={validRead && totalsRead ? totalsContext(totalsRead, currentLabel, priorLabel, captureWindowLabel) : ''}
        state={sectionState}
        labels={sectionLabels}
        onRetry={onRetry}
      >
        {validRead && totalsRead && totalsRead.result.viewKind === 'project_totals' && (
          <ProjectStatementTotals
            current={{ ...totalsRead.result.payload.current, currency: totalsRead.generation.currency }}
            prior={{ ...totalsRead.result.payload.prior, currency: totalsRead.generation.currency }}
            periods={{
              current: { fromDate: totalsRead.result.period.currentStart, toDate: totalsRead.result.period.currentEnd },
              prior: { fromDate: totalsRead.result.period.priorStart, toDate: totalsRead.result.period.priorEnd },
            }}
            labels={{
              current: currentColumnLabel,
              prior: priorColumnLabel,
              income: t('financialStatements.income', 'Income'),
              expense: t('financialStatements.expense', 'Expense'),
              net: t('financialStatements.net', 'Net'),
              amounts: t('financialStatements.amounts', 'Amounts'),
            }}
          />
        )}
      </FinancialStatementsSection>
    </div>
  );
};

export default ProjectProfitLossSection;
