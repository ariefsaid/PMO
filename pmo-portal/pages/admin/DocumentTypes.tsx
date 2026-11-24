import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Checkbox, ConfirmDialog, DataTable, EntityFormModal, FieldError, FormGrid, Icon, ListState, SelectField, TextField, useToast,
  type Column, type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import {
  useAdminDocumentTypes, useDocumentTypeMutations, useDocumentWarningDays, useSetDocumentWarningDays,
} from '@/src/hooks/useDocumentExpiry';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';
import { DEFAULT_NOTIFY_ROLES, NOTIFY_ROLES, parseWarningDays, type AdminDocumentTypeRow, type NotifyRole, type SubjectKind } from '@/src/lib/db/documentExpiry';

interface TypeFormValues { name: string; applies_to: SubjectKind; is_medical: boolean; notify_roles: NotifyRole[]; notify_person: boolean }

const TypeForm: React.FC<{ type?: AdminDocumentTypeRow; onClose: () => void }> = ({ type, onClose }) => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const canPerson = may('manage', 'documentType', { record: { viewOnly, applies_to: 'person', medical: false } });
  const canEquipment = may('manage', 'documentType', { record: { viewOnly, applies_to: 'equipment', medical: false } });
  const canMedical = may('manage', 'documentType', { record: { viewOnly, applies_to: 'person', medical: true } });
  const defaultKind: SubjectKind = type?.applies_to ?? (canPerson ? 'person' : 'equipment');
  const { create, update } = useDocumentTypeMutations();
  const [v, setV] = useState<TypeFormValues>({
    name: type?.name ?? '',
    applies_to: defaultKind,
    is_medical: type?.is_medical ?? false,
    notify_roles: type?.notify_roles ?? DEFAULT_NOTIFY_ROLES[defaultKind],
    notify_person: type?.is_medical ? false : (type?.notify_person ?? false),
  });
  const [nameError, setNameError] = useState<string>();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [saving, setSaving] = useState(false);
  const toggleRole = (role: NotifyRole, on: boolean) =>
    setV((c) => ({ ...c, notify_roles: on ? [...c.notify_roles, role] : c.notify_roles.filter((r) => r !== role) }));

  const appliesOptions = [
    ...(canPerson ? [{ value: 'person', label: t('documentTypes.person', 'Person') }] : []),
    ...(canEquipment ? [{ value: 'equipment', label: t('documentTypes.equipment', 'Equipment') }] : []),
  ];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!v.name.trim()) { setNameError(t('documentTypes.errName', 'Enter the document type name')); return; }
    setSaving(true);
    const run = type
      ? update.mutateAsync({ id: type.id, input: { name: v.name, notify_roles: v.notify_roles, notify_person: v.notify_person } })
      : create.mutateAsync({
          name: v.name,
          applies_to: v.applies_to,
          is_medical: canMedical && v.is_medical && v.applies_to === 'person',
          notify_roles: v.notify_roles,
          notify_person: v.notify_person,
        });
    run.then(() => { toast(t('documentTypes.saved', 'Document type saved'), undefined, 'success'); onClose(); })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : '';
        if (message.includes('document_types_name_live')) setNameError(t('documentTypes.dupName', 'A document type with that name already exists'));
        else { const c = classifyMutationError(err); setSubmitError({ headline: c.headline, detail: c.detail }); }
      })
      .finally(() => setSaving(false));
  };

  return (
    <EntityFormModal open title={type ? t('documentTypes.editTitle', 'Edit document type') : t('documentTypes.addTitle', 'Add document type')}
      submitLabel={t('documentTypes.save', 'Save document type')} onSubmit={submit} onClose={onClose}
      loading={saving} dirty submitError={submitError}>
      <FormGrid>
        <TextField id="document-type-name" label={t('documentTypes.name', 'Name')} required value={v.name} error={nameError}
          onChange={(name) => { setV((c) => ({ ...c, name })); setNameError(undefined); }} />
        {!type && (
          <SelectField id="document-type-applies" label={t('documentTypes.appliesTo', 'Applies to')} value={v.applies_to}
            onChange={(applies_to) => setV((c) => ({ ...c, applies_to: applies_to as SubjectKind, is_medical: canMedical && applies_to === 'person' && c.is_medical, notify_roles: DEFAULT_NOTIFY_ROLES[applies_to as SubjectKind] }))}
            options={appliesOptions} />
        )}
        {!type && v.applies_to === 'person' && canMedical && (
          <Checkbox checked={v.is_medical} onChange={(is_medical) => setV((c) => ({ ...c, is_medical }))}
            label={t('documentTypes.medical', 'Medical document (status and date only, visible to Admin and HR)')}>
            {t('documentTypes.medical', 'Medical document (status and date only, visible to Admin and HR)')}
          </Checkbox>
        )}
        {v.is_medical && <p className="text-control text-muted-foreground">{t('documentTypes.medicalNotice', 'Expiry warnings go to the people team and direct manager. The worker is told after release is approved.')}</p>}
        <fieldset className="space-y-1">
          <legend className="text-control font-semibold">{t('documentTypes.roles', 'Roles notified')}</legend>
          <p className="text-control text-muted-foreground">{t('documentTypes.rolesHelp', "Tick the roles to warn before a document of this type expires. A person's direct manager is always warned too.")}</p>
          {(type ? type.applies_to : v.applies_to) === 'person' && !v.is_medical && (
            <Checkbox checked={v.notify_person} onChange={(notify_person) => setV((c) => ({ ...c, notify_person }))}
              label={t('documentTypes.notifyPerson', 'Also tell the person')}>{t('documentTypes.notifyPerson', 'Also tell the person')}</Checkbox>
          )}
          {NOTIFY_ROLES.map((role) => (
            <Checkbox key={role} checked={v.notify_roles.includes(role)} onChange={(on) => toggleRole(role, on)} label={role}>{role}</Checkbox>
          ))}
        </fieldset>
      </FormGrid>
    </EntityFormModal>
  );
};

const WarningDays: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const q = useDocumentWarningDays();
  const save = useSetDocumentWarningDays();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const saved = (q.data ?? []).join(', ');
  const value = draft ?? saved;

  if (q.isError && !q.data) {
    return <ListState variant="error" title={t('documentTypes.daysLoadError', "Couldn't load the warning days")} onRetry={() => void q.refetch()} />;
  }
  if (!q.data) return <ListState variant="loading" rows={1} />;
  if (!canManage) {
    return <p className="text-control"><span className="font-semibold">{saved}</span> <span className="text-muted-foreground">{t('documentTypes.adminOnly', 'Only an Admin can change this.')}</span></p>;
  }
  return (
    <form className="max-w-md space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const days = parseWarningDays(value);
      if (!days) { setError(t('documentTypes.daysInvalid', 'Enter 1 to 5 whole numbers of days, from 1 to 365, separated by commas.')); return; }
      setError(undefined);
      save.mutate(days, {
        onSuccess: () => { setDraft(null); toast(t('documentTypes.daysSaved', 'Warning days saved'), undefined, 'success'); },
        onError: (err) => { const c = classifyMutationError(err); setError(c.detail || c.headline); },
      });
    }}>
      <TextField id="document-warning-days" label={t('documentTypes.daysLabel', 'Warn this many days before expiry')} value={value}
        helper={t('documentTypes.daysHelp', 'Up to 5 values, for example 30, 14, 7.')}
        onChange={(next) => { setDraft(next); setError(undefined); }} disabled={save.isPending} />
      {error && <FieldError>{error}</FieldError>}
      <Button type="submit" variant="primary" disabled={save.isPending || value === saved}>{t('documentTypes.daysSave', 'Save warning days')}</Button>
    </form>
  );
};

/**
 * Administration › Document types (#2614): the types people and equipment documents are filed under, who is notified, and the
 * warning days. An Admin, or the HR Manager for person types that are not medical, via `can('manage', 'documentType')` (UX); RLS,
 * the column grants and set_document_warning_days enforce it (ADR-0016).
 */
const DocumentTypes: React.FC = () => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  // An Admin manages every type; the HR Manager job role manages person types that are not medical, and the warning days (2042).
  const canManage = may('manage', 'documentType', useMemo(() => ({ record: { viewOnly, applies_to: 'person', medical: false } }), [viewOnly]));
  const canManageRow = (r: AdminDocumentTypeRow) => may('manage', 'documentType', { record: { viewOnly, applies_to: r.applies_to, medical: r.is_medical } });
  const q = useAdminDocumentTypes();
  const { archive } = useDocumentTypeMutations();
  const [editing, setEditing] = useState<AdminDocumentTypeRow | 'new' | null>(null);
  const [archiving, setArchiving] = useState<AdminDocumentTypeRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const rows = q.data ?? [];

  const doArchive = async () => {
    if (!archiving) return;
    setProblem(null);
    try { await archive.mutateAsync(archiving.id); toast(t('documentTypes.archived', 'Document type archived'), undefined, 'success'); setArchiving(null); }
    catch (err) { const c = classifyMutationError(err); setProblem(joinSentences(c.headline, c.detail)); }
  };

  const columns: Column<AdminDocumentTypeRow>[] = [
    { key: 'name', header: t('documentTypes.name', 'Name'), kind: 'primary', rowHeader: true, cell: (r) => <span className="font-semibold">{r.name}</span> },
    { key: 'kind', header: t('documentTypes.appliesTo', 'Applies to'),
      cell: (r) => <span>{r.applies_to === 'person' ? t('documentTypes.person', 'Person') : t('documentTypes.equipment', 'Equipment')}</span> },
    { key: 'medical', header: t('documentTypes.medicalCol', 'Medical'), cell: (r) => (r.is_medical ? <span>{t('documentTypes.yes', 'Yes')}</span> : null) },
    { key: 'roles', header: t('documentTypes.roles', 'Roles notified'), cell: (r) => {
      const who = [...(r.applies_to === 'person' ? [t('documentTypes.manager', 'Direct manager')] : []), ...r.notify_roles, ...(r.applies_to === 'person' && !r.is_medical && r.notify_person ? [t('documentTypes.thePerson', 'The person')] : [])];
      return <span>{who.length ? who.join(', ') : t('documentTypes.noOne', 'No one is warned')}</span>;
    } },
    { key: 'actions', header: <span className="sr-only">{t('documentTypes.actions', 'Actions')}</span>,
      cell: (r) => canManageRow(r) ? (
        <span className="flex gap-1">
          <Button variant="ghost" size="sm" aria-label={t('documentTypes.editLabel', 'Edit {{name}}', { name: r.name })} onClick={() => setEditing(r)}>{t('documentTypes.edit', 'Edit')}</Button>
          <Button variant="ghost" size="sm" aria-label={t('documentTypes.archiveLabel', 'Archive {{name}}', { name: r.name })} onClick={() => setArchiving(r)}>{t('documentTypes.archive', 'Archive')}</Button>
        </span>) : null },
  ];

  return (
    <section id="document-types" tabIndex={-1} className="mt-8 scroll-mt-4" aria-labelledby="document-types-heading">
      <h2 id="document-types-heading" className="text-group font-semibold tracking-[-0.01em]">{t('documentTypes.title', 'Document types')}</h2>
      <div className="mt-3 mb-[var(--space-group)] flex justify-end">
        {canManage && <Button variant="primary" onClick={() => setEditing('new')}><Icon name="plus" />{t('documentTypes.add', 'Add document type')}</Button>}
      </div>
      {q.isPending && <ListState variant="loading" shape="table" rows={3} />}
      {!q.isPending && q.isError && <ListState variant="error" title={t('documentTypes.error', "Couldn't load document types")}
        sub={t('documentTypes.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void q.refetch()} retryLabel={t('documentTypes.retry', 'Retry')} />}
      {!q.isPending && !q.isError && (rows.length === 0
        ? <ListState variant="empty" title={t('documentTypes.empty', 'No document types yet. Add one so documents can be recorded for people and equipment.')}
            action={canManage ? { label: t('documentTypes.add', 'Add document type'), onClick: () => setEditing('new') } : undefined} />
        : <DataTable<AdminDocumentTypeRow> rows={rows} columns={columns} rowKey={(r) => r.id} tableId="document-types" />)}
      <h3 className="mt-6 mb-2 text-control font-semibold">{t('documentTypes.daysTitle', 'Expiry warning days')}</h3>
      <WarningDays canManage={canManage} />
      {editing && <TypeForm type={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={archiving !== null} tone="destructive" title={t('documentTypes.archiveTitle', 'Archive document type')}
        description={t('documentTypes.archiveBody', 'It can no longer be chosen for new documents. Documents already filed under it are kept.')}
        confirmLabel={t('documentTypes.archive', 'Archive')} loading={archive.isPending} error={problem}
        onConfirm={() => void doArchive()} onCancel={() => { setArchiving(null); setProblem(null); }} />
    </section>
  );
};
export default DocumentTypes;
