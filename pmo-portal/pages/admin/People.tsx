import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, Combobox, ConfirmDialog, DataTable, EntityFormModal, FormGrid, Icon, ListState, TextField, useToast,
  type Column, type SubmitError,
} from '@/src/components/ui';

import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePeople, usePeopleMutations } from '@/src/hooks/usePeople';
import { useOrgProfilesLoader } from '@/src/hooks/useOrgProfilesLoader';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { PersonListRow } from '@/src/lib/db/people';

interface FormValues { name: string; code: string; job_title: string; profile_id: string }

const initial = (p?: PersonListRow): FormValues => ({ name: p?.name ?? '', code: p?.code ?? '', job_title: p?.job_title ?? '', profile_id: p?.profile_id ?? '' });

/** Add or edit one person. A blank code on add is assigned by the database (P-0001, …); on edit the code is required. */
const PersonForm: React.FC<{ person?: PersonListRow; profileNames: Map<string, string>; onClose: () => void }> = ({ person, profileNames, onClose }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { create, update } = usePeopleMutations();
  const loadProfiles = useOrgProfilesLoader();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const form = useEntityForm<FormValues>({
    initialValues: initial(person), idPrefix: 'person', requiredFields: person ? ['name', 'code'] : ['name'], module: 'people',
    validate: (v) => {
      const e: Partial<Record<keyof FormValues, string>> = {};
      if (!v.name.trim()) e.name = t('administration:people.errName', 'Enter the name');
      if (person && !v.code.trim()) e.code = t('administration:people.errCode', 'Enter a person code');
      return e;
    },
  });
  const loadOptions = useMemo(() => async () => (await loadProfiles()).map((p) => ({ value: p.id, label: p.full_name })), [loadProfiles]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      const base = { name: v.name.trim(), job_title: v.job_title.trim() || null, profile_id: v.profile_id || null };
      try {
        if (person) await update.mutateAsync({ id: person.id, input: { ...base, code: v.code.trim() } });
        else await create.mutateAsync({ ...base, code: v.code.trim() || null });
        toast(t('administration:people.saved', 'Person saved'), undefined, 'success');
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message.includes('people_code_live')) setSubmitError({ headline: t('administration:people.dupCode', 'That person code is already in use'), detail: t('administration:people.dupCodeSub', 'Choose another code, or leave it blank to have one assigned.') });
        else if (message.includes('people_profile_live')) setSubmitError({ headline: t('administration:people.dupProfile', 'That user is already linked to another person'), detail: t('administration:people.dupProfileSub', 'Choose a different user, or clear the link.') });
        else { const c = classifyMutationError(err); setSubmitError({ headline: c.headline, detail: c.detail }); }
      }
    });
  };

  const linked = form.values.profile_id;
  return (
    <EntityFormModal open title={person ? t('administration:people.editTitle', 'Edit person') : t('administration:people.addTitle', 'Add person')}
      submitLabel={t('administration:people.save', 'Save person')} onSubmit={submit} onClose={onClose}
      loading={form.isSubmitting} dirty={form.isDirty} submitError={submitError}
      errorSummary={form.hasAttemptedSubmit ? Object.entries(form.errors).map(([k, m]) => ({ fieldId: form.fieldProps(k as keyof FormValues).id, message: String(m) })) : undefined}>
      <FormGrid>
        <TextField label={t('administration:people.name', 'Name')} required {...form.fieldProps('name')} />
        <TextField label={t('administration:people.code', 'Person code')} required={Boolean(person)} spellCheck={false}
          placeholder={person ? undefined : t('administration:people.codeAuto', 'Assigned if left blank')} {...form.fieldProps('code')} />
        <TextField label={t('administration:people.jobTitle', 'Job title')} {...form.fieldProps('job_title')} />
        <Combobox label={t('administration:people.user', 'App user (optional)')} value={linked || null} clearable
          selectedOption={linked ? { value: linked, label: profileNames.get(linked) ?? linked } : null}
          loadOptions={loadOptions} placeholder={t('administration:people.userPlaceholder', 'Not an app user')}
          searchPlaceholder={t('administration:people.userSearch', 'Search users')}
          onChange={(value) => form.setValue('profile_id', value)} />
      </FormGrid>
    </EntityFormModal>
  );
};

/** The People register (#2542 follow-up): everyone who holds expiring documents, app user or not. Writes are gated by
 *  `can()` (UX only; RLS and the column grants decide). A row opens the person record, where documents are added. */
const People: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { realRole, effectiveRole } = useEffectiveRole();
  const may = usePermission();
  const ctx = useMemo(() => ({ record: { viewOnly: realRole !== effectiveRole } }), [realRole, effectiveRole]);
  const q = usePeople();
  const { archive } = usePeopleMutations();
  const [editing, setEditing] = useState<PersonListRow | 'new' | null>(null);
  const [archiving, setArchiving] = useState<PersonListRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const loadProfiles = useOrgProfilesLoader();
  const [profileNames, setProfileNames] = useState<Map<string, string>>(new Map());
  const rows = q.data ?? [];
  const canEdit = may('edit', 'person', ctx);
  const canArchive = may('archive', 'person', ctx);

  React.useEffect(() => {
    let live = true;
    void loadProfiles().then((ps) => { if (live) setProfileNames(new Map(ps.map((p) => [p.id, p.full_name]))); }).catch(() => undefined);
    return () => { live = false; };
  }, [loadProfiles]);

  const doArchive = async () => {
    if (!archiving) return;
    setProblem(null);
    try { await archive.mutateAsync(archiving.id); toast(t('administration:people.archived', 'Person archived'), undefined, 'success'); setArchiving(null); }
    catch (err) { const c = classifyMutationError(err); setProblem(`${c.headline}. ${c.detail}`); }
  };

  const columns: Column<PersonListRow>[] = [
    { key: 'name', header: t('administration:people.name', 'Name'), kind: 'primary', rowHeader: true,
      cell: (p) => <Link className="font-semibold text-foreground underline-offset-2 hover:underline" to={`/equipment/people/${p.id}`}>{p.name}</Link> },
    { key: 'code', header: t('administration:people.code', 'Person code'), cell: (p) => <span className="record-id">{p.code}</span> },
    { key: 'title', header: t('administration:people.jobTitle', 'Job title'), cell: (p) => (p.job_title ? <span>{p.job_title}</span> : null) },
    { key: 'user', header: t('administration:people.user', 'App user (optional)'),
      cell: (p) => (p.profile_id ? <span>{profileNames.get(p.profile_id) ?? '…'}</span> : null) },
    { key: 'actions', header: <span className="sr-only">{t('administration:people.actions', 'Actions')}</span>,
      cell: (p) => (canEdit || canArchive) ? (
        <span className="flex gap-1">
          {canEdit && <Button variant="ghost" size="sm" aria-label={t('administration:people.editLabel', 'Edit {{name}}', { name: p.name })} onClick={() => setEditing(p)}>{t('administration:people.edit', 'Edit')}</Button>}
          {canArchive && <Button variant="ghost" size="sm" aria-label={t('administration:people.archiveLabel', 'Archive {{name}}', { name: p.name })} onClick={() => setArchiving(p)}>{t('administration:people.archive', 'Archive')}</Button>}
        </span>) : null },
  ];

  return (
    <div>
      <div className="mb-[var(--space-group)] flex flex-wrap items-center justify-end gap-[var(--space-group)]">
        <CanWrite entity="person" action="create" ctx={ctx}>
          <Button variant="primary" onClick={() => setEditing('new')}><Icon name="plus" />{t('administration:people.add', 'Add person')}</Button>
        </CanWrite>
      </div>
      {q.isPending && <ListState variant="loading" shape="table" rows={4} />}
      {!q.isPending && q.isError && <ListState variant="error" title={t('administration:people.error', "Couldn't load people")}
        sub={t('administration:people.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void q.refetch()} retryLabel={t('administration:people.retry', 'Retry')} />}
      {!q.isPending && !q.isError && (rows.length === 0
        ? <ListState variant="empty" title={t('administration:people.empty', 'No people yet. Add the first person to record their documents.')}
            action={canEdit ? { label: t('administration:people.add', 'Add person'), onClick: () => setEditing('new') } : undefined} />
        : <DataTable<PersonListRow> rows={rows} columns={columns} rowKey={(p) => p.id} tableId="people-register" />)}
      {editing && <PersonForm person={editing === 'new' ? undefined : editing} profileNames={profileNames} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={archiving !== null} tone="destructive" title={t('administration:people.archiveTitle', 'Archive person')}
        description={t('administration:people.archiveBody', 'They leave the register and the expiry list, and no more warnings are sent for their documents.')}
        confirmLabel={t('administration:people.archive', 'Archive')} loading={archive.isPending} error={problem}
        onConfirm={() => void doArchive()} onCancel={() => { setArchiving(null); setProblem(null); }} />
    </div>
  );
};
export default People;
