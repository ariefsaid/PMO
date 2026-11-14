/** Odoo statements computed from the ledger (#1507 S7, FR-ODA-020..025): Trial Balance, Profit and Loss, Balance Sheet and project Profit and Loss, with the ledger's freshness and its tie to Odoo. */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FinancialStatementsSection, type FinancialStatementsSectionState } from './FinancialStatementsSection';
import { OdooStatementTable } from './OdooStatementTable';
import { StatementPeriodPicker, type StatementPeriodKind } from './StatementPeriodPicker';
import { LedgerProvenance } from '@/src/components/odoo-ledger/LedgerProvenance';
import { statementLedgerState } from '@/src/components/odoo-ledger/ledgerState';
import { formatLedgerAmount } from '@/src/components/odoo-ledger/ledgerFormat';
import { FormGrid, SelectField } from '@/src/components/ui/FormFields';
import { ListState } from '@/src/components/ui/ListState';
import { ViewToggle } from '@/src/components/ui/ViewToggle';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { useOdooLedgerCurrency, useOdooStatement, useOdooStatementCatalogue } from '@/src/hooks/useOdooLedger';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { formatDayYear } from '@/src/lib/format';
import type { OdooLedgerCheck, OdooStatementKind, OdooStatementPair, OdooStatementProvenance, OdooStatementRead } from '@/src/lib/db/odooLedger';
import { useUrlFilters } from '@/src/components/ui/useUrlFilters';

const STATEMENTS: readonly OdooStatementKind[] = ['trial_balance', 'profit_and_loss', 'balance_sheet'];

function latestPair(periods: readonly OdooStatementPair[], kind: StatementPeriodKind, today: string): OdooStatementPair | null {
  const choices = periods.filter((p) => p.kind === kind).slice().sort((a, b) => a.currentStart.localeCompare(b.currentStart));
  if (choices.length === 0) return null;
  const begun = choices.filter((p) => p.currentStart <= today);
  return begun[begun.length - 1] ?? choices[choices.length - 1] ?? null;
}

/** The latest recorded check, in the shape the provenance line shows. The statement carries status and time only. */
function lastCheck(p: OdooStatementProvenance): OdooLedgerCheck | null {
  return p.lastCheck ? { status: p.lastCheck.status, checkedAt: p.lastCheck.checkedAt, reason: null, accountsChecked: 0, stale: false, accounts: [] } : null;
}

export function OdooStatementsSection({ projectId }: { projectId?: string }) {
  const { t } = useTranslation('finance');
  const { t: tc } = useTranslation();
  const today = useOrgToday();
  const currency = useOdooLedgerCurrency();
  const catalogueQuery = useOdooStatementCatalogue(projectId);
  const catalogue = catalogueQuery.data;
  const { values: periodFilters, setFilter, setFilters } = useUrlFilters(['periodKind', 'periodStart']);
  const periodKind: StatementPeriodKind = periodFilters.periodKind === 'quarter' || periodFilters.periodKind === 'fiscal_year'
    ? periodFilters.periodKind
    : 'month';
  const periodStart = periodFilters.periodStart || null;
  const [statement, setStatement] = useState<OdooStatementKind>(projectId ? 'profit_and_loss' : 'trial_balance');
  const [side, setSide] = useState<'current' | 'prior'>('current');
  const periods = useMemo(() => (catalogue?.state === 'complete' ? catalogue.periods : []), [catalogue]);
  const catalogueAsOf = catalogue?.state === 'complete' ? catalogue.asOf : null;
  const choices = periods.filter((p) => p.kind === periodKind);
  const pair = periodStart === null ? latestPair(periods, periodKind, today) : choices.find((p) => p.currentStart === periodStart) ?? null;
  const readQuery = useOdooStatement(
    catalogue?.state === 'complete' && pair ? { statement, periodKind, periodStart: pair.currentStart, ...(projectId ? { projectId } : {}) } : null,
  );
  const read: OdooStatementRead | undefined = readQuery.data;
  const complete = read?.state === 'complete' ? read : null;

  if (catalogueQuery.isError) {
    return <ListState variant="error" title={tc('financialStatements.error', "Couldn't load financial statements")} sub={tc('financialStatements.errorDescription', 'The request failed. Check your connection and try again.')}
      onRetry={() => void catalogueQuery.refetch()} retryLabel={tc('financialStatements.retry', 'Retry')} />;
  }
  if (catalogueQuery.isPending || !catalogue) return <ListState variant="loading" shape="table" rows={5} />;
  // A project page stays quiet when there is nothing to show yet; the company page and the budget say why.
  if (projectId && catalogue.state !== 'complete') return null;
  if (catalogue.state === 'not_in_use') {
    return <ListState variant="empty" title={t('odooLedger.statement.notInUse', 'Odoo ledger not in use yet')}
      sub={t('odooLedger.statement.notInUseSub', 'Statements from Odoo appear here after an Admin moves this organisation to the Odoo ledger.')} />;
  }
  if (catalogue.state === 'unavailable') {
    return <ListState variant="empty" title={t('odooLedger.statement.unavailable', 'No Odoo ledger lines yet')} sub={t('odooLedger.statement.unavailableSub', 'Statements appear when PMO has read posted lines from Odoo.')} />;
  }

  const statementName = {
    trial_balance: tc('financialStatements.trialBalance', 'Trial balance'),
    profit_and_loss: tc('financialStatements.profitAndLoss', 'Profit and loss'),
    balance_sheet: tc('financialStatements.balanceSheet', 'Balance sheet'),
  } as const;
  const asOf = complete?.provenance.ledgerAsOf ?? catalogueAsOf;
  const sectionState: FinancialStatementsSectionState = readQuery.isError ? { kind: 'error' }
    : complete && asOf ? { kind: 'complete', asOf, hasActivity: complete.hasActivity, delayed: false, background: 'idle' }
    : read?.state === 'unavailable' ? { kind: 'unavailable' }
    : { kind: 'loading' };
  const prov = complete?.provenance;
  const sum = complete?.current.summary[0];
  const doesNotBalance = statement === 'balance_sheet' && sum?.balanced === false;
  const totalsRows = complete?.viewKind === 'project_totals' ? (['income', 'expense', 'net'] as const).map((k) => ({
    key: k, label: { income: tc('financialStatements.income', 'Income'), expense: tc('financialStatements.expense', 'Expense'), net: tc('financialStatements.net', 'Net') }[k],
    current: formatLedgerAmount(String(complete.current.summary[0]?.[k] ?? '')), prior: formatLedgerAmount(String(complete.prior.summary[0]?.[k] ?? '')),
  })) : [];
  const totalsColumns: Column<(typeof totalsRows)[number]>[] = [
    { key: 'label', header: tc('financialStatements.amounts', 'Amounts'), kind: 'primary', cell: (r) => r.label },
    { key: 'current', header: tc('financialStatements.currentColumn', 'Current'), kind: 'money', align: 'num', cell: (r) => r.current },
    { key: 'prior', header: tc('financialStatements.priorColumn', 'Previous'), kind: 'money', align: 'num', cell: (r) => r.prior },
  ];

  return (
    <div className="min-w-0" data-testid="odoo-statements">
      <FormGrid className="mb-4 min-w-0">
        <StatementPeriodPicker
          kind={periodKind}
          periodStart={pair?.currentStart ?? null}
          periods={choices.map((p) => ({ kind: p.kind, periodStart: p.currentStart, label: `${formatDayYear(p.currentStart)} – ${formatDayYear(p.currentEnd)}` }))}
          labels={{
            kind: tc('financialStatements.periodKind', 'Period type'), period: tc('financialStatements.period', 'Period'), month: tc('financialStatements.month', 'Month'),
            quarter: tc('financialStatements.quarter', 'Quarter'), fiscalYear: tc('financialStatements.fiscalYear', 'Fiscal year'),
            choosePeriod: tc('financialStatements.choosePeriod', 'Choose a period'), noPeriods: tc('financialStatements.noPeriods', 'No periods available'),
          }}
          onKindChange={(k) => setFilters({ periodKind: k, periodStart: latestPair(periods, k, today)?.currentStart ?? '' })}
          onPeriodChange={(start) => setFilter('periodStart', start ?? '')}
        />
        {!projectId && (
          <SelectField
            label={tc('financialStatements.statement', 'Statement')}
            value={statement}
            options={STATEMENTS.map((s) => ({ value: s, label: statementName[s] }))}
            onChange={(v) => { const next = STATEMENTS.find((s) => s === v); if (next) setStatement(next); }}
          />
        )}
      </FormGrid>
      {prov && (
        <div className="mb-3 space-y-2">
          <LedgerProvenance
            state={statementLedgerState(prov)}
            asOf={prov.ledgerAsOf}
            check={complete?.viewKind === 'account_breakdown' ? lastCheck(prov) : undefined}
            unattributed={prov.unattributed}
            unlinked={prov.unlinked}
          />
          {prov.caughtUp === false && (
            <p role="status" className="rounded-md border border-warning/30 bg-warning/[0.07] px-3 py-2 text-sm text-foreground">
              {t('odooLedger.statement.partial', 'Partial: PMO is still reading the Odoo history, so these figures may be incomplete.')}
            </p>
          )}
          {prov.unclassified && prov.unclassified.count > 0 && (
            <p className="text-sm text-muted-foreground">{t('odooLedger.statement.unclassified', '{{count}} accounts in the ledger are not in the Odoo account list yet, so they are not placed in a section.', { count: prov.unclassified.count })}</p>
          )}
        </div>
      )}
      {doesNotBalance && (
        <p role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3 py-2 text-sm text-foreground">
          {t('odooLedger.statement.doesNotBalance', 'This balance sheet does not balance: assets and liabilities plus equity differ by {{amount}}.', { amount: formatLedgerAmount(String(sum?.difference ?? '')) })}
        </p>
      )}
      <FinancialStatementsSection
        title={projectId ? tc('financialStatements.projectProfitAndLoss', 'Project profit and loss') : statementName[statement]}
        context={complete ? `${formatDayYear(complete.period.currentStart)} – ${formatDayYear(complete.period.currentEnd)}` : ''}
        state={sectionState}
        labels={{
          unavailable: tc('financialStatements.unavailable', 'Statements are not available yet'),
          unavailableDescription: t('odooLedger.statement.unavailableSub', 'Statements appear when PMO has read posted lines from Odoo.'),
          noActivity: tc('financialStatements.noActivity', 'No activity in this period'),
          noActivityDescription: tc('financialStatements.noActivityDescription', 'There was no activity in the selected period.'),
          error: tc('financialStatements.error', "Couldn't load financial statements"),
          errorDescription: tc('financialStatements.errorDescription', 'The request failed. Check your connection and try again.'),
          retry: tc('financialStatements.retry', 'Retry'),
          updated: tc('financialStatements.updated', 'Updated'),
          delayed: tc('financialStatements.delayed', 'Update delayed'),
          refreshing: tc('financialStatements.refreshing', 'Refreshing statements…'),
        }}
        onRetry={() => void readQuery.refetch()}
      >
        {complete && <p className="mb-2 text-sm text-muted-foreground">{t('odooLedger.amountsIn', 'Amounts in {{currency}}', { currency })}</p>}
        {complete && complete.viewKind === 'project_totals' && (
          <DataTable embedded rows={totalsRows} columns={totalsColumns} rowKey={(r) => r.key} tableId="odoo-project-totals"
            accessibleName={tc('financialStatements.projectProfitAndLoss', 'Project profit and loss')} cardBelow={420} />
        )}
        {complete && complete.viewKind === 'account_breakdown' && (
          <div className="space-y-3">
            <ViewToggle
              ariaLabel={t('odooLedger.statement.periodSide', 'Period shown')}
              value={side}
              onChange={setSide}
              options={[
                { value: 'current', label: tc('financialStatements.current', 'Current period') },
                { value: 'prior', label: tc('financialStatements.prior', 'Previous period') },
              ]}
            />
            <p className="text-sm text-muted-foreground">
              {side === 'current'
                ? `${formatDayYear(complete.period.currentStart)} – ${formatDayYear(complete.period.currentEnd)}`
                : `${formatDayYear(complete.period.priorStart)} – ${formatDayYear(complete.period.priorEnd)}`}
            </p>
            <OdooStatementTable statement={statement} side={side === 'current' ? complete.current : complete.prior} name={statementName[statement]} />
          </div>
        )}
      </FinancialStatementsSection>
    </div>
  );
}
