/** Odoo ledger actuals on the project budget (#1507 S7, FR-ODA-050/051/052): where the figures come from, what is left out, and the lines behind a category. */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, ListState } from '@/src/components/ui';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { LedgerProvenance } from '@/src/components/odoo-ledger/LedgerProvenance';
import { formatLedgerAmount, netDebit } from '@/src/components/odoo-ledger/ledgerFormat';
import { useOdooLedgerCurrency, useOdooLedgerHealth, useOdooLedgerLines, useOdooProjectActuals } from '@/src/hooks/useOdooLedger';
import { usePermission } from '@/src/auth/usePermission';
import { useOdooCan } from '@/src/components/integrations/odoo/useOdooCan';
import { formatDateOnly } from '@/src/lib/format';
import type { OdooLedgerLine } from '@/src/lib/db/odooLedger';

const SETUP_HREF = '/administration/integrations';

/** The strip above the category table. Renders nothing unless the org is on the Odoo ledger. */
export function BudgetOdooActuals({ projectId }: { projectId: string }) {
  const { t } = useTranslation('finance');
  const { t: tc } = useTranslation();
  const may = usePermission();
  const can = useOdooCan();
  const currency = useOdooLedgerCurrency();
  const { onLedger, linked, unlinked } = useOdooProjectActuals(projectId);
  const health = useOdooLedgerHealth(projectId, onLedger && linked === true);
  if (!onLedger) return null;
  const canSetUp = can.manage || can.setValue;
  const detail = may('view', 'odooLedgerHealth');
  return (
    <section aria-labelledby="budget-odoo-actuals-title" className="space-y-2 border-b border-border pb-3" data-testid="budget-odoo-actuals">
      <h2 id="budget-odoo-actuals-title" className="text-sm font-semibold text-foreground">{t('odooLedger.budget.title', 'Actuals from Odoo')}</h2>
      {unlinked && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('odooLedger.budget.unlinked', 'Actual cost cannot be shown yet: no Odoo cost account is linked to this project.')}{' '}
          {canSetUp
            ? <Link className="font-medium text-primary-text underline underline-offset-2" to={SETUP_HREF}>{t('odooLedger.budget.linkAccount', 'Link a cost account')}</Link>
            : t('odooLedger.budget.askAdmin', 'An administrator can link one.')}
        </p>
      )}
      {linked === true && health.isPending && <ListState variant="loading" rows={2} />}
      {linked === true && health.isError && (
        <ListState variant="error" title={t('odooLedger.budget.loadFailed', 'The Odoo ledger status could not be read')} onRetry={() => void health.refetch()} retryLabel={tc('common.retry', 'Retry')} />
      )}
      {linked === true && health.data && (
        <LedgerProvenance
          state={health.data.state}
          asOf={health.data.asOf}
          check={detail ? health.data.check : undefined}
          unmapped={health.data.unmapped}
          unattributed={health.data.unattributed}
          unlinked={health.data.unlinked}
          currency={currency}
        />
      )}
    </section>
  );
}

/** The lines behind one category (the drawer's "Records behind the spending"). `fallback` shows when the org is not on the Odoo ledger. */
export function BudgetOdooCategoryLines({ projectId, category, fallback }: { projectId: string; category: string; fallback: ReactNode }) {
  const { t } = useTranslation('finance');
  const may = usePermission();
  const { onLedger, linked } = useOdooProjectActuals(projectId);
  if (!onLedger) return <>{fallback}</>;
  if (!may('view', 'odooLedgerLines')) return <p className="text-sm text-muted-foreground">{t('odooLedger.lines.totalsOnly', 'Your role sees the project totals. Lines are visible to Finance, Executive and Admin.')}</p>;
  if (linked === false) return <p className="text-sm text-muted-foreground">{t('odooLedger.lines.unlinked', 'No Odoo cost account is linked to this project, so there are no lines to show.')}</p>;
  if (linked === undefined) return <ListState variant="loading" rows={3} />;
  return <CategoryLinesTable projectId={projectId} category={category} />;
}

function CategoryLinesTable({ projectId, category }: { projectId: string; category: string }) {
  const { t } = useTranslation('finance');
  const { t: tc } = useTranslation();
  const currency = useOdooLedgerCurrency();
  const lines = useOdooLedgerLines(projectId, category);
  const [loadingAll, setLoadingAll] = useState(false);
  if (lines.isPending) return <ListState variant="loading" rows={3} />;
  if (lines.isError) return <ListState variant="error" title={t('odooLedger.lines.loadFailed', 'The lines could not be read')} onRetry={() => void lines.refetch()} retryLabel={tc('common.retry', 'Retry')} />;
  const rows = lines.data.pages.flatMap((p) => p.lines);
  const more = lines.hasNextPage;
  const columns: Column<OdooLedgerLine>[] = [
    { key: 'date', header: t('odooLedger.lines.date', 'Date'), kind: 'date', cell: (r) => formatDateOnly(r.date) },
    { key: 'move', header: t('odooLedger.lines.document', 'Document'), kind: 'primary', cell: (r) => r.moveName },
    { key: 'account', header: t('odooLedger.lines.account', 'Account'), kind: 'text', cell: (r) => r.account },
    { key: 'partner', header: t('odooLedger.lines.partner', 'Partner'), kind: 'text', cell: (r) => r.partner ?? '—' },
    { key: 'amount', header: t('odooLedger.lines.amount', 'Amount ({{currency}})', { currency }), kind: 'money', align: 'num', cell: (r) => formatLedgerAmount(netDebit(r.debit, r.credit)) },
  ];
  const showAll = async () => {
    setLoadingAll(true);
    try {
      let next = lines.hasNextPage;
      while (next) {
        const result = await lines.fetchNextPage();
        next = result.hasNextPage;
        if (result.isError) break;
      }
    } finally { setLoadingAll(false); }
  };
  return (
    <div className="space-y-2" data-testid="odoo-category-lines">
      <DataTable
        embedded
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        tableId="project-budget-odoo-lines"
        accessibleName={t('odooLedger.lines.table', 'Odoo lines behind this category')}
        cardBelow={420}
        state={rows.length === 0 ? 'empty' : undefined}
        emptyTitle={t('odooLedger.lines.empty', 'No lines in this category')}
        emptySub={t('odooLedger.lines.emptySub', 'Posted Odoo lines in this project’s cost account and a mapped account appear here.')}
      />
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <span>{more
            ? t('odooLedger.lines.showingSoFar', 'Showing {{shown}} so far', { shown: rows.length })
            : t('odooLedger.lines.showing', 'Showing {{shown}} of {{total}}', { shown: rows.length, total: rows.length })}</span>
          {more && <Button variant="outline" size="sm" loading={lines.isFetchingNextPage && !loadingAll} onClick={() => void lines.fetchNextPage()}>{t('odooLedger.lines.more', 'Show more')}</Button>}
          {more && <Button variant="ghost" size="sm" loading={loadingAll} onClick={() => void showAll()}>{t('odooLedger.lines.all', 'All')}</Button>}
        </div>
      )}
    </div>
  );
}
