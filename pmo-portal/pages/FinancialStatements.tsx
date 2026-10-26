import { projectCodedPickerLabel } from '@/src/lib/projectDisplayName';
import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { FinancialStatementsSection, type FinancialStatementsSectionState } from '@/src/components/financial-statements/FinancialStatementsSection';
import { NativeStatementPair } from '@/src/components/financial-statements/NativeStatementPair';
import { StatementPeriodPicker, type StatementPeriodKind } from '@/src/components/financial-statements/StatementPeriodPicker';
import { Button } from '@/src/components/ui/Button';
import { FormGrid, SelectField } from '@/src/components/ui/FormFields';
import { ListState } from '@/src/components/ui/ListState';
import { useFinancialStatement, useFinancialStatementCatalogue } from '@/src/hooks/useFinancialStatements';
import type { GetFinancialStatementInput } from '@/src/lib/db/financialStatements';
import type { FinancialStatementPair, FinancialStatementRead, FinancialStatementScope } from '@/src/lib/financialStatements';
import { formatDateOnly } from '@/src/lib/format';
import { repositories } from '@/src/lib/repositories';

const STATEMENTS = ['trial_balance', 'profit_and_loss', 'balance_sheet'] as const;
type Statement = typeof STATEMENTS[number];
const COMPANY_SCOPE = 'company';
const PERIOD_KINDS: StatementPeriodKind[] = ['month', 'quarter', 'fiscal_year'];

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
  const [params, setParams] = useSearchParams();
  const identityReady = !loading && profileError === null && session?.user.id === currentUser?.id &&
    currentUser?.status === 'active' && Boolean(currentUser.org_id?.trim()) && realRole === currentUser.role;
  const companyReadAllowed = identityReady && may('view', 'financialStatements');
  const catalogueQuery = useFinancialStatementCatalogue({ kind: 'company' }, companyReadAllowed);
  const catalogue = catalogueQuery.data;

  const requestedPeriodKind = params.get('periodKind');
  const periodKind: StatementPeriodKind = PERIOD_KINDS.includes(requestedPeriodKind as StatementPeriodKind)
    ? requestedPeriodKind as StatementPeriodKind
    : 'month';
  const periodStart = params.get('periodStart');
  const requestedStatement = params.get('statement');
  const statement: Statement = (STATEMENTS as readonly string[]).includes(requestedStatement ?? '')
    ? requestedStatement as Statement
    : 'trial_balance';
  const selectedScope = params.get('scope') ?? COMPANY_SCOPE;
  const updateStatementParams = (changes: Record<string, string | null>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    const invalidKind = requestedPeriodKind !== null && !PERIOD_KINDS.includes(requestedPeriodKind as StatementPeriodKind);
    const invalidStatement = requestedStatement !== null && !(STATEMENTS as readonly string[]).includes(requestedStatement);
    if (!invalidKind && !invalidStatement) return;
    const next = new URLSearchParams(params);
    if (invalidKind) next.set('periodKind', 'month');
    if (invalidStatement) next.set('statement', 'trial_balance');
    setParams(next, { replace: true });
  }, [params, requestedPeriodKind, requestedStatement, setParams]);

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
    return [{ value: projectId, label: projectCodedPickerLabel(project) }];
  });

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
  const queryScope = statement === 'profit_and_loss' ? selectedScope : COMPANY_SCOPE;
  const selectedProjectScope = queryScope !== COMPANY_SCOPE
    ? admittedProjectScopes.find((scope) => scope.projectId === queryScope)
    : undefined;
  const selectedProjectHasReadableName = queryScope === COMPANY_SCOPE ||
    namedProjectOptions.some((option) => option.value === queryScope);
  const currentScope: FinancialStatementScope | undefined = queryScope === COMPANY_SCOPE
    ? companyScope
    : selectedProjectScope;
  const scopeAdmitsStatement = Boolean(selectedProjectHasReadableName && currentScope && currentScope.statements.includes(statement) && currentScope.viewKinds.includes('account_breakdown'));
  const validPeriod = selectedPair !== null && selectedPair.currentStart === pickerPeriod;
  const selection: GetFinancialStatementInput | null = catalogue?.state === 'complete' && validPeriod && scopeAdmitsStatement
    ? {
        periodKind,
        periodStart: selectedPair.currentStart,
        statement,
        ...(queryScope === COMPANY_SCOPE ? {} : { projectId: queryScope }),
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
      <section className="min-w-0">
        <ListState variant="loading" />
      </section>
    );
  }

  if (!catalogueQuery.eligible) {
    return (
      <section className="min-w-0">
        <section className="min-w-0 rounded-lg border border-border bg-card p-4" aria-labelledby="financial-statements-access-title">
          <h2 id="financial-statements-access-title" className="text-heading font-semibold text-foreground">
            {t('financialStatements.accessDenied', "You don't have access to financial statements")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('financialStatements.accessDeniedDescription', 'Company statements are available to Admin, Finance, and Executive roles.')}
          </p>
          <Button variant="outline" className="mt-3 min-h-11" onClick={() => navigate('/')}>
            {t('financialStatements.backToDashboard', 'Back to dashboard')}
          </Button>
        </section>
      </section>
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
    collapseGroup: (group: string) => tf('statements.collapseGroup', 'Collapse {{group}}', { group }),
    expandGroup: (group: string) => tf('statements.expandGroup', 'Expand {{group}}', { group }),
    collapseAll: tf('statements.collapseAll', 'Collapse all'),
    expandAll: tf('statements.expandAll', 'Expand all'),
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
    <section className="min-w-0">
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
                updateStatementParams({
                  periodKind: nextKind,
                  periodStart: latestSuppliedPair(catalogue.periods, nextKind)?.currentStart ?? null,
                });
              }}
              onPeriodChange={(value) => updateStatementParams({ periodStart: value })}
              disabled={!catalogueQuery.eligible}
              controlClassName="min-h-11"
            />
            <SelectField
              label={t('financialStatements.statement', 'Statement')}
              value={statement}
              options={statementOptions}
              onChange={(value) => {
                if (!(STATEMENTS as readonly string[]).includes(value)) return;
                const nextStatement = value as Statement;
                updateStatementParams(nextStatement === 'profit_and_loss'
                  ? { statement: nextStatement }
                  : { statement: nextStatement, scope: COMPANY_SCOPE });
              }}
              disabled={!catalogueQuery.eligible}
              className="min-h-11"
            />
            {statement === 'profit_and_loss' && admittedProjectIds.length > 0 && (
              <SelectField
                label={t('financialStatements.scope', 'Scope')}
                value={selectedScope && scopeOptions.some((option) => option.value === selectedScope) ? selectedScope : ''}
                options={scopeOptions}
                placeholder={t('financialStatements.chooseScope', 'Choose a scope')}
                onChange={(value) => {
                  if (value === COMPANY_SCOPE || namedProjectOptions.some((option) => option.value === value)) updateStatementParams({ scope: value });
                }}
                disabled={!catalogueQuery.eligible}
                className="min-h-11"
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
    </section>
  );
};

export default FinancialStatements;
