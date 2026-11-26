import React, { useContext, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, buttonClasses, Combobox, DataTable, EntityFormModal, FormGrid, Icon, ListState, StatusPill, TextField, ViewToggle, useToast,
  type Column, type SubmitError,
} from '@/src/components/ui';

import { useUrlFilters } from '@/src/components/ui/useUrlFilters';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { AuthContext } from '@/src/auth/AuthContext';
import { usePeople, usePeopleMutations } from '@/src/hooks/usePeople';
import { useOrgProfilesLoader } from '@/src/hooks/useOrgProfilesLoader';
import { PersonDocumentImport } from './PersonDocumentImport';
import { ImportButton } from '@/src/components/import';
import { makePeopleImportDescriptor, type ManagerChoice } from '@/src/lib/import';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { MarkLeftDialog } from './MarkLeftDialog';
import type { PersonListRow, PeopleListStatus } from '@/src/lib/db/people';

interface FormValues { name: string; code: string; job_title: string; profile_id: string; manager_id: string }

const initial = (p?: PersonListRow): FormValues => ({ name: p?.name ?? '', code: p?.code ?? '', job_title: p?.job_title ?? '', profile_id: p?.profile_id ?? '', manager_id: p?.manager_id ?? '' });

/** Add or edit one person. A blank code on add is assigned by the database (P-0001, …); on edit the code is required. */
/** Who may set the manager link (1930, the database decides): `any` (an Admin), `others` (the people team: never themselves), `none`. */
type ManagerMode = { kind: 'any' } | { kind: 'others'; self: string | null } | { kind: 'none' };

const PersonForm: React.FC<{ person?: PersonListRow; profileNames: Map<string, string>; managerMode: ManagerMode; onClose: () => void }> = ({ person, profileNames, managerMode, onClose }) => {
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
  // The manager is chosen from active members only: a manager who has left would be warned into nothing.
  const self = managerMode.kind === 'others' ? managerMode.self : null;
  const loadManagers = useMemo(() => async () => (await loadProfiles()).filter((p) => p.status === 'active' && p.id !== self).map((p) => ({ value: p.id, label: p.full_name })), [loadProfiles, self]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      const base = { name: v.name.trim(), job_title: v.job_title.trim() || null, profile_id: v.profile_id || null, manager_id: v.manager_id || null };
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
        <Combobox label={t('administration:people.manager', 'Direct manager (optional)')} value={form.values.manager_id || null} clearable
          selectedOption={form.values.manager_id ? { value: form.values.manager_id, label: profileNames.get(form.values.manager_id) ?? form.values.manager_id } : null}
          loadOptions={loadManagers} placeholder={t('administration:people.managerPlaceholder', 'No manager set')}
          searchPlaceholder={t('administration:people.managerSearch', 'Search users')}
          disabled={managerMode.kind === 'none'}
          helper={managerMode.kind === 'none' ? t('administration:people.managerReadOnly', 'Only an Admin or the people team (HR) can change the direct manager.') : undefined}
          onChange={(value) => form.setValue('manager_id', value)} />
        <p className="col-span-full text-control text-muted-foreground">{t('administration:people.managerHelp', "The manager is warned first when this person's documents are about to expire, and records the renewal.")}</p>
      </FormGrid>
    </EntityFormModal>
  );
};

/** The People register (#2542 follow-up): everyone who holds expiring documents, app user or not. Writes are gated by
 *  `can()` (UX only; RLS and the column grants decide). A row opens the person record, where documents are added.
 *  A staff-status filter (#2703) keeps former staff out of the way while leaving them on record: Active is the
 *  default and the pre-#2703 read; Former staff and All are opt-in views, held in the URL. */
const People: React.FC = () => {
  const { t } = useTranslation();
  const { realRole, effectiveRole } = useEffectiveRole();
  const may = usePermission();
  const ctx = useMemo(() => ({ record: { viewOnly: realRole !== effectiveRole } }), [realRole, effectiveRole]);
  const { values: filters, setFilter } = useUrlFilters(['staff']);
  const staffView: PeopleListStatus = filters.staff === 'former' ? 'former' : filters.staff === 'all' ? 'all' : 'active';
  const q = usePeople(staffView);
  const [editing, setEditing] = useState<PersonListRow | 'new' | null>(null);
  const [leaving, setLeaving] = useState<PersonListRow | null>(null);
  const loadProfiles = useOrgProfilesLoader();
  const [profileNames, setProfileNames] = useState<Map<string, string>>(new Map());
  const rows = q.data ?? [];
  const [managerChoices, setManagerChoices] = useState<ManagerChoice[]>([]);
  const me = useContext(AuthContext)?.currentUser?.id ?? null;
  const mayManager = may('setManager', 'person', ctx);
  const mayNameSelf = may('setSelfAsManager', 'person', ctx);
  const managerMode: ManagerMode = !mayManager ? { kind: 'none' } : mayNameSelf ? { kind: 'any' } : { kind: 'others', self: me };
  const importDescriptor = useMemo(
    () => makePeopleImportDescriptor({ people: () => repositories.people.list(), managers: managerChoices,
      managerRule: { may: mayManager, maySelf: mayNameSelf, self: me } }, t),
    [t, managerChoices, mayManager, mayNameSelf, me],
  );
  const canEdit = may('edit', 'person', ctx);
  const canLeave = may('archive', 'person', ctx);
  const setStaffView = (next: typeof staffView) => setFilter('staff', next === 'active' ? '' : next);

  React.useEffect(() => {
    let live = true;
    void loadProfiles().then((ps) => { if (live) { setProfileNames(new Map(ps.map((p) => [p.id, p.full_name]))); setManagerChoices(ps.filter((p) => p.status === 'active' && p.email).map((p) => ({ id: p.id, email: p.email }))); } }).catch(() => undefined);
    return () => { live = false; };
  }, [loadProfiles]);

  const columns: Column<PersonListRow>[] = [
    { key: 'name', header: t('administration:people.name', 'Name'), kind: 'primary', rowHeader: true,
      cell: (p) => <Link className="font-semibold text-foreground underline-offset-2 hover:underline" to={`/equipment/people/${p.id}`}>{p.name}</Link> },
    { key: 'code', header: t('administration:people.code', 'Person code'), cell: (p) => <span className="record-id">{p.code}</span> },
    { key: 'title', header: t('administration:people.jobTitle', 'Job title'), cell: (p) => (p.job_title ? <span>{p.job_title}</span> : null) },
    ...(staffView === 'active' ? [] : [{
      key: 'status', header: t('administration:people.staffStatus', 'Staff status'),
      cell: (p: PersonListRow) => (p.archived_at
        ? <StatusPill variant="neutral">{t('administration:people.former', 'Former staff')}</StatusPill>
        : <span className="text-sm text-muted-foreground">{t('administration:people.active', 'Active')}</span>),
    } as Column<PersonListRow>]),
    { key: 'user', header: t('administration:people.user', 'App user (optional)'),
      cell: (p) => (p.profile_id ? <span>{profileNames.get(p.profile_id) ?? '…'}</span> : null) },
    { key: 'actions', header: <span className="sr-only">{t('administration:people.actions', 'Actions')}</span>,
      cell: (p) => (!p.archived_at && (canEdit || canLeave)) ? (
        <span className="flex gap-1">
          {canEdit && <Button variant="ghost" size="sm" aria-label={t('administration:people.editLabel', 'Edit {{name}}', { name: p.name })} onClick={() => setEditing(p)}>{t('administration:people.edit', 'Edit')}</Button>}
          {canLeave && <Button variant="ghost" size="sm" aria-label={t('administration:people.markLeftLabel', 'Mark {{name}} as left', { name: p.name })} onClick={() => setLeaving(p)}>{t('administration:people.markLeft', 'Mark as left')}</Button>}
        </span>) : null },
  ];

  return (
    <div>
      <div className={`flex flex-wrap items-center justify-between gap-[var(--space-group)] ${rows.length ? 'mb-[var(--space-group)]' : ''}`}>
        <div className="w-full min-w-0 md:w-auto">
          <ViewToggle<PeopleListStatus> semantics="toggle" ariaLabel={t('administration:people.staffStatus', 'Staff status')}
            value={staffView} onChange={setStaffView} className="w-full flex-wrap md:w-auto"
            options={[
              { value: 'active', label: t('administration:people.active', 'Active') },
              { value: 'former', label: t('administration:people.former', 'Former staff') },
              { value: 'all', label: t('administration:people.all', 'All') },
            ]} />
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-group)]">
          {/* Walk F13-1: the expiring-documents list (people and equipment) sat under Equipment only. */}
          <Link to="/equipment/expiring" className={buttonClasses('outline')} data-testid="people-expiring-link">{t('administration:people.expiring', 'Expiring documents')}</Link>
          <PersonDocumentImport onImported={() => void q.refetch()} />
          <CanWrite entity="person" action="create" ctx={ctx}>
            <ImportButton entity="person" label={t('administration:people.importPeople', 'Import people')} descriptor={importDescriptor} onImported={() => void q.refetch()} />
            <Button variant="primary" onClick={() => setEditing('new')}><Icon name="plus" />{t('administration:people.add', 'Add person')}</Button>
          </CanWrite>
        </div>
      </div>
      {q.isPending && <ListState variant="loading" shape="table" rows={4} />}
      {!q.isPending && q.isError && <ListState variant="error" title={t('administration:people.error', "Couldn't load people")}
        sub={t('administration:people.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void q.refetch()} retryLabel={t('administration:people.retry', 'Retry')} />}
      {!q.isPending && !q.isError && (rows.length === 0
        ? <ListState variant="empty" quiet className="mt-3"
            title={staffView === 'former'
              ? t('administration:people.formerEmpty', 'No former staff. People you mark as left appear here.')
              : t('administration:people.empty', 'No people yet. Add the first person to record their documents.')}
            action={staffView === 'active' && canEdit ? { label: t('administration:people.add', 'Add person'), onClick: () => setEditing('new') } : undefined} />
        : <DataTable<PersonListRow> rows={rows} columns={columns} rowKey={(p) => p.id} tableId="people-register" />)}
      {editing && <PersonForm person={editing === 'new' ? undefined : editing} profileNames={profileNames} managerMode={managerMode} onClose={() => setEditing(null)} />}
      <MarkLeftDialog person={leaving} onClose={() => setLeaving(null)} />
    </div>
  );
};
export default People;
