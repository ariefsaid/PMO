import React from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState } from '@/src/components/ui';
import { useDeliveryNoteSettings } from '@/src/hooks/useMaterialRequests';
import { useStockItems, useStockUnits, useStockWarehouses } from '@/src/hooks/useStock';
import { useStockTransfer } from '@/src/hooks/useStockTransfers';
import { useOrgName } from '@/src/hooks/useOrgName';
import { formatDay } from '@/src/lib/format';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { PrintDocument, PrintActionBar, PrintHeader, PrintTable, PrintSignatureBlocks, type PrintTableColumn } from '@/src/components/print';
import type { StockTransferLine } from '@/src/lib/repositories/stockTransfers';

/** Printable delivery note of a two-step transfer (#1122 item 7): what was sent, from where to where, with the signature blocks the organisation set for delivery notes. */
const StockTransferPrint: React.FC = () => {
  const { t } = useTranslation('stock');
  const { transferId } = useParams<{ transferId: string }>();
  const navigate = useNavigate();
  const orgName = useOrgName();
  const q = useStockTransfer(transferId);
  const settings = useDeliveryNoteSettings();
  const items = useStockItems(true);
  const units = useStockUnits(true);
  const warehouses = useStockWarehouses(true);
  if (q.isPending || settings.isPending) return <ListState variant="loading" rows={4} />;
  if (q.isError) return <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void q.refetch()} />;
  const transfer = q.data;
  if (!transfer) return <ListState variant="empty" icon="folder" title={t('transfers.notFound')} />;
  const back = () => navigate(`/stock/transfers/${transfer.id}`);
  if (!settings.data?.enabled) {
    return (
      <div className="mx-auto my-12 max-w-lg space-y-4 p-6 text-center" data-testid="delivery-note-disabled-state">
        <p role="alert" className="text-sm text-muted-foreground">{t('transfers.print.off')}</p>
        <Button variant="outline" onClick={back}>{t('transfers.print.back')}</Button>
      </div>
    );
  }
  const wh = (id: string) => { const w = (warehouses.data ?? []).find((x) => x.id === id); return w ? `${w.code} · ${w.name}` : '—'; };
  const item = (l: StockTransferLine) => (items.data ?? []).find((i) => i.id === l.itemId);
  const title = t('transfers.print.title');
  const blocks = settings.data.signatureBlocks?.length ? settings.data.signatureBlocks : ['Dispatched by', 'Delivered by', 'Received by'];
  const columns: PrintTableColumn<StockTransferLine>[] = [
    { key: 'no', header: '#', width: '40px', render: (_, i) => <span className="text-muted-foreground">{i + 1}</span> },
    { key: 'code', header: t('transfers.print.code'), width: '120px', render: (l) => <span className="font-mono font-medium">{item(l)?.code ?? '—'}</span> },
    { key: 'name', header: t('transfers.print.description'), render: (l) => <span>{item(l)?.name ?? '—'}</span> },
    { key: 'qty', header: t('transfers.print.quantity'), align: 'right', width: '100px', render: (l) => <span className="font-semibold tabular-nums">{formatQuantity(String(l.qtySent), getNumberLocale())}</span> },
    { key: 'unit', header: t('transfers.print.unit'), width: '80px', render: (l) => <span className="text-muted-foreground">{(units.data ?? []).find((u) => u.id === item(l)?.unit_id)?.code ?? '—'}</span> },
  ];
  return (
    <div className="min-h-screen bg-surface-canvas print:bg-transparent" data-testid="delivery-note-page">
      <PrintActionBar title={`${title} ${transfer.number}`} onBack={back} printLabel={t('transfers.print.print')} backLabel={t('transfers.print.back')} />
      <main className="p-4 sm:p-6 print:p-0">
        <PrintDocument>
          <PrintHeader orgName={orgName} documentTitle={title} documentNumber={transfer.number} metaItems={[
            { label: t('transfers.print.date'), value: formatDay(transfer.sentAt) },
            { label: t('transfers.print.from'), value: wh(transfer.fromWarehouseId) },
            { label: t('transfers.print.to'), value: wh(transfer.toWarehouseId) },
            ...(transfer.note ? [{ label: t('form.note'), value: transfer.note }] : []),
          ]} />
          <PrintTable<StockTransferLine> columns={columns} data={transfer.lines} keyExtractor={(l) => l.id} />
          <PrintSignatureBlocks blocks={blocks} nameLabel={t('transfers.print.name')} dateLabel={t('transfers.print.signatureDate')} />
        </PrintDocument>
      </main>
    </div>
  );
};
export default StockTransferPrint;
