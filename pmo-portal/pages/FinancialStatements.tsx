import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { FinancialStatementsSection, type FinancialStatementsSectionState } from '@/src/components/financial-statements/FinancialStatementsSection';
import { NativeStatementPair } from '@/src/components/financial-statements/NativeStatementPair';
import { StatementPeriodPicker, type StatementPeriodKind } from '@/src/components/financial-statements/StatementPeriodPicker';
import { Button } from '@/src/components/ui/Button';
import { FormGrid, SelectField } from '@/src/components/ui/FormFields';
import { ListPage } from '@/src/components/ui/ListPage';
import { ListState } from '@/src/components/ui/ListState';
import { useFinancialStatement, useFinancialStatementCatalogue } from '@/src/hooks/useFinancialStatements';
import type { GetFinancialStatementInput } from '@/src/lib/db/financialStatements';
import type { FinancialStatementPair, FinancialStatementRead, FinancialStatementScope } from '@/src/lib/financialStatements';
import { formatDateOnly } from '@/src/lib/format';
import { repositories } from '@/src/lib/repositories';

const STATEMENTS = ['trial_balance', 'profit_and_loss', 'balance_sheet'] as const;
type Statement = typeof STATEMENTS[number];
const COMPANY_SCOPE = 'company';

function latestSuppliedPair(periods: readonly FinancialStatementPair[], kind: StatementPeriodKind): FinancialStatementPair | null {
  const choices = periods.filter((pair) => pair.kind === kind).slice().sort((left, right) => left.currentStart.localeCompare(right.currentStart));
  if (choices.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const begun = choices.filter((pair) => pair.currentStart <= today);
  return begun[begun.length - 1] ?? choices[choices.length - 1] ?? null;
}

function pairLabel(pair: FinancialStatementPair, priorLabel: string): string {
  return `${formatDateOnly(pair.currentStart)} – ${formatDateOnly(pair.currentEnd)} · ${priorLabel}: ${formatDateOnly(pair.priorStart)} – ${formatDateOnly(pair.priorEnd)}`;
}

function reportTitle(statement: Statement, t: (key: string, fallback: string) => string): string {
  if (statement === 'trial_balance') return t('financialStatements.trialBalance', 'Trial balance');
  if (statement === 'profit_and_loss') return t('financialStatements.profitAndLoss', 'Profit and loss');
  return t('financialStatements.balanceSheet', 'Balance sheet');
}

function completeDetailRead(value: FinancialStatementRead | undefined): value is FinancialStatementRead & {
  state: 'complete';
  generation: NonNullable<FinancialStatementRead['generation']>;
  result: Extract<NonNullable<FinancialStatementRead['result']>, { viewKind: 'account_breakdown' }>;
} {
  return value?.state === 'complete' && value.generation !== null && value.generation !== undefined &&
    value.result?.viewKind === 'account_breakdown';
}

const FinancialStatements: React.FC = () => {
  const { t } = useTranslation();
  const { t: tf } = useTranslation('finance');
  const navigate = useNavigate();
  const { session, currentUser, loading, profileError } = useAuth();
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const identityReady = !loading && profileError === null && session?.user.id === currentUser?.id &&
    currentUser?.status === 'active' && Boolean(currentUser.org_id?.trim()) && realRole === currentUser.role;
  const companyReadAllowed = identityReady && may('view', 'financialStatements');
  const catalogueQuery = useFinancialStatementCatalogue({ kind: 'company' }, companyReadAllowed);
  const catalogue = catalogueQuery.data;

  const [periodKind, setPeriodKind] = useState<StatementPeriodKind>('month');
  const [periodStart, setPeriodStart] = useState<string | null>(null);
  const [statement, setStatement] = useState<Statement>('trial_balance');
  const [selectedScope, setSelectedScope] = useState<string | null>(COMPANY_SCOPE);

  const admittedProjectScopes = useMemo(
    () => (catalogue?.state === 'complete' ? catalogue.scopes : []).filter((scope) =>
      scope.scopeKind === 'project' && scope.projectId !== null &&
      scope.statements.includes('profit_and_loss') && scope.viewKinds.includes('account_breakdown')),
    [catalogue],
  );
  const admittedProjectIds = useMemo(
    () => admittedProjectScopes.flatMap((scope) => scope.projectId ? [scope.projectId] : []),
    [admittedProjectScopes],
  );
  const projectNameQueries = useQueries({
    queries: admittedProjectIds.map((projectId) => ({
      queryKey: ['financial-statements', 'mapped-project-name', currentUser?.org_id, currentUser?.id, realRole, projectId],
      queryFn: () => repositories.project.get(projectId),
      enabled: Boolean(catalogueQuery.eligible && catalogue?.state === 'complete' && currentUser?.org_id),
    })),
  });
  const namedProjectOptions = admittedProjectIds.flatMap((projectId, index) => {
    const query = projectNameQueries[index];
    if (!query || query.isError) return [];
    const project = query.data;
    if (!project || typeof project.name !== 'string' || project.name.trim() === '') return [];
    const label = project.code ? `${project.code} · ${project.name}` : project.name;
    return [{ value: projectId, label }];
  });

  useEffect(() => {
    if (selectedScope !== COMPANY_SCOPE && selectedScope !== null && !namedProjectOptions.some((option) => option.value === selectedScope)) {
      setSelectedScope(null);
    }
  }, [namedProjectOptions, selectedScope]);

  const kindPeriods = useMemo(
    () => (catalogue?.state === 'complete' ? catalogue.periods : []).filter((pair) => pair.kind === periodKind),
    [catalogue, periodKind],
  );
  const initialPair = useMemo(() => latestSuppliedPair(catalogue?.periods ?? [], periodKind), [catalogue, periodKind]);
  const selectedPair = periodStart === null
    ? initialPair
    : kindPeriods.find((pair) => pair.currentStart === periodStart) ?? null;
  const pickerPeriod = selectedPair?.currentStart ?? null;

  const companyScope = catalogue?.scopes.find((scope) => scope.scopeKind === 'company');
  const selectedProjectScope = selectedScope && selectedScope !== COMPANY_SCOPE
    ? admittedProjectScopes.find((scope) => scope.projectId === selectedScope)
    : undefined;
  const selectedProjectHasReadableName = selectedScope === COMPANY_SCOPE ||
    (selectedScope !== null && namedProjectOptions.some((option) => option.value === selectedScope));
  const currentScope: FinancialStatementScope | undefined = selectedScope === COMPANY_SCOPE
    ? companyScope
    : selectedProjectScope;
  const scopeAdmitsStatement = Boolean(selectedProjectHasReadableName && currentScope && currentScope.statements.includes(statement) && currentScope.viewKinds.includes('account_breakdown'));
  const validPeriod = selectedPair !== null && selectedPair.currentStart === pickerPeriod;
  const selection: GetFinancialStatementInput | null = catalogue?.state === 'complete' && validPeriod && scopeAdmitsStatement && selectedScope !== null
    ? {
        periodKind,
        periodStart: selectedPair.currentStart,
        statement,
        ...(selectedScope === COMPANY_SCOPE ? {} : { projectId: selectedScope }),
        viewKind: 'account_breakdown',
      }
    : null;
  const readQuery = useFinancialStatement(selection, Boolean(catalogueQuery.eligible && selection));
  const detailRead = readQuery.data;
  const isValidRead = selection !== null && completeDetailRead(detailRead);
  const unexpectedResult = selection !== null && detailRead?.state === 'complete' && detailRead.result !== null &&
    detailRead.result.viewKind !== 'account_breakdown';

  const periodChoices = kindPeriods.map((pair) => ({
    kind: pair.kind,
    periodStart: pair.currentStart,
    label: pairLabel(pair, t('financialStatements.prior', 'Previous period')),
  }));
  const statementOptions = [
    { value: 'trial_balance', label: t('financialStatements.trialBalance', 'Trial balance') },
    { value: 'profit_and_loss', label: t('financialStatements.profitAndLoss', 'Profit and loss') },
    { value: 'balance_sheet', label: t('financialStatements.balanceSheet', 'Balance sheet') },
  ];
  const scopeOptions = [
    { value: COMPANY_SCOPE, label: t('financialStatements.companyScope', 'Company') },
    ...namedProjectOptions,
  ];

  let sectionState: FinancialStatementsSectionState;
  let sectionRetry = () => undefined;
  if (catalogueQuery.isPending && !catalogue) {
    sectionState = { kind: 'loading' };
  } else if (catalogueQuery.isError && !catalogue) {
    sectionState = { kind: 'error' };
    sectionRetry = () => { void catalogueQuery.refetch(); };
  } else if (!catalogue || catalogue.state === 'unavailable' || selection === null) {
    sectionState = { kind: 'unavailable' };
  } else if (unexpectedResult) {
    sectionState = { kind: 'error' };
    sectionRetry = () => { if (readQuery.eligible) void readQuery.refetch(); };
  } else if (isValidRead) {
    sectionRetry = () => { if (readQuery.eligible && selection) void readQuery.refetch(); };
    sectionState = {
      kind: 'complete',
      asOf: detailRead.generation.asOf,
      hasActivity: detailRead.result.hasActivity,
      delayed: detailRead.generation.delayed,
      background: readQuery.isFetching ? 'pending' : readQuery.isError ? 'failed' : 'idle',
    };
  } else if (detailRead?.state === 'unavailable') {
    sectionState = { kind: 'unavailable' };
  } else if (readQuery.isError) {
    sectionState = { kind: 'error' };
    sectionRetry = () => { if (readQuery.eligible) void readQuery.refetch(); };
  } else if (readQuery.isPending || readQuery.isFetching) {
    sectionState = { kind: 'loading' };
  } else {
    sectionState = { kind: 'unavailable' };
  }

  if (loading || (session !== null && currentUser === null && profileError === null)) {
    return (
      <ListPage title={t('shell.nav.financialStatements', 'Financial statements')}>
        <ListState variant="loading" />
      </ListPage>
    );
  }

  if (!catalogueQuery.eligible) {
    return (
      <ListPage title={t('shell.nav.financialStatements', 'Financial statements')}>
        <section className="min-w-0 rounded-lg border border-border bg-card p-4" aria-labelledby="financial-statements-access-title">
          <h2 id="financial-statements-access-title" className="text-base font-semibold text-foreground">
            {t('financialStatements.accessDenied', "You don't have access to financial statements")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('financialStatements.accessDeniedDescription', 'Company statements are available to Admin, Finance, and Executive roles.')}
          </p>
          <Button variant="outline" className="mt-3" onClick={() => navigate('/')}>
            {t('financialStatements.backToDashboard', 'Back to dashboard')}
          </Button>
        </section>
      </ListPage>
    );
  }

  const labels = {
    current: t('financialStatements.current', 'Current period'),
    prior: t('financialStatements.prior', 'Previous period'),
    noActivity: t('financialStatements.noActivity', 'No activity in this period'),
    noActivityDescription: t('financialStatements.noActivityDescription', 'There was no activity in the selected period.'),
    notProvided: t('financialStatements.notProvided', 'Not provided'),
    asAt: t('financialStatements.asAt', 'As at'),
    forThePeriod: tf('statements.forThePeriod', 'For the period'),
    amountsIn: tf('statements.amountsIn', 'Amounts in'),
    periodShown: tf('statements.periodShown', 'Period shown'),
  };
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
    <ListPage
      title={t('shell.nav.financialStatements', 'Financial statements')}
     
      className="min-w-0"
    >
      {catalogue?.state === 'complete' && (
        <div className="mb-4 flex min-w-0 flex-col gap-4">
          <FormGrid className="min-w-0">
            <StatementPeriodPicker
              kind={periodKind}
              periodStart={pickerPeriod}
              periods={periodChoices}
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
            <SelectField
              label={t('financialStatements.statement', 'Statement')}
              value={statement}
              options={statementOptions}
              onChange={(value) => {
                if (!(STATEMENTS as readonly string[]).includes(value)) return;
                const nextStatement = value as Statement;
                setStatement(nextStatement);
                if (nextStatement !== 'profit_and_loss') setSelectedScope(COMPANY_SCOPE);
              }}
              disabled={!catalogueQuery.eligible}
            />
            {statement === 'profit_and_loss' && admittedProjectIds.length > 0 && (
              <SelectField
                label={t('financialStatements.scope', 'Scope')}
                value={selectedScope && scopeOptions.some((option) => option.value === selectedScope) ? selectedScope : ''}
                options={scopeOptions}
                placeholder={t('financialStatements.chooseScope', 'Choose a scope')}
                onChange={(value) => {
                  if (value === COMPANY_SCOPE || namedProjectOptions.some((option) => option.value === value)) setSelectedScope(value);
                }}
                disabled={!catalogueQuery.eligible}
              />
            )}
          </FormGrid>
        </div>
      )}
      <FinancialStatementsSection
        title={reportTitle(statement, t)}
        state={sectionState}
        labels={sectionLabels}
        onRetry={sectionRetry}
      >
        {isValidRead && detailRead && detailRead.result.viewKind === 'account_breakdown' && (
          <NativeStatementPair
            pair={detailRead.result.payload}
            reportTitle={reportTitle(statement, t)}
            companyLabel={detailRead.companyLabel}
            currency={detailRead.generation.currency}
            presentation={detailRead.generation.presentation}
            labels={labels}
          />
        )}
      </FinancialStatementsSection>
    </ListPage>
  );
};

export default FinancialStatements;
