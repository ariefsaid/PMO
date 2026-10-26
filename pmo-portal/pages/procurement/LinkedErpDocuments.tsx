import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, DataTable, ListState, StatusPill, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatDate, formatNumber } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useLinkedErpDocuments, useUnlinkErpDocument } from '@/src/hooks/useErpPurchaseLinks';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { erpDoctypeLabel } from './erpLinkReasons';

/**
 * FR-PFE-032 — the ERPNext documents linked to this purchase: number, type, date, amount, ERP status, marked "From
 * ERPNext". Read-only except Unlink (FR-PFE-031, Admin/Finance; the RPC is the authority). Renders nothing until a
 * document is linked, so a purchase without ERP documents keeps today's screen; the read is RLS-scoped, so an Engineer
 * (who reads no ERP purchase documents, 0350) sees nothing here.
 */
export const LinkedErpDocuments: React.FC<{ procurementId: string }> = ({ procurementId }) => {
  const { t } = useTranslation('finance');
  const headingId = useId();
  const query = useLinkedErpDocuments(procurementId);
  const unlink = useUnlinkErpDocument();
  const canUnlink = usePermission()('delete', 'erpPurchaseLink');
  const [confirming, setConfirming] = useState<ErpPurchaseRow | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  const rows = query.data ?? [];
  if (!query.isError && rows.length === 0) return null;

  const close = () => { setConfirming(null); setUnlinkError(null); };
  const confirmUnlink = async () => {
    if (!confirming?.linkId) return;
    setUnlinkError(null);
    try {
      await unlink.mutateAsync(confirming.linkId);
      close();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setUnlinkError(detail ? `${headline} ${detail}` : headline);
    }
  };

  const columns: Column<ErpPurchaseRow>[] = [
    {
      key: 'document', header: t('erpPurchases.column.document', 'Document'), kind: 'primary', fullIdentity: true,
      primaryTitle: (d) => d.name,
      cell: (d) => <span className="font-mono">{d.name}</span>,
      secondaryCell: (d) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {erpDoctypeLabel(t, d.doctype)}
          <StatusPill variant="neutral">{t('erpLinks.fromErp', 'From ERPNext')}</StatusPill>
        </span>
      ),
    },
    { key: 'date', header: t('erpPurchases.column.date', 'Date'), kind: 'date', cell: (d) => formatDate(d.docDate) },
    {
      key: 'amount', header: t('erpPurchases.column.amount', 'Amount'), kind: 'money', align: 'num',
      cell: (d) => (d.grandTotal === null || !d.currency ? '—' : formatNumber(d.grandTotal)),
    },
    { key: 'status', header: t('erpPurchases.column.erpStatus', 'ERPNext status'), cell: (d) => d.erpStatus ?? '—' },
    ...(canUnlink ? [{
      key: 'actions', header: <span className="sr-only">{t('erpLinks.actions', 'Actions')}</span>, kind: 'actions' as const, size: 120,
      cell: (d: ErpPurchaseRow) => d.linkId ? (
        <Button size="sm" variant="outline" aria-label={t('erpLinks.unlinkOne', 'Unlink {{name}}', { name: d.name })}
          onClick={() => { setUnlinkError(null); setConfirming(d); }}>
          {t('erpLinks.unlink', 'Unlink')}
        </Button>
      ) : null,
    }] : []),
  ];

  return (
    <section aria-labelledby={headingId} className="mt-6 border-t border-border pt-4">
      <h2 id={headingId} className="mb-4 px-1 text-xl font-bold leading-tight text-foreground">
        {t('erpLinks.linkedTitle', 'Documents from ERPNext')}
      </h2>
      {query.isError ? (
        <ListState variant="error" title={t('erpLinks.linkedError', "Couldn't load the documents from ERPNext")} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable<ErpPurchaseRow>
          rows={rows}
          columns={columns}
          rowKey={(d) => d.id}
          tableId="procurement-linked-erp-documents"
          accessibleName={t('erpLinks.linkedTitle', 'Documents from ERPNext')}
          groupBy={(row) => row.currency || t('procurement:shared.notAvailable', 'Not available')}
          groupHeadingClassName="text-xl font-bold leading-tight"
        />
      )}
      <ConfirmDialog
        open={confirming !== null}
        tone="destructive"
        title={t('erpLinks.unlinkTitle', 'Unlink {{name}}?', { name: confirming?.name ?? '' })}
        description={(
          <span className="block space-y-2">
            <span className="block">
              {t('erpLinks.unlinkBody', '{{name}} goes back to the ERPNext documents not in a purchase. The purchase keeps its status, and files on this document move to the purchase. Nothing changes in ERPNext.', { name: confirming?.name ?? '' })}
            </span>
            {unlinkError && <span role="alert" className="block text-destructive-text">{unlinkError}</span>}
          </span>
        )}
        confirmLabel={t('erpLinks.unlink', 'Unlink')}
        cancelLabel={t('erpLinks.cancel', 'Cancel')}
        loading={unlink.isPending}
        onConfirm={() => void confirmUnlink()}
        onCancel={close}
      />
    </section>
  );
};
