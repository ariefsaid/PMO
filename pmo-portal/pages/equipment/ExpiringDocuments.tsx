import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListPage, ListState, StatusPill, cn, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useExpiringDocuments, useSubjectDocuments } from '@/src/hooks/useDocumentExpiry';
import { formatDay } from '@/src/lib/format';
import { ExpiryDocumentForm } from './ExpiryDocumentsCard';
import type { ExpiringDocumentRow } from '@/src/lib/db/documentExpiry';
import RecordRenewalAction from './RecordRenewalAction';

/** Loads the whole record of the expiring document, then opens the renew form on it. */
const RenewDocument: React.FC<{ row: ExpiringDocumentRow; onClose: () => void }> = ({ row, onClose }) => {
  const { t } = useTranslation();
  const docs = useSubjectDocuments(row.subject_kind, row.subject_id);
  const doc = (docs.data ?? []).find((d) => d.id === row.id);
  if (docs.isError) return <ListState variant="error" title={t("common:ui.errorBoundary.title", "Something went wrong")} onRetry={() => void docs.refetch()} />;
  if (docs.isPending) return <ListState variant="loading" />;
  if (!doc) return <ListState variant="empty" title={t("equipment:expiry.recordNotFound", "Record not found")} />;
  return <ExpiryDocumentForm kind={row.subject_kind} subjectId={row.subject_id} doc={doc} renew onClose={onClose} />;
};

/** Expiring documents (#2527): everything for people and equipment that expires in the next 30 days, plus what already has.
 *  RLS decides the rows (medical status is Admin-only and carries a status, never results). Someone who may edit renews on the
 *  full form; a person's direct manager (who may not edit) records a renewal date from the row, and the database decides who may. */
const ExpiringDocumentsPage: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const mayRenew = (d: ExpiringDocumentRow) => may('edit', 'expiryDocument', { record: { kind: d.subject_kind, viewOnly: realRole !== effectiveRole } });
  const [renewing, setRenewing] = useState<ExpiringDocumentRow | null>(null);
  const { data, isPending, isError, refetch } = useExpiringDocuments();
  const rows = data ?? [];

  const recordPath = (d: ExpiringDocumentRow) => d.subject_kind === 'person' ? `/equipment/people/${d.subject_id}` : `/equipment/assets/${d.subject_id}`;
  // The single most urgent row of the screen carries the exception colour; the rest state their age in plain text.
  const mostUrgent = rows.reduce<ExpiringDocumentRow | null>((worst, d) => (worst === null || d.days_left < worst.days_left ? d : worst), null);
  const columns: Column<ExpiringDocumentRow>[] = [
    { key: 'subject', header: t('equipment:expiry.subject', 'Person / equipment'), kind: 'primary', rowHeader: true,
      cell: (d) => <Link className="font-semibold text-primary-text underline-offset-2 hover:underline" to={recordPath(d)}
        aria-label={t('equipment:expiry.openRecord', 'Open the record of {{name}}', { name: d.subject_name })}>{d.subject_name}</Link>,
      secondaryCell: (d) => d.subject_kind === 'person' ? t('equipment:expiry.kindPerson', 'Person') : t('equipment:expiry.kindEquipment', 'Equipment') },
    { key: 'type', header: t('equipment:expiry.type', 'Document'),
      cell: (d) => <span className="flex flex-col">
        <span>{d.type_name}</span>
        {d.is_medical && d.medical_status
          ? <span className="text-muted-foreground">{d.medical_status === 'fit' ? t('equipment:expiry.medical.fit', 'Fit') : t('equipment:expiry.medical.unfit', 'Unfit')}</span>
          : d.number ? <span className="record-id text-muted-foreground">{d.number}</span> : null}
      </span> },
    { key: 'expires', header: t('equipment:expiry.expires', 'Expires'), cell: (d) => <span className="whitespace-nowrap">{formatDay(d.expires_on)}</span> },
    { key: 'left', header: t('equipment:expiry.left', 'Days left'), align: 'num',
      cell: (d) => <span className={cn('whitespace-nowrap tabular-nums', d.id === mostUrgent?.id && 'text-destructive-text')}>
        {d.days_left < 0 ? t('equipment:expiry.expired', 'Expired {{count}} days ago', { count: -d.days_left }) : d.days_left}</span> },
    { key: 'where', header: t('equipment:expiry.location', 'Kept at'), cell: (d) => (d.location_note ? <span>{d.location_note}</span> : null) },
    { key: 'actions', kind: 'actions', header: <span className="sr-only">{t('equipment:expiryEdit.actions', 'Actions')}</span>,
      cell: (d) => mayRenew(d)
        ? <Button variant="outline" size="sm" aria-label={t('equipment:expiry.renewLabel', 'Renew {{type}} of {{name}}', { type: d.type_name, name: d.subject_name })} onClick={() => setRenewing(d)}>{t('equipment:expiryEdit.renew', 'Renew')}</Button>
        : d.subject_kind === 'person' && !d.is_medical
          ? <RecordRenewalAction doc={{ id: d.id, subject_name: d.subject_name, type_name: d.type_name, expires_on: d.expires_on }} />
          : null },
  ];
  const expiredCount = rows.filter((d) => d.days_left < 0).length;
  const groupName = (key: string) => key === 'expired'
    ? <span className="inline-flex items-center gap-2">{t('equipment:expiry.groupExpired', 'Expired')}<StatusPill variant="overdue">{expiredCount}</StatusPill></span>
    : <span className="inline-flex items-center gap-2">{t('equipment:expiry.groupDue', 'Due in 30 days')}<span className="font-normal text-muted-foreground">{rows.length - expiredCount}</span></span>;

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
        : <DataTable<ExpiringDocumentRow> rows={[...rows].sort((x, y) => x.days_left - y.days_left)} columns={columns} rowKey={(d) => d.id} tableId="expiring-documents-table"
            accessibleName={t('equipment:expiry.title', 'Expiring documents')}
            groupBy={(d) => (d.days_left < 0 ? 'expired' : 'due')} groupLabel={groupName} />
      )}
      {renewing && <RenewDocument row={renewing} onClose={() => setRenewing(null)} />}
    </ListPage>
  );
};
export default ExpiringDocumentsPage;
