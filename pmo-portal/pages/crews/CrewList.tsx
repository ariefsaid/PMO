import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, Combobox, ConfirmDialog, DataTable, DateField, EntityFormModal, FormGrid, Icon, ListState,
  SelectField, TextField, useEntityForm, useToast, type Column, type ComboboxOption, type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useUsers } from '@/src/hooks/useUsers';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { useCrewMembers, useCrewMutations, useCrewRoles, useCrewWorkers, useCrews } from '@/src/hooks/useCrews';
import type { CrewKind, CrewMemberRow, CrewRow } from '@/src/lib/repositories/crews';
import { formatDay } from '@/src/lib/format';
import { toIso } from '../equipment/equipmentWeek';
import { crewErrorMessage } from './crewErrors';

interface RoleDraft { name: string; headcount: string }

/** Create a crew with its standard roles (FR-CRW-001). */
const NewCrewModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('crews');
  const { toast } = useToast();
  const { createCrew } = useCrewMutations();
  const users = useUsers();
  const vendors = useVendorOptions();
  const disciplines = useCostDisciplines();
  const [roles, setRoles] = useState<RoleDraft[]>([{ name: '', headcount: '1' }]);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const form = useEntityForm({
    initialValues: { code: '', name: '', kind: 'own', controller: '', vendor: '', discipline: '' },
    idPrefix: 'crew',
    requiredFields: ['code', 'name'],
    validate: (v) => (v.kind === 'vendor' && !v.vendor ? { vendor: t('crews:vendorRequired', 'Choose the vendor company') } : {}),
  });
  const userOptions = useMemo(() => [{ value: '', label: t('crews:noController', 'No field controller') },
    ...(users.data ?? []).map((u) => ({ value: u.id, label: u.full_name ?? u.email ?? u.id }))], [users.data, t]);
  const loadVendors = useCallback(async () => vendors.data ?? [], [vendors.data]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      const cleanRoles = roles
        .map((r) => ({ name: r.name.trim(), headcount: Number(r.headcount) }))
        .filter((r) => r.name && Number.isInteger(r.headcount) && r.headcount > 0);
      try {
        await createCrew.mutateAsync({
          input: {
            code: v.code.trim(), name: v.name.trim(), kind: v.kind as CrewKind, discipline_id: v.discipline || null,
            field_controller_id: v.controller || null, vendor_company_id: v.kind === 'vendor' ? v.vendor || null : null,
          },
          roles: cleanRoles,
        });
        toast(t('crews:created', 'Crew created'), undefined, 'success');
        onClose();
      } catch (err) {
        setSubmitError({ headline: t('crews:saveFailed', 'Not saved'), detail: crewErrorMessage(t, err) });
      }
    });
  };
  return (
    <EntityFormModal open title={t('crews:newTitle', 'New crew')} submitLabel={t('crews:create', 'Create crew')}
      onSubmit={submit} onClose={onClose} loading={form.isSubmitting} dirty={form.isDirty} submitDisabled={!form.isComplete}
      submitError={submitError}>
      <FormGrid>
        <TextField label={t('crews:code', 'Code')} required code {...form.fieldProps('code')} />
        <TextField label={t('crews:name', 'Name')} required {...form.fieldProps('name')} />
        <SelectField label={t('crews:kind', 'Crew type')} value={form.values.kind} onChange={(v) => form.setValue('kind', v)}
          options={[{ value: 'own', label: t('crews:kindOwn', 'Own staff') }, { value: 'vendor', label: t('crews:kindVendor', 'Vendor crew') }]} />
        {form.values.kind === 'vendor' && (
          <Combobox id="crew-vendor" label={t('crews:vendor', 'Vendor company')} required value={form.values.vendor || null}
            selectedOption={(vendors.data ?? []).find((o) => o.value === form.values.vendor) ?? null} loadOptions={loadVendors}
            onChange={(v) => form.setValue('vendor', v)} error={form.errors.vendor}
            noun={t('crews:vendorNoun', 'vendor')} nounPlural={t('crews:vendorNounPlural', 'vendors')} />
        )}
        <SelectField label={t('crews:discipline', 'Discipline')} value={form.values.discipline}
          onChange={(v) => form.setValue('discipline', v)}
          options={[{ value: '', label: t('crews:noDiscipline', 'No discipline') }, ...(disciplines.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
        <SelectField label={t('crews:controller', 'Field controller')} value={form.values.controller}
          onChange={(v) => form.setValue('controller', v)} options={userOptions} />
      </FormGrid>
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-foreground">{t('crews:standardRoles', 'Standard roles')}</legend>
        {roles.map((r, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_96px] gap-2">
            <TextField label={t('crews:roleName', 'Crew role')} hideLabel={i > 0} value={r.name}
              onChange={(v) => setRoles((rs) => rs.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
            <TextField label={t('crews:headcount', 'Headcount')} hideLabel={i > 0} value={r.headcount} inputMode="numeric"
              onChange={(v) => setRoles((rs) => rs.map((x, j) => (j === i ? { ...x, headcount: v } : x)))} />
          </div>
        ))}
        <Button variant="ghost" size="sm" type="button" onClick={() => setRoles((rs) => [...rs, { name: '', headcount: '1' }])}>
          <Icon name="plus" />{t('crews:addRole', 'Add role')}
        </Button>
      </fieldset>
    </EntityFormModal>
  );
};

/** Place a person in the crew from a date, with an optional end (FR-CRW-003). New people are added here too. */
const PlacePersonModal: React.FC<{ crew: CrewRow; onClose: () => void }> = ({ crew, onClose }) => {
  const { t } = useTranslation('crews');
  const { toast } = useToast();
  const { realRole, effectiveRole } = useEffectiveRole();
  const canCreatePerson = realRole === effectiveRole && (realRole === 'Admin' || realRole === 'Project Manager');
  const { place, placeNewWorker } = useCrewMutations();
  const workers = useCrewWorkers();
  const roles = useCrewRoles(crew.id);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [query, setQuery] = useState('');
  const form = useEntityForm({
    initialValues: { worker: '', newName: '', role: '', from: toIso(new Date()), to: '' },
    idPrefix: 'crew-place',
    requiredFields: ['from'],
    validate: (v) => (!v.worker && (!canCreatePerson || !v.newName.trim()) ? { worker: t('crews:personRequired', 'Choose a person or type a new name') } : {}),
  });
  // ONE field: pick someone in the register, or type a name and add them as a new person (Admin and Project Manager only).
  const NEW = 'new:';
  const typed = query.trim();
  const workerOptions: ComboboxOption[] = useMemo(() => {
    const existing = (workers.data ?? []).map((w) => ({ value: w.id, label: w.display_name }));
    const shown = typed ? existing.filter((o) => o.label.toLowerCase().includes(typed.toLowerCase())) : existing;
    const exact = existing.some((o) => o.label.toLowerCase() === typed.toLowerCase());
    return canCreatePerson && typed && !exact
      ? [...shown, { value: `${NEW}${typed}`, label: t('crews:addNewPerson', 'Add "{{name}}" as a new person', { name: typed }) }]
      : shown;
  }, [workers.data, typed, canCreatePerson, t]);
  const chosen = form.values.worker || (form.values.newName ? `${NEW}${form.values.newName}` : '');
  const selectedOption: ComboboxOption | null = form.values.worker
    ? (workers.data ?? []).map((w) => ({ value: w.id, label: w.display_name })).find((o) => o.value === form.values.worker) ?? null
    : form.values.newName ? { value: chosen, label: t('crews:newPersonChip', '{{name}} (new person)', { name: form.values.newName }) } : null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      try {
        const placement = { crew_id: crew.id, standard_role_id: v.role || null, valid_from: v.from, valid_to: v.to || null };
        if (v.worker) {
          await place.mutateAsync({ ...placement, worker_id: v.worker });
        } else {
          await placeNewWorker.mutateAsync({
            person: { kind: crew.kind, display_name: v.newName.trim(), id_reference: null, profile_id: null,
              vendor_company_id: crew.kind === 'vendor' ? crew.vendor_company_id : null },
            placement,
          });
        }
        toast(t('crews:placed', 'Person placed'), undefined, 'success');
        onClose();
      } catch (err) {
        setSubmitError({ headline: t('crews:saveFailed', 'Not saved'), detail: crewErrorMessage(t, err) });
      }
    });
  };
  return (
    <EntityFormModal open title={t('crews:placeTitle', 'Add a person to {{crew}}', { crew: crew.name })}
      submitLabel={t('crews:place', 'Add person')} onSubmit={submit} onClose={onClose} loading={form.isSubmitting}
      dirty={form.isDirty} submitDisabled={!form.isComplete} submitError={submitError}>
      <FormGrid>
        <Combobox id="crew-place-worker" label={t('crews:person', 'Person')} value={chosen || null} selectedOption={selectedOption}
          serverSearch={{ options: workerOptions, status: workers.isPending ? 'loading' : 'ready', onQueryChange: setQuery, onRetry: () => undefined }}
          onChange={(v) => {
            if (v.startsWith(NEW)) { form.setValue('worker', ''); form.setValue('newName', v.slice(NEW.length)); }
            else { form.setValue('worker', v); form.setValue('newName', ''); }
          }}
          clearable onClear={() => { form.setValue('worker', ''); form.setValue('newName', ''); }} error={form.errors.worker}
          placeholder={canCreatePerson ? t('crews:personPickOrType', 'Choose a person, or type a new name') : t('crews:personPick', 'Choose a person')}
          searchPlaceholder={t('crews:personSearch', 'Search or type a name')}
          noun={t('crews:personNoun', 'person')} nounPlural={t('crews:personNounPlural', 'people')} />
        <SelectField label={t('crews:roleName', 'Crew role')} value={form.values.role} onChange={(v) => form.setValue('role', v)}
          options={[{ value: '', label: t('crews:noRole', 'Not set yet') }, ...(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))]} />
        <DateField label={t('crews:from', 'From')} required value={form.values.from} onChange={(v) => form.setValue('from', v)} />
        <DateField label={t('crews:to', 'To')} value={form.values.to} onChange={(v) => form.setValue('to', v)} min={form.values.from} />
      </FormGrid>
    </EntityFormModal>
  );
};

/** Set or change the crew role of someone already in the crew. Their dates stay; the roster figures count them from now on. */
const SetCrewRoleModal: React.FC<{ crew: CrewRow; member: CrewMemberRow; personName: string; onClose: () => void }> = ({ crew, member, personName, onClose }) => {
  const { t } = useTranslation('crews');
  const { toast } = useToast();
  const roles = useCrewRoles(crew.id);
  const { setPlacementRole } = useCrewMutations();
  const [role, setRole] = useState(member.standard_role_id ?? '');
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    try {
      await setPlacementRole.mutateAsync({ id: member.id, version: member.version, valid_from: member.valid_from, valid_to: member.valid_to, standard_role_id: role || null });
      toast(t('crews:roleSet', 'Crew role saved'), undefined, 'success');
      onClose();
    } catch (err) {
      setSubmitError({ headline: t('crews:saveFailed', 'Not saved'), detail: crewErrorMessage(t, err) });
    }
  };
  return (
    <EntityFormModal open title={t('crews:setRoleTitle', 'Crew role for {{name}}', { name: personName })} submitLabel={t('crews:saveRole', 'Save crew role')}
      onSubmit={(e) => void submit(e)} onClose={onClose} loading={setPlacementRole.isPending} dirty={role !== (member.standard_role_id ?? '')}
      submitDisabled={!role} submitError={submitError}>
      <FormGrid>
        <SelectField label={t('crews:roleName', 'Crew role')} required value={role} onChange={setRole} placeholder={t('crews:pickRole', 'Choose a crew role')}
          options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
      </FormGrid>
    </EntityFormModal>
  );
};

/** The selected crew's people, newest placement first, with end-placement (FR-CRW-003/005). */
const CrewMembersCard: React.FC<{ crew: CrewRow; canManage: boolean }> = ({ crew, canManage }) => {
  const { t } = useTranslation('crews');
  const { toast } = useToast();
  const members = useCrewMembers(crew.id);
  const workers = useCrewWorkers();
  const roles = useCrewRoles(crew.id);
  const { endPlacement } = useCrewMutations();
  const [placing, setPlacing] = useState(false);
  const [ending, setEnding] = useState<CrewMemberRow | null>(null);
  const [settingRole, setSettingRole] = useState<CrewMemberRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const nameOf = (id: string) => workers.data?.find((w) => w.id === id)?.display_name ?? '—';
  const roleOf = (id: string | null) => (id ? roles.data?.find((r) => r.id === id)?.name ?? '—' : null);
  const today = toIso(new Date());
  const end = async () => {
    const m = ending;
    if (!m) return;
    setEnding(null);
    setProblem(null);
    try {
      await endPlacement.mutateAsync({ id: m.id, version: m.version, valid_from: m.valid_from, valid_to: today < m.valid_from ? m.valid_from : today, standard_role_id: m.standard_role_id });
      toast(t('crews:ended', 'Placement ended'), undefined, 'success');
    } catch (err) { setProblem(crewErrorMessage(t, err)); }
  };
  const columns: Column<CrewMemberRow>[] = [
    { key: 'person', header: t('crews:person', 'Person'), kind: 'primary', rowHeader: true, cell: (m) => nameOf(m.worker_id) },
    { key: 'role', header: t('crews:roleName', 'Crew role'), cell: (m) => roleOf(m.standard_role_id)
      ?? <span className="text-warning-foreground">{t('crews:roleNotSet', 'Crew role not set')}</span> },
    { key: 'from', header: t('crews:from', 'From'), cell: (m) => formatDay(m.valid_from) },
    { key: 'to', header: t('crews:to', 'To'), cell: (m) => (m.valid_to ? formatDay(m.valid_to) : t('crews:open', 'Open')) },
  ];
  return (
    <Card className="mt-6">
      <CardHead actions={canManage ? <Button variant="outline" size="sm" onClick={() => setPlacing(true)}><Icon name="plus" />{t('crews:place', 'Add person')}</Button> : undefined}>
        {t('crews:membersOf', 'People in {{crew}}', { crew: crew.name })}
      </CardHead>
      <CardPad>
        {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
        {members.isPending ? <ListState variant="loading" shape="table" rows={3} /> : members.isError ? (
          <ListState variant="error" title={t('crews:membersError', "Couldn't load this crew's people")} onRetry={() => void members.refetch()}
            retryLabel={t('crews:retry', 'Retry')} />
        ) : (
          <DataTable<CrewMemberRow> rows={members.data ?? []} columns={columns} rowKey={(m) => m.id} tableId="crew-members-table"
            rowMenu={(m) => (canManage && (!m.valid_to || m.valid_to >= today)
              ? [
                  ...((roles.data ?? []).length > 0 ? [{ label: m.standard_role_id ? t('crews:changeRole', 'Change crew role') : t('crews:setRole', 'Set crew role'), onClick: () => setSettingRole(m) }] : []),
                  { label: t('crews:endPlacement', 'End placement'), onClick: () => setEnding(m) },
                ] : [])}
            state={(members.data ?? []).length === 0 ? 'empty' : undefined}
            emptyTitle={t('crews:noMembers', 'No people in this crew yet')}
            emptyAction={canManage ? { label: t('crews:place', 'Add person'), onClick: () => setPlacing(true) } : undefined}
            emptyActionVariant="outline" />
        )}
      </CardPad>
      {placing && <PlacePersonModal crew={crew} onClose={() => setPlacing(false)} />}
      {settingRole && <SetCrewRoleModal crew={crew} member={settingRole} personName={nameOf(settingRole.worker_id)} onClose={() => setSettingRole(null)} />}
      <ConfirmDialog open={ending !== null} title={t('crews:endTitle', 'End this placement?')}
        description={t('crews:endBody', '{{name}} leaves the crew after today. Recorded attendance stays.', { name: ending ? nameOf(ending.worker_id) : '' })}
        confirmLabel={t('crews:endPlacement', 'End placement')} onCancel={() => setEnding(null)} onConfirm={() => void end()} />
    </Card>
  );
};

/** Crews → the crew master (FR-CRW-001/002) and the selected crew's people. */
export const CrewList: React.FC<{ creating: boolean; onCloseCreate: () => void; onCreate: () => void }> = ({ creating, onCloseCreate, onCreate }) => {
  const { t } = useTranslation('crews');
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const canManage = may('manage', 'crew', { record: { viewOnly: realRole !== effectiveRole } });
  const crews = useCrews();
  const users = useUsers();
  const { archiveCrew } = useCrewMutations();
  const [selected, setSelected] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<CrewRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const rows = crews.data ?? [];
  const selectedCrew = rows.find((c) => c.id === selected) ?? null;
  const controllerName = (id: string | null) => (id ? users.data?.find((u) => u.id === id)?.full_name ?? '—' : '—');
  const archive = async () => {
    const c = archiving;
    if (!c) return;
    setArchiving(null);
    setProblem(null);
    try {
      await archiveCrew.mutateAsync(c.id);
      if (selected === c.id) setSelected(null);
      toast(t('crews:archived', 'Crew archived'), undefined, 'success');
    } catch (err) { setProblem(crewErrorMessage(t, err)); }
  };
  const columns: Column<CrewRow>[] = [
    { key: 'code', header: t('crews:code', 'Code'), kind: 'primary', rowHeader: true, cell: (c) => <span className="record-id font-semibold text-foreground">{c.code}</span> },
    { key: 'name', header: t('crews:name', 'Name'), cell: (c) => c.name },
    { key: 'kind', header: t('crews:kind', 'Crew type'), cell: (c) => (c.kind === 'vendor' ? t('crews:kindVendor', 'Vendor crew') : t('crews:kindOwn', 'Own staff')) },
    { key: 'controller', header: t('crews:controller', 'Field controller'), cell: (c) => controllerName(c.field_controller_id) },
  ];
  return (
    <>
      {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
      {crews.isPending && <ListState variant="loading" shape="table" rows={4} />}
      {!crews.isPending && crews.isError && (
        <ListState variant="error" title={t('crews:error', "Couldn't load crews")} onRetry={() => void crews.refetch()} retryLabel={t('crews:retry', 'Retry')} />
      )}
      {!crews.isPending && !crews.isError && (
        <DataTable<CrewRow> rows={rows} columns={columns} rowKey={(c) => c.id} tableId="crews-table"
          onActivate={(c) => setSelected(c.id)}
          rowLabel={(c) => t('crews:rowLabel', 'Show the people in {{name}}', { name: c.name })}
          rowMenu={(c) => (canManage ? [{ label: t('crews:archive', 'Archive'), onClick: () => setArchiving(c) }] : [])}
          state={rows.length === 0 ? 'empty' : undefined}
          emptyTitle={t('crews:empty', 'No crews yet')}
          emptyAction={canManage ? { label: t('crews:new', 'New crew'), onClick: onCreate } : undefined}
          emptyActionVariant="outline" />
      )}
      {selectedCrew && <CrewMembersCard crew={selectedCrew} canManage={canManage} />}
      {creating && <NewCrewModal onClose={onCloseCreate} />}
      <ConfirmDialog open={archiving !== null} title={t('crews:archiveTitle', 'Archive this crew?')}
        description={t('crews:archiveBody', '{{name}} leaves the pickers. Its past roster and attendance stay.', { name: archiving?.name ?? '' })}
        confirmLabel={t('crews:archiveConfirm', 'Archive crew')} onCancel={() => setArchiving(null)} onConfirm={() => void archive()} />
    </>
  );
};
