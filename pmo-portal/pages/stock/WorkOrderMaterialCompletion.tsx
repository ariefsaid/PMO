import { WithheldPrice } from '@/src/components/ui/WithheldPrice';
import { useMaySeePrices } from '@/src/hooks/useHidePrices';
import React from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui';
import { useOrgName } from '@/src/hooks/useOrgName';
import { useWorkOrder } from '@/src/hooks/useWorkOrderRecord';
import { useWorkOrderMaterialCompletion } from '@/src/hooks/useStockSiteWork';
import { PrintDocument, PrintActionBar, PrintHeader, PrintTable, PrintSignatureBlocks, type PrintTableColumn } from '@/src/components/print';
import type { MaterialCompletionRow } from '@/src/lib/repositories/stockSiteWork';
import { formatQuantity, formatStockValue } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

/**
 * Material completion of one work order (1124d): per material what was issued, returned, moved in and out, the counted difference and the balance,
 * with totals. Read-only, one database read over the stock ledger; print it to PDF and attach it to the close-out item as its document. Cost figures
 * show only when the database sent them (roles without cost access never receive them).
 */
const WorkOrderMaterialCompletion: React.FC = () => {
  const { t } = useTranslation('stock');
  const maySeePrices = useMaySeePrices();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const orgName = useOrgName();
  const wo = useWorkOrder(id);
  const q = useWorkOrderMaterialCompletion(id);
  const loc = getNumberLocale();
  const back = () => navigate(id ? `/work-orders/${id}` : '/projects');
  if (wo.isPending || q.isPending) return <ListState variant="loading" rows={4} />;
  if (wo.isError || q.isError) return <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => { void wo.refetch(); void q.refetch(); }} />;
  const row = wo.data;
  if (!row) return <ListState variant="empty" icon="folder" title={t('materialCompletion.notFound')} />;
  const data = q.data;
  const valueTotals = maySeePrices ? data.valueTotals : null;
  const showValue = valueTotals !== null;
  const currency = row.currency;
  const num = (v: string) => <span className="whitespace-nowrap tabular-nums">{formatQuantity(v, loc)}</span>;
  const money = (v: string | undefined) => (v === undefined ? '' : <span className="whitespace-nowrap tabular-nums">{formatStockValue(v, currency, loc)}</span>);
  const title = t('materialCompletion.title');
  const columns: PrintTableColumn<MaterialCompletionRow>[] = [
    { key: 'item', header: t('materialCompletion.item'), render: (r) => <span><span className="font-mono font-medium">{r.itemCode}</span> {r.itemName}</span> },
    { key: 'unit', header: t('materialCompletion.unit'), width: '60px', render: (r) => <span className="text-muted-foreground">{r.unitCode}</span> },
    { key: 'issued', header: t('materialCompletion.issued'), align: 'right', render: (r) => num(r.issued) },
    { key: 'returned', header: t('materialCompletion.returned'), align: 'right', render: (r) => num(r.returned) },
    { key: 'movedIn', header: t('materialCompletion.movedIn'), align: 'right', render: (r) => num(r.movedIn) },
    { key: 'movedOut', header: t('materialCompletion.movedOut'), align: 'right', render: (r) => num(r.movedOut) },
    { key: 'counted', header: t('materialCompletion.counted'), align: 'right', render: (r) => num(r.countedDifference) },
    { key: 'balance', header: t('materialCompletion.balance'), align: 'right', render: (r) => <span className="font-semibold">{num(r.balance)}</span> },
    ...(showValue ? [
      { key: 'issuedValue', header: t('materialCompletion.issuedValue'), align: 'right' as const, render: (r: MaterialCompletionRow) => money(r.issuedValue) },
      { key: 'balanceValue', header: t('materialCompletion.balanceValue'), align: 'right' as const, render: (r: MaterialCompletionRow) => money(r.balanceValue) },
    ] : []),
  ];
  return (
    <div className="min-h-screen bg-surface-canvas print:bg-transparent" data-testid="material-completion-page">
      <PrintActionBar title={`${title} ${row.wo_number ?? ''}`.trim()} onBack={back} printLabel={t('materialCompletion.print')} backLabel={t('materialCompletion.back')} />
      <main className="p-4 sm:p-6 print:p-0">
        <PrintDocument>
          <PrintHeader orgName={orgName} documentTitle={title} documentNumber={row.wo_number ?? ''} metaItems={[
            { label: t('materialCompletion.workOrder'), value: row.title ?? '' },
          ]} />
          {data.rows.length === 0
            ? <p className="py-6 text-sm text-muted-foreground">{t('materialCompletion.empty')}</p>
            : <PrintTable<MaterialCompletionRow> columns={columns} data={data.rows} keyExtractor={(r) => r.itemId} />}
          {data.totals.length > 0 && (
            <section aria-label={t('materialCompletion.totals')} className="mt-4">
              <h2 className="text-sm font-semibold">{t('materialCompletion.totals')}</h2>
              <table className="mt-1 w-full text-sm">
                <thead><tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">{t('materialCompletion.unit')}</th>
                  {(['issued', 'returned', 'movedIn', 'movedOut', 'counted', 'balance'] as const).map((k) => <th key={k} className="py-1 px-2 text-right font-medium">{t(`materialCompletion.${k}`)}</th>)}
                </tr></thead>
                <tbody>{data.totals.map((x) => (
                  <tr key={x.unitCode} className="border-t border-border">
                    <td className="py-1 pr-2">{x.unitCode}</td>
                    <td className="px-2 text-right">{num(x.issued)}</td><td className="px-2 text-right">{num(x.returned)}</td>
                    <td className="px-2 text-right">{num(x.movedIn)}</td><td className="px-2 text-right">{num(x.movedOut)}</td>
                    <td className="px-2 text-right">{num(x.countedDifference)}</td><td className="px-2 text-right font-semibold">{num(x.balance)}</td>
                  </tr>))}</tbody>
              </table>
              {!maySeePrices && <WithheldPrice />}
              {valueTotals && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-sm" data-testid="material-completion-value-totals">
                  <dt className="text-muted-foreground">{t('materialCompletion.issuedValue')}</dt><dd className="text-right">{money(valueTotals.issued)}</dd>
                  <dt className="text-muted-foreground">{t('materialCompletion.balanceValue')}</dt><dd className="text-right">{money(valueTotals.balance)}</dd>
                </dl>)}
            </section>)}
          <PrintSignatureBlocks blocks={[t('materialCompletion.preparedBy'), t('materialCompletion.checkedBy')]} nameLabel={t('transfers.print.name')} dateLabel={t('transfers.print.signatureDate')} />
        </PrintDocument>
      </main>
    </div>
  );
};
export default WorkOrderMaterialCompletion;
