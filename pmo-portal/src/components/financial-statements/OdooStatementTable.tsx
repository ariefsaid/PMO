/** One side (current or previous period) of an Odoo statement: account lines as `code name`, grouped by section, with totals underneath (FR-ODA-020/021/024). */
import { useTranslation } from 'react-i18next';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { formatLedgerAmount } from '@/src/components/odoo-ledger/ledgerFormat';
import type { OdooStatementKind, OdooStatementRow, OdooStatementSide } from '@/src/lib/db/odooLedger';

interface Line { key: string; section: string; label: string; derived: boolean; cells: OdooStatementRow }

const GROUPS: Record<OdooStatementKind, readonly string[] | undefined> = {
  trial_balance: undefined,
  profit_and_loss: ['income', 'expense'],
  balance_sheet: ['asset', 'liability', 'equity'],
};

export function OdooStatementTable({ statement, side, name }: { statement: OdooStatementKind; side: OdooStatementSide; name: string }) {
  const { t } = useTranslation('finance');
  const label = (row: OdooStatementRow): { text: string; derived: boolean } => {
    const kind = row.row_kind;
    if (kind === 'current_year_earnings') return { text: t('odooLedger.statement.currentYearEarnings', 'Current-year earnings'), derived: true };
    if (kind === 'previous_years_earnings') return { text: t('odooLedger.statement.previousYearsEarnings', 'Earnings of previous years'), derived: true };
    const code = typeof row.account === 'string' ? row.account : '';
    const title = typeof row.account_name === 'string' ? row.account_name : '';
    return { text: [code, title].filter((x) => x !== '').join(' ') || '—', derived: false };
  };
  const lines: Line[] = side.rows.map((row, i) => {
    const l = label(row);
    return { key: `${i}:${String(row.account ?? row.row_kind ?? '')}`, section: typeof row.section === 'string' ? row.section : 'all', label: l.text, derived: l.derived, cells: row };
  });
  const money = (key: string, header: string): Column<Line> => ({
    key, header, kind: 'money', align: 'num',
    cell: (r) => formatLedgerAmount(typeof r.cells[key] === 'string' ? (r.cells[key] as string) : null),
  });
  const account: Column<Line> = {
    key: 'account', header: t('odooLedger.statement.account', 'Account'), kind: 'primary', stickyLeft: true,
    cell: (r) => (r.derived ? <span>{r.label} <span className="text-muted-foreground">{t('odooLedger.statement.derived', '(calculated)')}</span></span> : r.label),
  };
  const sum = side.summary[0] ?? {};
  const val = (key: string) => formatLedgerAmount(typeof sum[key] === 'string' ? (sum[key] as string) : null);
  let columns: Column<Line>[];
  let totals: Array<{ key: string; label: string; values: Record<string, string> }>;
  if (statement === 'trial_balance') {
    columns = [account,
      money('opening_debit', t('odooLedger.statement.openingDebit', 'Opening debit')), money('opening_credit', t('odooLedger.statement.openingCredit', 'Opening credit')),
      money('debit', t('odooLedger.statement.debit', 'Debit')), money('credit', t('odooLedger.statement.credit', 'Credit')),
      money('closing_debit', t('odooLedger.statement.closingDebit', 'Closing debit')), money('closing_credit', t('odooLedger.statement.closingCredit', 'Closing credit'))];
    totals = [{ key: 'total', label: t('odooLedger.statement.total', 'Total'), values: {
      opening_debit: val('opening_debit'), opening_credit: val('opening_credit'), debit: val('total_debit'), credit: val('total_credit'), closing_debit: val('closing_debit'), closing_credit: val('closing_credit'),
    } }];
  } else if (statement === 'profit_and_loss') {
    columns = [account, money('amount', t('odooLedger.statement.amount', 'Amount'))];
    totals = [
      { key: 'income', label: t('odooLedger.statement.totalIncome', 'Total income'), values: { amount: val('income') } },
      { key: 'expense', label: t('odooLedger.statement.totalExpense', 'Total expense'), values: { amount: val('expense') } },
      { key: 'net', label: t('odooLedger.statement.net', 'Net result'), values: { amount: val('net') } },
    ];
  } else {
    columns = [account, money('balance', t('odooLedger.statement.balance', 'Balance'))];
    totals = [
      { key: 'assets', label: t('odooLedger.statement.totalAssets', 'Total assets'), values: { balance: val('total_assets') } },
      { key: 'le', label: t('odooLedger.statement.totalLiabilitiesEquity', 'Total liabilities and equity'), values: { balance: val('total_liabilities_equity') } },
    ];
  }
  const sectionLabel = (key: string) => ({
    income: t('odooLedger.statement.income', 'Income'), expense: t('odooLedger.statement.expense', 'Expenses'),
    asset: t('odooLedger.statement.assets', 'Assets'), liability: t('odooLedger.statement.liabilities', 'Liabilities'), equity: t('odooLedger.statement.equity', 'Equity'),
  } as Record<string, string>)[key] ?? key;
  const groups = GROUPS[statement];
  return (
    <DataTable
      embedded
      rows={lines}
      columns={columns}
      rowKey={(r) => r.key}
      tableId={`odoo-statement-${statement}`}
      accessibleName={name}
      cardBelow={560}
      totals={totals}
      {...(groups ? { groupBy: (r: Line) => r.section, groupOrder: groups, groupLabel: sectionLabel } : {})}
      emptyTitle={t('odooLedger.statement.empty', 'No accounts with activity')}
    />
  );
}
