import React from 'react';
import { useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState } from '@/src/components/ui';
import { useMaterialRequest, useDeliveryNoteSettings } from '@/src/hooks/useMaterialRequests';
import { useStockItems, useStockUnits, useStockWarehouses } from '@/src/hooks/useStock';
import { useWorkOrder } from '@/src/hooks/useWorkOrderRecord';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { useOrgName } from '@/src/hooks/useOrgName';
import { formatDay } from '@/src/lib/format';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import {
  PrintDocument,
  PrintActionBar,
  PrintHeader,
  PrintTable,
  PrintSignatureBlocks,
  type PrintHeaderMetaItem,
  type PrintTableColumn,
} from '@/src/components/print';
import type { MaterialRequestLine } from '@/src/lib/repositories/materialRequests';

/**
 * Printable delivery note view (#2687).
 * Renders an approved or fulfilled material request formatted for browser printing.
 * The document title automatically follows organisation terminology overrides.
 */
const DeliveryNotePrintPage: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();

  const orgName = useOrgName();
  const reqQuery = useMaterialRequest(requestId);
  const settingsQuery = useDeliveryNoteSettings();
  const { data: stockItems } = useStockItems(true);
  const { data: stockUnits } = useStockUnits(true);
  const { data: warehouses } = useStockWarehouses();
  const { data: projects } = useProjectPickerOptions();

  const req = reqQuery.data;
  const woQuery = useWorkOrder(req?.workOrderId);
  const wo = woQuery.data;
  const project = req?.projectId ? projects?.find((p) => p.id === req.projectId) : undefined;
  const destWarehouse = req?.toWarehouseId ? warehouses?.find((w) => w.id === req.toWarehouseId) : undefined;

  if (reqQuery.isPending || settingsQuery.isPending) {
    return <ListState variant="loading" rows={4} />;
  }

  if (reqQuery.isError) {
    return (
      <ListState
        variant="error"
        title={t('detail.error', "Couldn't load this request")}
        onRetry={() => void reqQuery.refetch()}
      />
    );
  }

  if (!req) {
    return <ListState variant="empty" title={t('detail.notFound', 'Request not found')} />;
  }

  const enabled = Boolean(settingsQuery.data?.enabled);
  const isApprovedOrFulfilled = req.status === 'approved' || req.status === 'fulfilled';

  // Delivery note printing is strictly restricted to enabled orgs and approved/fulfilled requests.
  if (!enabled || !isApprovedOrFulfilled) {
    return (
      <div className="mx-auto my-12 max-w-lg p-6 text-center space-y-4" data-testid="delivery-note-disabled-state">
        <p role="alert" className="text-sm text-muted-foreground">
          {t('deliveryNote.notAvailable', 'Delivery note is not enabled or this request is not approved yet.')}
        </p>
        <Button variant="outline" onClick={() => navigate(`/material-requests/${req.id}`)}>
          {t('deliveryNote.back', 'Back to request')}
        </Button>
      </div>
    );
  }

  const documentTitle = t('deliveryNote.title', 'Delivery note');
  const signatureBlocks = settingsQuery.data?.signatureBlocks?.length
    ? settingsQuery.data.signatureBlocks
    : [t('deliveryNote.dispatchedBy', 'Dispatched by'), t('deliveryNote.deliveredBy', 'Delivered by'), t('deliveryNote.receivedBy', 'Received by')];

  const metaItems: PrintHeaderMetaItem[] = [
    {
      label: t('deliveryNote.date', 'Date'),
      value: formatDay(req.createdAt),
    },
    {
      label: t('deliveryNote.neededBy', 'Needed by'),
      value: formatDay(req.neededBy),
    },
    {
      label: t('deliveryNote.workOrder', 'Work order'),
      value: wo ? (wo.wo_number ? `${wo.wo_number} · ${wo.title}` : wo.title) : '—',
    },
    {
      label: t('deliveryNote.project', 'Project'),
      value: project ? projectDisplayName(project) : '—',
    },
    ...(destWarehouse
      ? [
          {
            label: t('deliveryNote.deliveredTo', 'Deliver to'),
            value: `${destWarehouse.code} · ${destWarehouse.name}`,
          },
        ]
      : []),
    ...(req.note
      ? [
          {
            label: t('form.note', 'Note'),
            value: req.note,
          },
        ]
      : []),
  ];

  const columns: PrintTableColumn<MaterialRequestLine>[] = [
    {
      key: 'lineNo',
      header: '#',
      width: '40px',
      render: (_, index) => <span className="text-muted-foreground">{index + 1}</span>,
    },
    {
      key: 'itemCode',
      header: t('deliveryNote.itemCode', 'Item code'),
      width: '120px',
      render: (line) => {
        const item = stockItems?.find((i) => i.id === line.itemId);
        return <span className="font-mono font-medium">{item?.code ?? '—'}</span>;
      },
    },
    {
      key: 'itemName',
      header: t('deliveryNote.itemName', 'Description'),
      render: (line) => {
        const item = stockItems?.find((i) => i.id === line.itemId);
        return <span>{item?.name ?? '—'}</span>;
      },
    },
    {
      key: 'quantity',
      header: t('deliveryNote.quantity', 'Quantity'),
      align: 'right',
      width: '100px',
      render: (line) => <span className="font-semibold tabular-nums">{formatQuantity(String(line.quantity), getNumberLocale())}</span>,
    },
    {
      key: 'unit',
      header: t('deliveryNote.unit', 'Unit'),
      width: '80px',
      render: (line) => {
        const item = stockItems?.find((i) => i.id === line.itemId);
        const unit = item?.unit_id ? stockUnits?.find((u) => u.id === item.unit_id) : undefined;
        return <span className="text-muted-foreground">{unit?.code ?? '—'}</span>;
      },
    },
    {
      key: 'remarks',
      header: t('deliveryNote.remarks', 'Remarks'),
      width: '180px',
      render: (line) => (
        <span className="text-sm text-muted-foreground">
          {line.overPlanReason ?? '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-surface-canvas print:bg-transparent" data-testid="delivery-note-page">
      <PrintActionBar
        title={`${documentTitle} ${req.number}`}
        onBack={() => navigate(`/material-requests/${req.id}`)}
        printLabel={t('deliveryNote.print', 'Print')}
        backLabel={t('deliveryNote.back', 'Back to request')}
      />

      <main className="p-4 sm:p-6 print:p-0">
        <PrintDocument>
          <PrintHeader
            orgName={orgName}
            documentTitle={documentTitle}
            documentNumber={req.number}
            numberLabel={t('deliveryNote.number', 'Number')}
            metaItems={metaItems}
          />

          <PrintTable<MaterialRequestLine>
            columns={columns}
            data={req.lines}
            keyExtractor={(line) => line.id}
          />

          <PrintSignatureBlocks
            blocks={signatureBlocks}
            nameLabel={t('deliveryNote.signedBy', 'Name')}
            dateLabel={t('deliveryNote.signatureDate', 'Date')}
          />
        </PrintDocument>
      </main>
    </div>
  );
};

export default DeliveryNotePrintPage;
