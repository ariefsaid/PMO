import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, SelectField } from '@/src/components/ui';
import { usePurchaseOrderSettings } from '@/src/hooks/usePurchaseOrderSettings';
import { useProcurementDetail } from '@/src/hooks/useProcurementDetail';
import { useWorkOrder } from '@/src/hooks/useWorkOrderRecord';
import { useOrgName } from '@/src/hooks/useOrgName';
import { formatDay, formatCurrency } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { recordStatusLabel } from '@/src/lib/procurement/recordStatusLabel';
import {
  PrintDocument,
  PrintActionBar,
  PrintHeader,
  PrintTable,
  PrintSignatureBlocks,
  type PrintHeaderMetaItem,
  type PrintTableColumn,
} from '@/src/components/print';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';

/**
 * Printable purchase order view with the authorised-to-collect line (#2688).
 * Reuses the shared print components added by the delivery note (#2687): same header, table,
 * signature boxes and print-only stylesheet — only the document body and collector line differ.
 */
const PurchaseOrderPrintPage: React.FC = () => {
  const { t } = useTranslation(['procurement', 'procurementRecord']);
  const { procurementId, orderId } = useParams<{ procurementId?: string; orderId?: string }>();
  const navigate = useNavigate();

  const [selectedCollector, setSelectedCollector] = useState('');

  const orgName = useOrgName();
  const settingsQuery = usePurchaseOrderSettings();
  const procurementQuery = useProcurementDetail(procurementId);

  const procurement = procurementQuery.data;
  const po = procurement?.purchase_orders?.find((order) => order.id === orderId);

  const woQuery = useWorkOrder(po?.work_order_id ?? undefined);
  // A line's own work order and discipline (wo-per-purchase-line) print under the item, so the paper says what each line is for.
  const projectOrders = useProjectWorkOrders(procurement?.project_id ?? '');
  const lineDisciplines = useCostDisciplines();
  const wo = woQuery.data;

  const backToRecord = () =>
    procurementId ? navigate(`/procurement/${procurementId}`) : navigate(-1);

  if (procurementQuery.isPending || settingsQuery.isPending) {
    return <ListState variant="loading" rows={4} />;
  }

  if (procurementQuery.isError) {
    return (
      <ListState
        variant="error"
        title={t('purchaseOrderPrint.error', "Couldn't load this purchase order")}
        onRetry={() => void procurementQuery.refetch()}
      />
    );
  }

  // Printing is strictly restricted to organisations that turned it on (FR-POP-002 / FR-POP-003).
  if (!settingsQuery.data?.enabled) {
    return (
      <div
        className="mx-auto my-12 max-w-lg p-6 text-center space-y-4"
        data-testid="po-disabled-state"
      >
        <p role="alert" className="text-sm text-muted-foreground">
          {t(
            'purchaseOrderPrint.notAvailable',
            'Purchase order printing is not enabled for your organisation.',
          )}
        </p>
        <Button variant="outline" onClick={backToRecord}>
          {t('purchaseOrderPrint.back', 'Back')}
        </Button>
      </div>
    );
  }

  if (!procurement || !po) {
    return <ListState variant="empty" title={t('purchaseOrderPrint.notFound', 'Purchase order not found')} />;
  }

  const documentTitle = t('purchaseOrderPrint.title', 'Purchase order');
  const docNumber = po.po_number || po.reference_number || procurement.code || '—';
  const currency = po.currency || procurement.currency || 'IDR';

  const signatureBlocks = settingsQuery.data.signatureBlocks?.length
    ? settingsQuery.data.signatureBlocks
    : [t('purchaseOrderPrint.preparedBy', 'Prepared by'), t('purchaseOrderPrint.approvedBy', 'Approved by'), t('purchaseOrderPrint.vendorAcceptance', 'Vendor acceptance')];
  const collectorsList = settingsQuery.data.authorisedCollectors ?? [];

  const metaItems: PrintHeaderMetaItem[] = [
    {
      label: t('purchaseOrderPrint.date', 'Order date'),
      value: formatDay(po.date || po.created_at),
    },
    {
      label: t('purchaseOrderPrint.procurementRef', 'Procurement reference'),
      value: procurement.code,
    },
    {
      label: t('purchaseOrderPrint.vendor', 'Supplier / Vendor'),
      value: procurement.vendor?.name ?? '—',
    },
    {
      label: t('purchaseOrderPrint.project', 'Project'),
      value: procurement.project
        ? procurement.project.code
          ? `${procurement.project.code} · ${projectDisplayName(procurement.project)}`
          : projectDisplayName(procurement.project)
        : '—',
    },
    {
      label: t('purchaseOrderPrint.workOrder', 'Work order'),
      value: wo ? (wo.wo_number ? `${wo.wo_number} · ${wo.title}` : wo.title) : '—',
    },
    ...(po.reference_number && po.reference_number !== docNumber
      ? [
          {
            label: t('purchaseOrderPrint.reference', 'Reference number'),
            value: po.reference_number,
          },
        ]
      : []),
    {
      label: t('purchaseOrderPrint.status', 'Status'),
      value: recordStatusLabel(t, po.status),
    },
    {
      label: t('purchaseOrderPrint.currency', 'Currency'),
      value: currency,
    },
  ];

  const columns: PrintTableColumn<ProcurementItemRow>[] = [
    {
      key: 'lineNo',
      header: '#',
      width: '40px',
      render: (_, index) => <span className="text-muted-foreground">{index + 1}</span>,
    },
    {
      key: 'name',
      header: t('purchaseOrderPrint.itemName', 'Item description'),
      render: (item) => (
        <div>
          <div className="font-medium text-foreground">{item.name}</div>
          {item.description ? (
            <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>
          ) : null}
          {(() => {
            const order = item.work_order_id ? projectOrders.data?.find((w) => w.id === item.work_order_id) : undefined;
            const discipline = item.discipline_id ? lineDisciplines.data?.find((d) => d.id === item.discipline_id) : undefined;
            const parts = [
              order ? `${t('purchaseOrderPrint.workOrder', 'Work order')} ${order.wo_number ?? order.title}` : null,
              discipline ? `${t('purchaseOrderPrint.discipline', 'Discipline')} ${discipline.name}` : null,
            ].filter(Boolean);
            return parts.length > 0 ? <div className="text-xs text-muted-foreground mt-0.5" data-testid="po-line-attribution">{parts.join(' · ')}</div> : null;
          })()}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: t('purchaseOrderPrint.quantity', 'Quantity'),
      align: 'right',
      width: '100px',
      render: (item) => <span className="font-semibold tabular-nums">{item.quantity}</span>,
    },
    {
      key: 'rate',
      header: t('purchaseOrderPrint.rate', 'Unit price'),
      align: 'right',
      width: '140px',
      render: (item) => (
        <span className="tabular-nums font-mono text-xs">
          {formatCurrency(Number(item.rate), currency)}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('purchaseOrderPrint.amount', 'Amount'),
      align: 'right',
      width: '160px',
      render: (item) => (
        <span className="tabular-nums font-mono text-xs font-semibold">
          {formatCurrency(Number(item.amount), currency)}
        </span>
      ),
    },
  ];

  const items = procurement.items ?? [];
  const calculatedTotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalAmount = po.amount != null ? Number(po.amount) : calculatedTotal;

  return (
    <div
      className="min-h-screen bg-surface-canvas print:bg-transparent"
      data-testid="purchase-order-page"
    >
      <PrintActionBar
        title={`${documentTitle} ${docNumber}`}
        onBack={backToRecord}
        printLabel={t('purchaseOrderPrint.print', 'Print')}
        backLabel={t('purchaseOrderPrint.back', 'Back')}
      />

      {/* Screen-only: choose one collector for this printed copy, or print every named collector. */}
      {collectorsList.length > 0 ? (
        <div className="print:hidden mx-auto flex max-w-4xl items-end justify-end px-4 pt-4 sm:px-6">
          <SelectField
            id="po-collector-picker"
            data-testid="collector-picker-select"
            label={t('purchaseOrderPrint.selectCollector', 'Authorised collector')}
            value={selectedCollector}
            onChange={setSelectedCollector}
            options={[
              { value: '', label: t('purchaseOrderPrint.allCollectors', 'All named collectors') },
              ...collectorsList.map((collector) => ({ value: collector, label: collector })),
            ]}
          />
        </div>
      ) : null}

      <main className="p-4 sm:p-6 print:p-0">
        <PrintDocument>
          <PrintHeader
            orgName={orgName}
            documentTitle={documentTitle}
            documentNumber={docNumber}
            numberLabel={t('purchaseOrderPrint.number', 'Number')}
            metaItems={metaItems}
          />

          {/* Authorised to collect — the line the supplier reads before releasing goods (FR-POP-005). */}
          <section
            className="mb-6 break-inside-avoid rounded border border-border bg-muted/10 p-3 print:border-foreground/30 print:bg-transparent print:break-inside-avoid"
            data-testid="authorised-to-collect-section"
            aria-label={t('purchaseOrderPrint.authorisedToCollect', 'Authorised to collect')}
          >
            <div className="text-xs font-semibold text-muted-foreground">
              {t('purchaseOrderPrint.authorisedToCollect', 'Authorised to collect')}
            </div>
            <div
              className="mt-1 flex min-h-[22px] items-center text-sm font-medium text-foreground"
              data-testid="authorised-collectors-list"
            >
              {selectedCollector ? (
                <span>{selectedCollector}</span>
              ) : collectorsList.length > 0 ? (
                <span>{collectorsList.join(', ')}</span>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">
                  {t(
                    'purchaseOrderPrint.openCollectorLine',
                    '________________________________________',
                  )}
                </span>
              )}
            </div>
          </section>

          <PrintTable<ProcurementItemRow>
            columns={columns}
            data={items}
            keyExtractor={(item) => item.id}
          />

          <div className="flex justify-end border-b border-foreground pb-6 pt-2 text-sm break-inside-avoid print:break-inside-avoid">
            <div className="w-full space-y-2 sm:w-72">
              <div className="flex items-center justify-between text-sm font-bold text-foreground">
                <span>{t('purchaseOrderPrint.total', 'Order total')}:</span>
                <span className="font-mono text-base tabular-nums">
                  {formatCurrency(totalAmount, currency)}
                </span>
              </div>
            </div>
          </div>

          <PrintSignatureBlocks
            blocks={signatureBlocks}
            nameLabel={t('purchaseOrderPrint.name', 'Name')}
            dateLabel={t('purchaseOrderPrint.signatureDate', 'Date')}
            signLabel={t('purchaseOrderPrint.signature', 'Signature')}
          />
        </PrintDocument>
      </main>
    </div>
  );
};

export default PurchaseOrderPrintPage;
