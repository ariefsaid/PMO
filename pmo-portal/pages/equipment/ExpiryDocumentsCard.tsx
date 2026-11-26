import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, ConfirmDialog, DataTable, EntityFormModal, FormGrid, ListState, RecordSection, SelectField, StatusPill, TextField, useToast,
  type Column, type SubmitError,
} from '@/src/components/ui';
import { DateField } from '@/src/components/ui/DateField';
import { FileInput } from '@/src/components/ui/FormFields';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useDocumentTypes, useExpiryDocumentMutations, useSubjectDocuments } from '@/src/hooks/useDocumentExpiry';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { EXPIRY_ATTACHMENT_ACCEPT, type ExpiryDocumentRow, type SubjectKind } from '@/src/lib/db/documentExpiry';
import type { Tables } from '@/src/lib/supabase/database.types';

type ExpiryDocumentTableRow = Tables<'expiry_documents'>;
/**
 * Form state, not a row: a controlled input holds '' for "empty", never null, and it is converted at submit. Derived from
 * the table so a renamed column still fails typecheck.
 */
type FormValues = {
  [K in 'type_id' | 'number' | 'issued_on' | 'expires_on' | 'location_note' | 'medical_status']: NonNullable<ExpiryDocumentTableRow[K]>;
};

/** Whole days from `today` to `day` (both ISO days); negative once it has passed. */
const daysUntil = (day: string, today: string): number => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/** The expiry mark: red once expired, amber inside the 30-day warning window, nothing while it is far off. */
export const ExpiryMark: React.FC<{ daysLeft: number }> = ({ daysLeft }) => {
  const { t } = useTranslation();
  if (daysLeft < 0) return <StatusPill variant="overdue">{t('equipment:expiry.expiredPill', 'Expired')}</StatusPill>;
  if (daysLeft <= 30) return <StatusPill variant="warn">{t('equipment:expiry.dueSoon', 'Due soon')}</StatusPill>;
  return null;
};

const empty = (d?: ExpiryDocumentRow): FormValues => ({
  type_id: d?.type_id ?? '', number: d?.number ?? '', issued_on: d?.issued_on ?? '', expires_on: d?.expires_on ?? '',
  location_note: d?.location_note ?? '', medical_status: d?.medical_status ?? '',
});

/** Add or edit one expiring document (#2542). Type and subject are fixed once saved; a medical type holds a status and dates only. */
export const ExpiryDocumentForm: React.FC<{ kind: SubjectKind; subjectId: string; doc?: ExpiryDocumentRow; renew?: boolean; onClose: () => void }> = ({ kind, subjectId, doc, renew = false, onClose }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const types = useDocumentTypes(kind);
  const { create, update } = useExpiryDocumentMutations(kind, subjectId);
  const [file, setFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const form = useEntityForm<FormValues>({
    initialValues: renew && doc ? { ...empty(doc), issued_on: '', expires_on: '' } : empty(doc), idPrefix: 'expiry-doc', requiredFields: ['type_id', 'expires_on'], module: 'expiry_documents',
    validate: (v) => {
      const e: Partial<Record<keyof FormValues, string>> = {};
      if (renew && doc && v.expires_on && v.expires_on <= doc.expires_on) e.expires_on = t('equipment:expiryEdit.errRenew', 'The new expiry date must be after the current one ({{date}})', { date: formatDay(doc.expires_on) });
      if (!v.type_id) e.type_id = t('equipment:expiryEdit.errType', 'Choose a document type');
      const isMedical = doc ? doc.is_medical : Boolean((types.data ?? []).find((x) => x.id === v.type_id)?.is_medical);
      if (isMedical && !v.medical_status) e.medical_status = t('equipment:expiryEdit.errStatus', 'Choose the medical status: fit or unfit');
      if (!v.expires_on) e.expires_on = t('equipment:expiryEdit.errExpiry', 'Enter the expiry date');
      else if (v.issued_on && v.issued_on > v.expires_on) e.expires_on = t('equipment:expiryEdit.errOrder', 'Expiry date must be on or after the issue date');
      return e;
    },
  });
  const chosen = (types.data ?? []).find((x) => x.id === form.values.type_id);
  const medical = doc ? doc.is_medical : Boolean(chosen?.is_medical);
  // a medical type is offered only to a role that may write medical status/date records
  const mayMedical = usePermission()('create', 'expiryDocument', { record: { kind, medical: true } });
  const typeOptions = (types.data ?? []).filter((x) => mayMedical || !x.is_medical).map((x) => ({ value: x.id, label: x.name }));
  const typeLabel = doc ? (types.data ?? []).find((x) => x.id === doc.type_id)?.name : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      const fields = {
        number: medical ? null : v.number.trim() || null,
        issued_on: v.issued_on || null,
        expires_on: v.expires_on,
        location_note: medical ? null : v.location_note.trim() || null,
        medical_status: medical ? (v.medical_status as 'fit' | 'unfit') : null,
      };
      try {
        if (doc) await update.mutateAsync({ id: doc.id, fields, file: medical ? null : file, previousPath: doc.attachment_path });
        else await create.mutateAsync({ type_id: v.type_id, ...fields, file: medical ? null : file });
        toast(renew ? t('equipment:expiryEdit.renewed', 'Document renewed') : t('equipment:expiryEdit.saved', 'Document saved'), undefined, 'success');
        onClose();
      } catch (err) { const c = classifyMutationError(err); setSubmitError({ headline: c.headline, detail: c.detail }); }
    });
  };

  return (
    <EntityFormModal open title={renew ? t('equipment:expiryEdit.renewTitle', 'Renew document') : doc ? t('equipment:expiryEdit.editTitle', 'Edit document') : t('equipment:expiryEdit.addTitle', 'Add document')}
      submitLabel={renew ? t('equipment:expiryEdit.renew', 'Renew') : t('equipment:expiryEdit.save', 'Save document')} onSubmit={submit} onClose={onClose}
      loading={form.isSubmitting} dirty={form.isDirty || file !== null} submitError={submitError}
      errorSummary={form.hasAttemptedSubmit ? Object.entries(form.errors).map(([k, m]) => ({ fieldId: form.fieldProps(k as keyof FormValues).id, message: String(m) })) : undefined}>
      <FormGrid>
        {doc
          ? <TextField label={t('equipment:expiryEdit.type', 'Document type')} value={typeLabel ?? ''} onChange={() => undefined} readOnly />
          : <SelectField label={t('equipment:expiryEdit.type', 'Document type')} required placeholder={t('equipment:expiryEdit.typePlaceholder', 'Choose a type')}
              options={typeOptions} {...form.fieldProps('type_id')} />}
        {medical
          ? <SelectField label={t('equipment:expiryEdit.status', 'Medical status')} required placeholder={t('equipment:expiryEdit.statusPlaceholder', 'Choose fit or unfit')}
              options={[{ value: 'fit', label: t('equipment:expiry.medical.fit', 'Fit') }, { value: 'unfit', label: t('equipment:expiry.medical.unfit', 'Unfit') }]}
              {...form.fieldProps('medical_status')} />
          : <TextField label={t('equipment:expiryEdit.number', 'Number')} spellCheck={false} {...form.fieldProps('number')} />}
        <DateField label={t('equipment:expiryEdit.issued', 'Issue date')} {...form.fieldProps('issued_on')} />
        <DateField label={t('equipment:expiryEdit.expires', 'Expiry date')} required {...form.fieldProps('expires_on')} />
        {!medical && <>
          <TextField label={t('equipment:expiryEdit.location', 'Kept at')} {...form.fieldProps('location_note')} />
          <div className="col-span-full">
            <label htmlFor="expiry-doc-file" className="mb-1 block text-sm font-medium">{t('equipment:expiryEdit.attachment', 'Attachment')}</label>
            <FileInput id="expiry-doc-file" accept={EXPIRY_ATTACHMENT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="mt-1 text-sm text-muted-foreground">
              {doc?.attachment_path && !file
                ? t('equipment:expiryEdit.attachmentKeep', 'A file is attached. Choose another to replace it.')
                : t('equipment:expiryEdit.attachmentHelp', 'PDF or image, up to 5 MB.')}
            </p>
          </div>
        </>}
      </FormGrid>
    </EntityFormModal>
  );
};

/** The documents card on a person or equipment record (#2542). Writes are gated by `can()` (UX only; RLS decides). */
export const ExpiryDocumentsCard: React.FC<{ kind: SubjectKind; subjectId: string }> = ({ kind, subjectId }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { realRole, effectiveRole } = useEffectiveRole();
  const may = usePermission();
  const today = useOrgToday();
  const ctx = useMemo(() => ({ record: { kind, viewOnly: realRole !== effectiveRole } }), [kind, realRole, effectiveRole]);
  const q = useSubjectDocuments(kind, subjectId);
  const types = useDocumentTypes(kind);
  const { archive } = useExpiryDocumentMutations(kind, subjectId);
  const [editing, setEditing] = useState<ExpiryDocumentRow | 'new' | null>(null);
  const [archiving, setArchiving] = useState<ExpiryDocumentRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const typeName = (id: string) => (types.data ?? []).find((x) => x.id === id)?.name ?? '—';
  const rows = q.data ?? [];
  // per document: medical document writes follow the shared permission rule
  const rowCtx = (d: ExpiryDocumentRow) => ({ record: { ...ctx.record, medical: d.is_medical } });
  const canEdit = (d: ExpiryDocumentRow) => may('edit', 'expiryDocument', rowCtx(d));
  const canArchive = (d: ExpiryDocumentRow) => may('archive', 'expiryDocument', rowCtx(d));

  const open = async (path: string) => {
    try { window.open(await repositories.documentExpiry.attachmentUrl(path), '_blank', 'noopener'); }
    catch (err) { const c = classifyMutationError(err); toast(c.headline, c.detail, 'error'); }
  };
  const doArchive = async () => {
    if (!archiving) return;
    setProblem(null);
    try { await archive.mutateAsync(archiving.id); toast(t('equipment:expiryEdit.archived', 'Document archived'), undefined, 'success'); setArchiving(null); }
    catch (err) { const c = classifyMutationError(err); setProblem(joinSentences(c.headline, c.detail)); }
  };

  const label = (d: ExpiryDocumentRow) => d.number ?? typeName(d.type_id);
  const columns: Column<ExpiryDocumentRow>[] = [
    { key: 'type', header: t('equipment:expiry.type', 'Document'), kind: 'primary', rowHeader: true, cell: (d) => typeName(d.type_id) },
    { key: 'detail', header: t('equipment:expiry.detail', 'Number / status'),
      cell: (d) => d.is_medical
        ? (d.medical_status === 'unfit' ? t('equipment:expiry.medical.unfit', 'Unfit') : t('equipment:expiry.medical.fit', 'Fit'))
        : d.number ? <span className="record-id">{d.number}</span> : null },
    { key: 'issued', header: t('equipment:expiryEdit.issued', 'Issue date'), cell: (d) => (d.issued_on ? formatDay(d.issued_on) : null) },
    { key: 'expires', header: t('equipment:expiry.expires', 'Expires'), cell: (d) => <span className="whitespace-nowrap">{formatDay(d.expires_on)}</span> },
    { key: 'mark', header: <span className="sr-only">{t('equipment:expiry.state', 'Expiry state')}</span>, cell: (d) => (today ? <ExpiryMark daysLeft={daysUntil(d.expires_on, today)} /> : null) },
    { key: 'file', header: t('equipment:expiryEdit.attachment', 'Attachment'),
      cell: (d) => d.attachment_path
        ? <Button variant="ghost" size="sm" onClick={() => void open(d.attachment_path as string)}>{t('equipment:expiryEdit.openFile', 'Open file')}</Button> : null },
    { key: 'actions', header: <span className="sr-only">{t('equipment:expiryEdit.actions', 'Actions')}</span>,
      cell: (d) => (canEdit(d) || canArchive(d)) ? (
        <span className="flex gap-1">
          {canEdit(d) && <Button variant="ghost" size="sm" aria-label={t('equipment:expiryEdit.editLabel', 'Edit {{name}}', { name: label(d) })} onClick={() => setEditing(d)}>{t('equipment:expiryEdit.edit', 'Edit')}</Button>}
          {canArchive(d) && <Button variant="ghost" size="sm" aria-label={t('equipment:expiryEdit.archiveLabel', 'Archive {{name}}', { name: label(d) })} onClick={() => setArchiving(d)}>{t('equipment:expiryEdit.archive', 'Archive')}</Button>}
        </span>) : null },
  ];

  return (
    <RecordSection title={t('equipment:expiryEdit.title', 'Documents')} flush={!q.isPending && !q.isError && rows.length > 0}
      actions={<CanWrite entity="expiryDocument" action="create" ctx={ctx}>
        <Button variant="outline" size="sm" onClick={() => setEditing('new')}>{t('equipment:expiryEdit.add', 'Add document')}</Button>
      </CanWrite>}>
        {q.isPending && <ListState variant="loading" rows={2} />}
        {!q.isPending && q.isError && <ListState variant="error" title={t('equipment:expiryEdit.error', "Couldn't load documents")}
          sub={t('equipment:expiry.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void q.refetch()} retryLabel={t('equipment:usage.retry', 'Retry')} />}
        {!q.isPending && !q.isError && (rows.length === 0
          ? <ListState variant="empty" title={t('equipment:expiryEdit.empty', 'No documents on this record')}
              sub={t('equipment:expiryEdit.emptySub', 'Certificates and permits show here with their expiry dates.')} />
          : <DataTable<ExpiryDocumentRow> embedded rows={rows} columns={columns} rowKey={(d) => d.id} tableId={`expiry-documents-${kind}`}
              accessibleName={t('equipment:expiryEdit.title', 'Documents')} />)}
      {editing && <ExpiryDocumentForm kind={kind} subjectId={subjectId} doc={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={archiving !== null} tone="destructive" title={t('equipment:expiryEdit.archiveTitle', 'Archive document')}
        description={t('equipment:expiryEdit.archiveBody', 'It leaves this record and the expiry list, and no more warnings are sent for it.')}
        confirmLabel={t('equipment:expiryEdit.archive', 'Archive')} loading={archive.isPending} error={problem}
        onConfirm={() => void doArchive()} onCancel={() => { setArchiving(null); setProblem(null); }} />
    </RecordSection>
  );
};
