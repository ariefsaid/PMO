import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, DataTable, EntityFormModal, FormGrid, ListState, SelectField, TextField, useToast,
  type Column, type SubmitError,
} from '@/src/components/ui';
import { DateField } from '@/src/components/ui/DateField';
import { FileInput } from '@/src/components/ui/FormFields';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useDocumentTypes, useExpiryDocumentMutations, useSubjectDocuments } from '@/src/hooks/useDocumentExpiry';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import { EXPIRY_ATTACHMENT_ACCEPT, type ExpiryDocumentRow, type SubjectKind } from '@/src/lib/db/documentExpiry';

interface FormValues {
  type_id: string;
  number: string;
  issued_on: string;
  expires_on: string;
  location_note: string;
  medical_status: string;
}

const empty = (d?: ExpiryDocumentRow): FormValues => ({
  type_id: d?.type_id ?? '', number: d?.number ?? '', issued_on: d?.issued_on ?? '', expires_on: d?.expires_on ?? '',
  location_note: d?.location_note ?? '', medical_status: d?.medical_status ?? '',
});

/** Add or edit one expiring document (#2542). Type and subject are fixed once saved; a medical type holds a status and dates only. */
const ExpiryDocumentForm: React.FC<{ kind: SubjectKind; subjectId: string; doc?: ExpiryDocumentRow; onClose: () => void }> = ({ kind, subjectId, doc, onClose }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const types = useDocumentTypes(kind);
  const { create, update } = useExpiryDocumentMutations(kind, subjectId);
  const [file, setFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const form = useEntityForm<FormValues>({
    initialValues: empty(doc), idPrefix: 'expiry-doc', requiredFields: ['type_id', 'expires_on'], module: 'expiry_documents',
    validate: (v) => {
      const e: Partial<Record<keyof FormValues, string>> = {};
      if (!v.type_id) e.type_id = t('equipment:expiryEdit.errType', 'Choose a document type');
      if (!v.expires_on) e.expires_on = t('equipment:expiryEdit.errExpiry', 'Enter the expiry date');
      else if (v.issued_on && v.issued_on > v.expires_on) e.expires_on = t('equipment:expiryEdit.errOrder', 'Expiry date must be on or after the issue date');
      return e;
    },
  });
  const chosen = (types.data ?? []).find((x) => x.id === form.values.type_id);
  const medical = doc ? doc.is_medical : Boolean(chosen?.is_medical);
  const typeOptions = (types.data ?? []).map((x) => ({ value: x.id, label: x.name }));
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
        medical_status: medical ? ((v.medical_status || 'fit') as 'fit' | 'unfit') : null,
      };
      try {
        if (doc) await update.mutateAsync({ id: doc.id, fields, file: medical ? null : file, previousPath: doc.attachment_path });
        else await create.mutateAsync({ type_id: v.type_id, ...fields, file: medical ? null : file });
        toast(t('equipment:expiryEdit.saved', 'Document saved'), undefined, 'success');
        onClose();
      } catch (err) { const c = classifyMutationError(err); setSubmitError({ headline: c.headline, detail: c.detail }); }
    });
  };

  return (
    <EntityFormModal open title={doc ? t('equipment:expiryEdit.editTitle', 'Edit document') : t('equipment:expiryEdit.addTitle', 'Add document')}
      submitLabel={t('equipment:expiryEdit.save', 'Save document')} onSubmit={submit} onClose={onClose}
      loading={form.isSubmitting} dirty={form.isDirty || file !== null} submitError={submitError}
      errorSummary={form.hasAttemptedSubmit ? Object.entries(form.errors).map(([k, m]) => ({ fieldId: form.fieldProps(k as keyof FormValues).id, message: String(m) })) : undefined}>
      <FormGrid>
        {doc
          ? <TextField label={t('equipment:expiryEdit.type', 'Document type')} value={typeLabel ?? ''} onChange={() => undefined} readOnly />
          : <SelectField label={t('equipment:expiryEdit.type', 'Document type')} required placeholder={t('equipment:expiryEdit.typePlaceholder', 'Choose a type')}
              options={typeOptions} {...form.fieldProps('type_id')} />}
        {medical
          ? <SelectField label={t('equipment:expiryEdit.status', 'Medical status')} required
              options={[{ value: 'fit', label: t('equipment:expiry.medical.fit', 'Fit') }, { value: 'unfit', label: t('equipment:expiry.medical.unfit', 'Unfit') }]}
              {...form.fieldProps('medical_status')} value={form.values.medical_status || 'fit'} />
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
  const ctx = useMemo(() => ({ record: { kind, viewOnly: realRole !== effectiveRole } }), [kind, realRole, effectiveRole]);
  const q = useSubjectDocuments(kind, subjectId);
  const types = useDocumentTypes(kind);
  const { archive } = useExpiryDocumentMutations(kind, subjectId);
  const [editing, setEditing] = useState<ExpiryDocumentRow | 'new' | null>(null);
  const [archiving, setArchiving] = useState<ExpiryDocumentRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const typeName = (id: string) => (types.data ?? []).find((x) => x.id === id)?.name ?? '—';
  const rows = q.data ?? [];
  const canEdit = may('edit', 'expiryDocument', ctx);
  const canArchive = may('archive', 'expiryDocument', ctx);

  const open = async (path: string) => {
    try { window.open(await repositories.documentExpiry.attachmentUrl(path), '_blank', 'noopener'); }
    catch (err) { const c = classifyMutationError(err); toast(c.headline, c.detail, 'error'); }
  };
  const doArchive = async () => {
    if (!archiving) return;
    setProblem(null);
    try { await archive.mutateAsync(archiving.id); toast(t('equipment:expiryEdit.archived', 'Document archived'), undefined, 'success'); setArchiving(null); }
    catch (err) { const c = classifyMutationError(err); setProblem(`${c.headline}. ${c.detail}`); }
  };

  const label = (d: ExpiryDocumentRow) => d.number ?? typeName(d.type_id);
  const columns: Column<ExpiryDocumentRow>[] = [
    { key: 'type', header: t('equipment:expiry.type', 'Document'), kind: 'primary', rowHeader: true, cell: (d) => typeName(d.type_id) },
    { key: 'detail', header: t('equipment:expiry.detail', 'Number / status'),
      cell: (d) => d.is_medical
        ? (d.medical_status === 'unfit' ? t('equipment:expiry.medical.unfit', 'Unfit') : t('equipment:expiry.medical.fit', 'Fit'))
        : d.number ? <span className="record-id">{d.number}</span> : null },
    { key: 'issued', header: t('equipment:expiryEdit.issued', 'Issue date'), cell: (d) => (d.issued_on ? formatDay(d.issued_on) : null) },
    { key: 'expires', header: t('equipment:expiry.expires', 'Expires'), cell: (d) => formatDay(d.expires_on) },
    { key: 'file', header: t('equipment:expiryEdit.attachment', 'Attachment'),
      cell: (d) => d.attachment_path
        ? <Button variant="ghost" size="sm" onClick={() => void open(d.attachment_path as string)}>{t('equipment:expiryEdit.openFile', 'Open file')}</Button> : null },
    { key: 'actions', header: <span className="sr-only">{t('equipment:expiryEdit.actions', 'Actions')}</span>,
      cell: (d) => (canEdit || canArchive) ? (
        <span className="flex gap-1">
          {canEdit && <Button variant="ghost" size="sm" aria-label={t('equipment:expiryEdit.editLabel', 'Edit {{name}}', { name: label(d) })} onClick={() => setEditing(d)}>{t('equipment:expiryEdit.edit', 'Edit')}</Button>}
          {canArchive && <Button variant="ghost" size="sm" aria-label={t('equipment:expiryEdit.archiveLabel', 'Archive {{name}}', { name: label(d) })} onClick={() => setArchiving(d)}>{t('equipment:expiryEdit.archive', 'Archive')}</Button>}
        </span>) : null },
  ];

  return (
    <Card role="region" aria-label={t('equipment:expiryEdit.title', 'Documents')} className="mb-4">
      <CardHead actions={<CanWrite entity="expiryDocument" action="create" ctx={ctx}>
        <Button size="sm" onClick={() => setEditing('new')}>{t('equipment:expiryEdit.add', 'Add document')}</Button>
      </CanWrite>}>{t('equipment:expiryEdit.title', 'Documents')}</CardHead>
      <CardPad className="pt-0">
        {q.isPending && <ListState variant="loading" rows={2} />}
        {!q.isPending && q.isError && <ListState variant="error" title={t('equipment:expiryEdit.error', "Couldn't load documents")}
          sub={t('equipment:expiry.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void q.refetch()} retryLabel={t('equipment:usage.retry', 'Retry')} />}
        {!q.isPending && !q.isError && (rows.length === 0
          ? <ListState variant="empty" title={t('equipment:expiryEdit.empty', 'No documents on this record')}
              sub={t('equipment:expiryEdit.emptySub', 'Certificates and permits show here with their expiry dates.')} />
          : <DataTable<ExpiryDocumentRow> embedded rows={rows} columns={columns} rowKey={(d) => d.id} tableId={`expiry-documents-${kind}`}
              accessibleName={t('equipment:expiryEdit.title', 'Documents')} />)}
      </CardPad>
      {editing && <ExpiryDocumentForm kind={kind} subjectId={subjectId} doc={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={archiving !== null} tone="destructive" title={t('equipment:expiryEdit.archiveTitle', 'Archive document')}
        description={t('equipment:expiryEdit.archiveBody', 'It leaves this record and the expiry list, and no more warnings are sent for it.')}
        confirmLabel={t('equipment:expiryEdit.archive', 'Archive')} loading={archive.isPending} error={problem}
        onConfirm={() => void doArchive()} onCancel={() => { setArchiving(null); setProblem(null); }} />
    </Card>
  );
};
