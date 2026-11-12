import { projectCodedPickerLabel } from '@/src/lib/projectDisplayName';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useUrlFilters } from '@/src/components/ui';
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
import { OdooStatementsSection } from '@/src/components/financial-statements/OdooStatementsSection';
import { useFinancialStatement, useFinancialStatementCatalogue } from '@/src/hooks/useFinancialStatements';
import { useOdooLedgerMode } from '@/src/hooks/useOdooLedger';
import { LedgerModeNotice } from '@/src/components/odoo-ledger/LedgerModeNotice';
import type { GetFinancialStatementInput } from '@/src/lib/db/financialStatements';
import type { FinancialStatementPair, FinancialStatementRead, FinancialStatementScope } from '@/src/lib/financialStatements';
import { formatDayYear } from '@/src/lib/format';
import { repositories } from '@/src/lib/repositories';

const STATEMENTS = ['trial_balance', 'profit_and_loss', 'balance_sheet'] as const;
type Statement = typeof STATEMENTS[number];
const COMPANY_SCOPE = 'company';

// #1930: the acceptance only queues the org refresh (available_at is +5 minutes); the sweep
// republishes later. Poll the read until the published generation changes or the window closes.
const REFRESH_POLL_INTERVAL_MS = 30_000;
// available_at (+5 min) plus a margin, rounded up to one cap: 10 minutes from acceptance.
const REFRESH_POLL_CAP_MS = 10 * 60 * 1000;

type RefreshWatch = {
  baseline: { asOf: string; snapshotId: string } | null;
  deadline: number;
};

function latestSuppliedPair(periods: readonly FinancialStatementPair[], kind: StatementPeriodKind): FinancialStatementPair | null {
  const choices = periods.filter((pair) => pair.kind === kind).slice().sort((left, right) => left.currentStart.localeCompare(right.currentStart));
  if (choices.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const begun = choices.filter((pair) => pair.currentStart <= today);
  return begun[begun.length - 1] ?? choices[choices.length - 1] ?? null;
}

function pairLabel(pair: FinancialStatementPair, priorLabel: string): string {
  return `${formatDayYear(pair.currentStart)} – ${formatDayYear(pair.currentEnd)} · ${priorLabel}: ${formatDayYear(pair.priorStart)} – ${formatDayYear(pair.priorEnd)}`;
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
  // #1507 S7: an Odoo organisation reads its statements from the Odoo ledger; the saved-report path below is not asked for them.
  const odooMode = useOdooLedgerMode(companyReadAllowed);
  const catalogueQuery = useFinancialStatementCatalogue({ kind: 'company' }, companyReadAllowed && !odooMode.odoo);
  const catalogue = catalogueQuery.data;

  // R2: period kind/start and statement are URL-owned so Back/refresh (and a shared link)
  // restore them; defaults stay out of the URL (empty = monthly Trial Balance, latest period).
  const { values, setFilter, setFilters } = useUrlFilters(['periodKind', 'periodStart', 'statement', 'scope']);
  const PERIOD_KINDS: readonly StatementPeriodKind[] = ['month', 'quarter', 'fiscal_year'];
  const periodKind = PERIOD_KINDS.includes(values.periodKind as StatementPeriodKind)
    ? values.periodKind as StatementPeriodKind
    : 'month';
  const statement = (STATEMENTS as readonly string[]).includes(values.statement)
    ? values.statement as Statement
    : 'trial_balance';
  const periodStart = values.periodStart || null;
  // Scope stays component state because "retired" (a mapped name vanished) is a state the URL
  // cannot carry: absent means the Company default. It seeds from the URL and follows it when
  // Back/refresh change it underneath; user- and data-driven changes write state + URL together.
  const scopeParam = values.scope;
  const [selectedScope, setSelectedScope] = useState<string | null>(scopeParam || COMPANY_SCOPE);
  useEffect(() => {
    setSelectedScope(scopeParam || COMPANY_SCOPE);
  }, [scopeParam]);
  const writeScope = (next: string | null) => {
    setSelectedScope(next);
    setFilter('scope', next && next !== COMPANY_SCOPE ? next : '');
  };

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
  const projectNames = useQuery({
    queryKey: ['financial-statements', 'mapped-project-name', currentUser?.org_id, currentUser?.id, realRole, [...admittedProjectIds].sort()],
    queryFn: () => repositories.project.getMany(admittedProjectIds),
    enabled: Boolean(catalogueQuery.eligible && catalogue?.state === 'complete' && currentUser?.org_id && admittedProjectIds.length > 0),
  });
  const namedProjectOptions = useMemo(() => {
    if (projectNames.isError) return [];
    const byId = new Map((projectNames.data ?? []).map((project) => [project.id, project]));
    return admittedProjectIds.flatMap((projectId) => {
      const project = byId.get(projectId);
      if (!project || typeof project.name !== 'string' || project.name.trim() === '') return [];
      return [{ value: projectId, label: projectCodedPickerLabel(project) }];
    });
  }, [admittedProjectIds, projectNames.data, projectNames.isError]);

  useEffect(() => {
    if (!projectNames.isError && selectedScope !== COMPANY_SCOPE && selectedScope !== null && !namedProjectOptions.some((option) => option.value === selectedScope)) {
      setSelectedScope(null);
    }
  }, [namedProjectOptions, projectNames.isError, selectedScope]);

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
  const selection: GetFinancialStatementInput | null = catalogue?.state === 'complete' && selectedPair !== null && scopeAdmitsStatement && selectedScope !== null
    ? {
        periodKind,
        periodStart: selectedPair.currentStart,
        statement,
        ...(selectedScope === COMPANY_SCOPE ? {} : { projectId: selectedScope }),
        viewKind: 'account_breakdown',
      }
    : null;
  const queryClient = useQueryClient();
  // The generation shown while "Refresh now" was accepted; the poll stops once the published
  // generation differs (new asOf or snapshot id), or the cap passes. Declared before the read
  // query: react-query invokes the refetchInterval callback outside render, never in it.
  const [refreshWatch, setRefreshWatch] = useState<RefreshWatch | null>(null);
  const displayedGenerationRef = useRef<{ asOf: string; snapshotId: string } | null>(null);
  const pollStatementRead = (query: { state: { data?: FinancialStatementRead } }): number | false => {
    if (!refreshWatch) return false;
    const data = query.state.data;
    if (!data || data.state !== 'complete' || data.generation === null || !refreshWatch.baseline) {
      return Date.now() < refreshWatch.deadline ? REFRESH_POLL_INTERVAL_MS : false;
    }
    const published = data.generation;
    const changed = published.asOf !== refreshWatch.baseline.asOf || published.snapshotId !== refreshWatch.baseline.snapshotId;
    if (changed) return false;
    return Date.now() < refreshWatch.deadline ? REFRESH_POLL_INTERVAL_MS : false;
  };
  const readQuery = useFinancialStatement(selection, Boolean(catalogueQuery.eligible && selection), pollStatementRead);
  const detailRead = readQuery.data;
  const isValidRead = selection !== null && completeDetailRead(detailRead);
  if (isValidRead && detailRead !== undefined && detailRead.state === 'complete' && detailRead.generation !== null) {
    displayedGenerationRef.current = {
      asOf: detailRead.generation.asOf,
      snapshotId: detailRead.generation.snapshotId,
    };
  }
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
  const statementTitle = statementOptions.find((option) => option.value === statement)?.label ?? '';
  const scopeOptions = [
    { value: COMPANY_SCOPE, label: t('financialStatements.companyScope', 'Company') },
    ...(projectNames.isError && selectedScope && selectedScope !== COMPANY_SCOPE
      ? [{ value: selectedScope, label: t('finance:financialStatements.selectedProjectNameUnavailable', 'Selected project name unavailable') }]
      : []),
    ...namedProjectOptions,
  ];

  const refreshNowMutation = useMutation({
    mutationFn: () => repositories.financialStatements.refreshNow(),
    // #1930: once the refresh intent is accepted, the sweep republishes the statement; refetch
    // immediately, then poll on an interval until the new figures reach the screen (or the cap
    // closes the window) so no manual reload is needed. Coalesced/unavailable poll nothing.
    onSuccess: (result) => {
      if (result === 'accepted') {
        void queryClient.invalidateQueries({
          queryKey: ['financial-statements'],
          predicate: (query) => query.queryKey.includes('read'),
        });
        setRefreshWatch({ baseline: displayedGenerationRef.current, deadline: Date.now() + REFRESH_POLL_CAP_MS });
      }
    },
  });
  const refreshNote = refreshNowMutation.isError
    ? t('financialStatements.refreshNowError', 'Could not request a refresh. Try again.')
    : refreshNowMutation.data === 'accepted'
      ? t('financialStatements.refreshNowQueued', 'Refresh requested. New figures appear shortly.')
      : refreshNowMutation.data === 'coalesced'
        ? t('financialStatements.refreshNowCoalesced', 'A refresh was requested recently.')
        : refreshNowMutation.data === 'unavailable'
          ? t('financialStatements.refreshNowUnavailable', 'Refresh is not available yet.')
          : undefined;

  let sectionState: FinancialStatementsSectionState;
  let sectionRetry = () => undefined;
  if (catalogueQuery.isPending && !catalogue) {
    sectionState = { kind: 'loading' };
  } else if (catalogueQuery.isError && !catalogue) {
    sectionState = { kind: 'error' };
    sectionRetry = () => { void catalogueQuery.refetch(); };
  } else if (projectNames.isError && selectedScope !== COMPANY_SCOPE && selectedScope !== null) {
    sectionState = { kind: 'error' };
    sectionRetry = () => { void projectNames.refetch(); };
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
      <ListPage title={t('financeHub:hub.statements', 'Statements')}>
        <ListState variant="loading" shape="detail" />
      </ListPage>
    );
  }

  if (!catalogueQuery.eligible) {
    return (
      <ListPage title={t('financeHub:hub.statements', 'Statements')}>
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

  if (odooMode.odoo) {
    return (
      <ListPage title={t('financeHub:hub.statements', 'Statements')} className="min-w-0">
        <OdooStatementsSection />
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
    collapseGroup: (group: string) => tf('statements.collapseGroup', 'Collapse {{group}}', { group }),
    expandGroup: (group: string) => tf('statements.expandGroup', 'Expand {{group}}', { group }),
    collapseAll: tf('statements.collapseAll', 'Collapse all'),
    expandAll: tf('statements.expandAll', 'Expand all'),
  };
  const sectionLabels = {
    unavailable: t('financialStatements.unavailable', 'No statements yet'),
    unavailableDescription: t('financialStatements.unavailableDescription', 'Statements come from the accounting system.'),
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
      title={t('financeHub:hub.statements', 'Statements')}
     
      className="min-w-0"
    >
      {odooMode.error && <LedgerModeNotice className="mb-4" onRetry={odooMode.retry} />}
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
                // One batched write (react-router 8 does not queue same-tick param writes):
                // the new period kind plus the period reset to that kind's latest pair.
                setFilters({
                  periodKind: nextKind === 'month' ? '' : nextKind,
                  periodStart: latestSuppliedPair(catalogue.periods, nextKind)?.currentStart ?? '',
                });
              }}
              onPeriodChange={(nextPeriodStart: string) => setFilter('periodStart', nextPeriodStart)}
              disabled={!catalogueQuery.eligible}
            />
            <SelectField
              label={t('financialStatements.statement', 'Statement')}
              value={statement}
              options={statementOptions}
              onChange={(value) => {
                if (!(STATEMENTS as readonly string[]).includes(value)) return;
                const nextStatement = value as Statement;
                // Batched write: project scope only exists on profit-and-loss, so switching away
                // resets it to the Company default (absent from the URL) in the same update.
                if (nextStatement !== 'profit_and_loss') {
                  setFilters({ statement: nextStatement === 'trial_balance' ? '' : nextStatement, scope: '' });
                } else {
                  setFilter('statement', nextStatement);
                }
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
                  if (value === COMPANY_SCOPE || namedProjectOptions.some((option) => option.value === value)) writeScope(value);
                }}
                disabled={!catalogueQuery.eligible}
              />
            )}
          </FormGrid>
        </div>
      )}
      <FinancialStatementsSection
        title={statementTitle}
        state={sectionState}
        labels={sectionLabels}
        onRetry={sectionRetry}
        unavailableAction={may('manage', 'integration') ? { label: tf('statements.setUp', 'Set up accounting'), onClick: () => navigate('/administration/integrations') } : undefined}
        refreshNow={{
          label: t('financialStatements.refreshNow', 'Refresh now'),
          pending: refreshNowMutation.isPending,
          note: refreshNote,
          onClick: () => refreshNowMutation.mutate(),
        }}
      >
        {isValidRead && detailRead && detailRead.result.viewKind === 'account_breakdown' && (
          <NativeStatementPair
            pair={detailRead.result.payload}
            reportTitle={statementTitle}
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
