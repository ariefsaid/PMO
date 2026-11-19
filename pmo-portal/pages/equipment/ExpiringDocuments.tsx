import React from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, ListPage, ListState, type Column } from '@/src/components/ui';
import { useExpiringDocuments } from '@/src/hooks/useDocumentExpiry';
import type { ExpiringDocumentRow } from '@/src/lib/db/documentExpiry';

/** Expiring documents (#2527): everything for people and equipment that expires in the next 30 days, plus what already has.
 *  Read-only; RLS decides the rows (medical status is Admin-only and carries a status, never results). */
const ExpiringDocumentsPage: React.FC = () => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useExpiringDocuments();
  const rows = data ?? [];

  const columns: Column<ExpiringDocumentRow>[] = [
    { key: 'subject', header: t('equipment:expiry.subject', 'Person / equipment'), kind: 'primary', rowHeader: true,
      cell: (d) => <span className="font-semibold text-foreground">{d.subject_name}</span> },
    { key: 'type', header: t('equipment:expiry.type', 'Document'), cell: (d) => <span>{d.type_name}</span> },
    { key: 'detail', header: t('equipment:expiry.detail', 'Number / status'),
      cell: (d) => d.is_medical && d.medical_status
        ? <span>{t(`equipment:expiry.medical.${d.medical_status}`, d.medical_status === 'fit' ? 'Fit' : 'Unfit')}</span>
        : d.number ? <span className="record-id">{d.number}</span> : null },
    { key: 'expires', header: t('equipment:expiry.expires', 'Expires'), cell: (d) => <span>{d.expires_on}</span> },
    { key: 'left', header: t('equipment:expiry.left', 'Days left'),
      cell: (d) => d.days_left < 0
        ? <span className="text-destructive-text">{t('equipment:expiry.expired', 'Expired {{count}} days ago', { count: -d.days_left })}</span>
        : <span>{d.days_left}</span> },
    { key: 'where', header: t('equipment:expiry.location', 'Kept at'), cell: (d) => (d.location_note ? <span>{d.location_note}</span> : null) },
  ];

  return (
    <ListPage title={t('equipment:expiry.title', 'Expiring documents')} count={isPending || isError ? undefined : rows.length}>
      {isPending && <ListState variant="loading" shape="table" rows={4} />}
      {!isPending && isError && (
        <ListState variant="error" title={t('equipment:expiry.error', "Couldn't load expiring documents")}
          sub={t('equipment:expiry.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => void refetch()} retryLabel={t('equipment:usage.retry', 'Retry')} />
      )}
      {!isPending && !isError && (rows.length === 0
        ? <ListState variant="empty" title={t('equipment:expiry.empty', 'Nothing expires in the next 30 days')}
            sub={t('equipment:expiry.emptySub', 'Documents for people and equipment show here as they come due.')} />
        : <DataTable<ExpiringDocumentRow> rows={rows} columns={columns} rowKey={(d) => d.id} tableId="expiring-documents-table" />
      )}
    </ListPage>
  );
};
export default ExpiringDocumentsPage;
