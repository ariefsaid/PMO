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

  const orgRows = useMemo(() => (data ?? []).filter((r) => r.projectId === null), [data]);
  const projectRows = useMemo(() => (data ?? []).filter((r) => r.projectId !== null), [data]);

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

  const renderRows = (rows: SpendApproverRow[]) =>
    rows.length === 0 ? (
      <p className="text-[13px] text-muted-foreground">
        {t('admin.spendApprovers.empty', 'Nobody listed — the standard role rules apply.')}
      </p>
    ) : (
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13.5px]">
            <span className="min-w-0">
              <span className="font-medium">{r.fullName}</span>
              {r.projectName && <span className="ml-2 text-muted-foreground">{r.projectName}</span>}
            </span>
            {canManage && (
              <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}>
                {t('admin.spendApprovers.remove', { defaultValue: 'Remove {{name}}', name: r.fullName })}
              </Button>
            )}
          </li>
        ))}
      </ul>
    );

  const openAdd = (mode: 'org' | 'project') => {
    setSaveError(null);
    setAdding(mode);
  };

  return (
    <section id="spend-approvers" aria-label={t('admin.spendApprovers.title', 'Spend approvers')}>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
        {t('admin.spendApprovers.title', 'Spend approvers')}
      </h2>
      <p className="mt-1 max-w-[68ch] text-[13px] text-muted-foreground">
        {t(
          'admin.spendApprovers.description',
          "Who approves purchase requests. Spend charged to a project and within its budget line goes to that project's approver; overhead, and spend that would exceed the budget line, goes to the overhead approvers. Any one listed approver can approve. With nobody listed, the standard role rules apply.",
        )}
      </p>
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
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold">
                {t('admin.spendApprovers.orgSet.title', 'Overhead and over-budget approvers')}
              </h3>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => openAdd('org')}>
                  {t('admin.spendApprovers.addOrg', 'Add overhead approver')}
                </Button>
              )}
            </div>
            {renderRows(orgRows)}
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold">
                {t('admin.spendApprovers.projectSet.title', 'Project approvers')}
              </h3>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => openAdd('project')}>
                  {t('admin.spendApprovers.addProject', 'Add project approver')}
                </Button>
              )}
            </div>
            {renderRows(projectRows)}
          </div>
          {!canManage && (
            <p className="text-[13px] text-muted-foreground">
              {t('admin.spendApprovers.adminOnly', 'Only an Admin can change this.')}
            </p>
          )}
        </div>
      )}

      {adding && (
        <AddApproverModal
          mode={adding}
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
          'They will no longer approve these requests. Requests already decided are unchanged.',
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
  /** #559: owned by the parent (which owns the mutation), rendered here. */
  submitError: SubmitError | null;
  onClose: () => void;
  onSubmit: (profileId: string, projectId: string | null) => Promise<void>;
}

const AddApproverModal: React.FC<AddApproverModalProps> = ({ mode, submitError, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const { data: people } = useQuery({
    queryKey: ['spend-approver-people', orgId],
    queryFn: () => repositories.profile.listOrgProfiles(),
    enabled: Boolean(orgId),
  });
  // UX mirror of the RLS rank floor (ADR-0070): the same predicate that offers the Approve button.
  const personOptions = useMemo(
    () =>
      (people ?? [])
        .filter((p) => p.status === 'active' && can('transition', 'procurement', { realRole: p.role as never }))
        .map((p) => ({ value: p.id, label: p.full_name })),
    [people],
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
      subtitle={t('admin.spendApprovers.form.subtitle', 'Any one listed approver can approve a request.')}
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
