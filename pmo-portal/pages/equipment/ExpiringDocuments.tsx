import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListPage, ListState, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useSubjectDocuments } from '@/src/hooks/useDocumentExpiry';
import { formatDay } from '@/src/lib/format';
import { ExpiryDocumentForm } from './ExpiryDocumentsCard';
import { useExpiringDocuments } from '@/src/hooks/useDocumentExpiry';
import type { ExpiringDocumentRow } from '@/src/lib/db/documentExpiry';

/** Expiring documents (#2527): everything for people and equipment that expires in the next 30 days, plus what already has.
 *  Read-only; RLS decides the rows (medical status is Admin-only and carries a status, never results). */
/** Loads the whole record of the expiring document, then opens the renew form on it. */
const RenewDocument: React.FC<{ row: ExpiringDocumentRow; onClose: () => void }> = ({ row, onClose }) => {
  const docs = useSubjectDocuments(row.subject_kind, row.subject_id);
  const doc = (docs.data ?? []).find((d) => d.id === row.id);
  if (!doc) return null;
  return <ExpiryDocumentForm kind={row.subject_kind} subjectId={row.subject_id} doc={doc} renew onClose={onClose} />;
};

const ExpiringDocumentsPage: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const [renewing, setRenewing] = useState<ExpiringDocumentRow | null>(null);
  const { data, isPending, isError, refetch } = useExpiringDocuments();
  const rows = data ?? [];

  const columns: Column<ExpiringDocumentRow>[] = [
    { key: 'subject', header: t('equipment:expiry.subject', 'Person / equipment'), kind: 'primary', rowHeader: true,
      cell: (d) => <Link className="font-semibold text-foreground underline-offset-2 hover:underline" to={d.subject_kind === 'person' ? `/equipment/people/${d.subject_id}` : `/equipment/assets/${d.subject_id}`}>{d.subject_name}</Link> },
    { key: 'type', header: t('equipment:expiry.type', 'Document'), cell: (d) => <span>{d.type_name}</span> },
    { key: 'detail', header: t('equipment:expiry.detail', 'Number / status'),
      cell: (d) => d.is_medical && d.medical_status
        ? <span>{d.medical_status === 'fit' ? t('equipment:expiry.medical.fit', 'Fit') : t('equipment:expiry.medical.unfit', 'Unfit')}</span>
        : d.number ? <span className="record-id">{d.number}</span> : null },
    { key: 'expires', header: t('equipment:expiry.expires', 'Expires'), cell: (d) => <span className="whitespace-nowrap">{formatDay(d.expires_on)}</span> },
    { key: 'left', header: t('equipment:expiry.left', 'Days left'),
      cell: (d) => d.days_left < 0
        ? <span className="text-destructive-text">{t('equipment:expiry.expired', 'Expired {{count}} days ago', { count: -d.days_left })}</span>
        : <span>{d.days_left}</span> },
    { key: 'where', header: t('equipment:expiry.location', 'Kept at'), cell: (d) => (d.location_note ? <span>{d.location_note}</span> : null) },
    { key: 'actions', header: <span className="sr-only">{t('equipment:expiryEdit.actions', 'Actions')}</span>,
      cell: (d) => (
        <span className="flex flex-wrap gap-1">
          <Link className="touch-target inline-flex items-center text-primary-text underline" to={d.subject_kind === 'person' ? `/equipment/people/${d.subject_id}` : `/equipment/assets/${d.subject_id}`}
            aria-label={t('equipment:expiry.openRecord', 'Open the record of {{name}}', { name: d.subject_name })}>{t('equipment:expiry.open', 'Open')}</Link>
          {may('edit', 'expiryDocument', { record: { kind: d.subject_kind, viewOnly: realRole !== effectiveRole } }) &&
            <Button variant="outline" size="sm" aria-label={t('equipment:expiry.renewLabel', 'Renew {{type}} of {{name}}', { type: d.type_name, name: d.subject_name })} onClick={() => setRenewing(d)}>{t('equipment:expiryEdit.renew', 'Renew')}</Button>}
        </span>) },
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
      {renewing && <RenewDocument row={renewing} onClose={() => setRenewing(null)} />}
    </ListPage>
  );
};
export default ExpiringDocumentsPage;
