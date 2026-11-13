import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Combobox,
  ConfirmDialog,
  EntityFormModal,
  FormGrid,
  FormSection,
  ListState,
  SelectField,
  useEntityForm,
  useToast,
  type ComboboxOption,
  type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { can } from '@/src/auth/policy';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { repositories } from '@/src/lib/repositories';
import { useProjectOptions } from '@/src/hooks/useFkOptions';
import type { ProfileRow } from '@/src/lib/db/profiles';
import type { SpendApproverRow } from '@/src/lib/db/spendApprovers';

/**
 * Administration › Spend approvers (#803, migration 0242, ADR-0075). Spend charged to a project and
 * within its budget line goes to that project's approver; overhead and over-line spend goes to the
 * overhead set. Any one listed approver decides (DD-APR-1). Admin-only writes, gated on
 * can('manage','orgAccounting') — UX only; the spend_approvers RLS is the authority (ADR-0016).
 */
const SpendApprovers: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState<'org' | 'project' | null>(null);
  const [removing, setRemoving] = useState<SpendApproverRow | null>(null);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const listKey = ['spend-approvers', orgId] as const;
  const { data, isPending, isError, refetch } = useQuery<SpendApproverRow[]>({
    queryKey: listKey,
    queryFn: () => repositories.orgSettings.listSpendApprovers(),
    enabled: Boolean(orgId),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: listKey });
  const addMutation = useMutation({
    mutationFn: (v: { profileId: string; projectId: string | null }) =>
      repositories.orgSettings.addSpendApprover(v.profileId, v.projectId),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => repositories.orgSettings.removeSpendApprover(id),
    onSuccess: invalidate,
  });

  // Who the standard role rules reach: same predicate that offers the Approve button (ADR-0070).
  // Shares the Add modal's query key, so opening the modal does not refetch.
  const { data: people, isError: peopleError, refetch: peopleRefetch } = useQuery({
    queryKey: ['spend-approver-people', orgId],
    queryFn: () => repositories.profile.listOrgProfiles(),
    enabled: Boolean(orgId),
  });
  const eligible = useMemo(
    () =>
      (people ?? []).filter((p) => p.status === 'active' && can('transition', 'procurement', { realRole: p.role as never })),
    [people],
  );

  const orgRows = useMemo(() => (data ?? []).filter((r) => r.projectId === null), [data]);
  const projectRows = useMemo(() => (data ?? []).filter((r) => r.projectId !== null), [data]);
  const projectGroups = useMemo(() => {
    const groups = new Map<string, SpendApproverRow[]>();
    for (const row of projectRows) {
      const id = row.projectId!;
      groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    return [...groups.entries()];
  }, [projectRows]);

  const onRemoveConfirm = async () => {
    if (!removing) return;
    try {
      await removeMutation.mutateAsync(removing.id);
      toast(t('admin.spendApprovers.toast.removed', 'Approver removed'), removing.fullName, 'success');
      setRemoving(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const names = eligible.map((p) => p.full_name).join(', ');
  const eligibleIds = new Set(eligible.map((p) => p.id));
  // Eligibility-derived notes wait for the people list; when it fails they stay silent
  // rather than claim something the screen cannot verify.
  const peopleReady = Boolean(people) && !peopleError;
  // Which people hold those roles — only claimed once the list has loaded.
  const holders = peopleError
    ? t('uxs32.holdersUnavailable', "Couldn't check who holds these roles right now.")
    : people
      ? names || t('uxs32.holdersNone', 'Nobody active holds these roles right now.')
      : '';

  const flatRouteNote = (scope: 'org' | 'project') => holders ? (
    <p data-testid={`spend-route-${scope}`} className="mt-2 max-w-[68ch] text-control text-muted-foreground">
      <span className="font-medium text-foreground">{t('administration:admin.spendApprovers.whoNow', 'Who can approve now')}</span>
      {': '}{holders}
    </p>
  ) : null;
  const adminRouteNote = (scope: 'org' | 'project') => (
    <p data-testid={`spend-route-${scope}`} role="status" className="mt-2 max-w-[68ch] text-control text-warning-foreground">
      {t('uxs32.noEligible', 'Nobody listed can approve right now. Only an Admin can decide.')}
    </p>
  );

  /**
   * The resolved route under each list (UX-081), mirroring spend_approval_route (migration 0243):
   * an empty list falls to the flat OD-PROC-1 role rules (FR-APR-013/015); a project list nobody
   * on it can act on escalates to the senior set (FR-APR-014); a senior set nobody can act on
   * leaves the decision to an Admin (DD-APR-4). SoD-a stays: nobody decides their own request.
   * The budget sole-operator exception is not generalized here.
   */
  const renderRoute = (rows: SpendApproverRow[], scope: 'org' | 'project') => {
    if (rows.length === 0) {
      if (scope === 'org') return flatRouteNote(scope);
      // Both lists empty: the standard rules were already said once, under the overhead list.
      if (orgRows.length === 0) return null;
      if (peopleReady && !orgRows.some((r) => eligibleIds.has(r.profileId))) return adminRouteNote(scope);
      return flatRouteNote('project');
    }
    if (peopleError) {
      return (
        <p data-testid={`spend-route-${scope}`} role="status" className="mt-2 max-w-[68ch] text-control text-muted-foreground">
          {t('uxs32.routeUnavailable', "Couldn't verify who can approve right now.")}
        </p>
      );
    }
    if (!peopleReady || rows.some((r) => eligibleIds.has(r.profileId))) return null;
    const senior: 'org' | 'admin' | 'flat' = orgRows.some((r) => eligibleIds.has(r.profileId))
      ? 'org'
      : orgRows.length > 0
        ? 'admin'
        : 'flat';
    if (senior === 'org') {
      return (
        <p data-testid={`spend-route-${scope}`} role="status" className="mt-2 max-w-[68ch] text-control text-warning-foreground">
          {t('uxs32.escalate', 'Nobody listed can approve right now. The overhead approvers decide.')}
        </p>
      );
    }
    return senior === 'admin' ? adminRouteNote(scope) : flatRouteNote(scope);
  };

  const renderRows = (rows: SpendApproverRow[], scope: 'org' | 'project') =>
    rows.length === 0 ? (
      <>
        <p className="text-control text-muted-foreground">
          {t('admin.spendApprovers.empty', 'Nobody listed.')}
        </p>
        {renderRoute(rows, scope)}
      </>
    ) : (
      <>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-control">
              <span className="min-w-0">
                <span className="font-medium">{r.fullName}</span>
                {scope === 'org' && r.projectName && <span className="ml-2 text-muted-foreground">{r.projectName}</span>}
              </span>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}>
                  {t('admin.spendApprovers.remove', { defaultValue: 'Remove {{name}}', name: r.fullName })}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {renderRoute(rows, scope)}
      </>
    );

  const openAdd = (mode: 'org' | 'project') => {
    setSaveError(null);
    setAdding(mode);
  };

  return (
    <section id="spend-approvers" tabIndex={-1} className="scroll-mt-4" aria-label={t('admin.spendApprovers.title', 'Spend approvers')}>
      <h2 className="text-group font-semibold tracking-[-0.01em]">
        {t('admin.spendApprovers.title', 'Spend approvers')}
      </h2>
      {isError ? (
        <ListState
          variant="error"
          title={t('admin.spendApprovers.loadError.title', "Couldn't load spend approvers")}
          sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
          retryLabel={t('admin.retry', 'Retry')}
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <ListState variant="loading" rows={2} testId="spend-approvers-loading" />
      ) : (
        <div className="mt-3 space-y-4">
          {/* C1: the people read is a SECOND read — when it fails the approver lists below stay
              readable, so the failure is said once here, beside them, with a retry of its own
              instead of sending the reader to reload the page. */}
          {peopleError && (
            <ListState
              variant="error"
              title={t('uxs32.peopleLoadError', "Couldn't read the people this screen checks")}
              sub={t('uxs32.peopleLoadErrorSub', 'Who can approve now could not be verified. The approver lists below are unaffected.')}
              retryLabel={t('admin.retry', 'Retry')}
              onRetry={() => void peopleRefetch()}
            />
          )}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-control font-semibold">
                {t('admin.spendApprovers.orgSet.title', 'Overhead and over-budget approvers')}
              </h3>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => openAdd('org')}>
                  {t('admin.spendApprovers.addOrg', 'Add overhead approver')}
                </Button>
              )}
            </div>
            {renderRows(orgRows, 'org')}
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-control font-semibold">
                {t('admin.spendApprovers.projectSet.title', 'Project approvers')}
              </h3>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => openAdd('project')}>
                  {t('admin.spendApprovers.addProject', 'Add project approver')}
                </Button>
              )}
            </div>
            {projectGroups.length === 0 ? renderRows([], 'project') : (
              <div className="space-y-4">
                {projectGroups.map(([id, rows]) => {
                  const name = rows[0].projectName ?? id;
                  return <div key={id} role="group" aria-label={name}>
                    <h4 className="mb-2 text-control font-medium">{name}</h4>
                    {renderRows(rows, 'project')}
                  </div>;
                })}
              </div>
            )}
          </div>
          {!canManage && (
            <p className="text-control text-muted-foreground">
              {t('admin.spendApprovers.adminOnly', 'Only an Admin can change this.')}
            </p>
          )}
        </div>
      )}

      {adding && (
        <AddApproverModal
          mode={adding}
          eligible={eligible}
          submitError={saveError}
          onClose={() => setAdding(null)}
          onSubmit={async (profileId, projectId) => {
            try {
              await addMutation.mutateAsync({ profileId, projectId });
              toast(t('admin.spendApprovers.toast.added', 'Approver added'), '', 'success');
              setAdding(null);
            } catch (err) {
              const { headline, detail } = classifyMutationError(err);
              setSaveError({ headline, detail });
              toast(headline, detail, 'warning');
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!removing}
        tone="destructive"
        title={
          removing
            ? t('admin.spendApprovers.confirm.title', { defaultValue: 'Remove {{name}}?', name: removing.fullName })
            : ''
        }
        description={t(
          'admin.spendApprovers.confirm.description',
          'They will no longer approve procurement cases. Cases already decided are unchanged.',
        )}
        confirmLabel={t('admin.spendApprovers.confirm.confirm', 'Remove')}
        loading={removeMutation.isPending}
        onConfirm={onRemoveConfirm}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
};

interface AddValues {
  profileId: string;
  projectId: string | null;
}

interface AddApproverModalProps {
  mode: 'org' | 'project';
  /** OE04-005: the parent's already-computed eligible profiles — the same list its route
   * notes explain, so the picker can never disagree with the explanation. */
  eligible: ProfileRow[];
  /** #559: owned by the parent (which owns the mutation), rendered here. */
  submitError: SubmitError | null;
  onClose: () => void;
  onSubmit: (profileId: string, projectId: string | null) => Promise<void>;
}

const AddApproverModal: React.FC<AddApproverModalProps> = ({ mode, eligible, submitError, onClose, onSubmit }) => {
  const { t } = useTranslation();
  // UX mirror of the RLS rank floor (ADR-0070), mapped from the parent's eligibility — the
  // modal does not re-query or re-filter (OE04-005).
  const personOptions = useMemo(
    () => eligible.map((p) => ({ value: p.id, label: p.full_name })),
    [eligible],
  );
  const { data: projectOptions } = useProjectOptions();
  const loadProjects = useCallback(
    async (): Promise<ComboboxOption[]> => projectOptions ?? [],
    [projectOptions],
  );

  const form = useEntityForm<AddValues>({
    initialValues: { profileId: '', projectId: null },
    validate: (v) => {
      const errors: Partial<Record<keyof AddValues, string>> = {};
      if (!v.profileId) errors.profileId = t('admin.spendApprovers.form.personRequired', 'Choose a person.');
      if (mode === 'project' && !v.projectId) {
        errors.projectId = t('admin.spendApprovers.form.projectRequired', 'Choose a project.');
      }
      return errors;
    },
    idPrefix: 'spend-approver-form',
    requiredFields: mode === 'project' ? ['profileId', 'projectId'] : ['profileId'],
    module: 'spend-approvers',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      await onSubmit(v.profileId, mode === 'project' ? v.projectId : null);
    });
  };

  return (
    <EntityFormModal
      open
      title={
        mode === 'project'
          ? t('admin.spendApprovers.form.projectTitle', 'Add a project approver')
          : t('admin.spendApprovers.form.orgTitle', 'Add an overhead approver')
      }
      submitLabel={t('admin.spendApprovers.form.save', 'Add')}
      onSubmit={handleSubmit}
      submitError={submitError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
    >
      <FormSection legend={t('admin.spendApprovers.form.legend', 'Approver')}>
        <FormGrid>
          {mode === 'project' && (
            <Combobox
              label={t('admin.spendApprovers.form.project', 'Project')}
              noun="project"
              placeholder={t('admin.spendApprovers.form.projectPlaceholder', 'Select a project…')}
              value={form.values.projectId}
              onChange={(v) => form.setValue('projectId', v)}
              loadOptions={loadProjects}
            />
          )}
          <SelectField
            id="spend-approver-person"
            label={t('admin.spendApprovers.form.person', 'Person')}
            value={form.values.profileId}
            onChange={(v) => form.setValue('profileId', v)}
            options={personOptions}
            placeholder={t('admin.spendApprovers.form.personPlaceholder', 'Select a person…')}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default SpendApprovers;
