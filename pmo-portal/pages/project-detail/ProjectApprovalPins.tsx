/**
 * #2598: which person decides each material-request approval step on this project. A step with no pin stays
 * role-level (anyone with the role). The Admin or the project's own manager sets the pin; the server decides
 * (`mrq_set_step_pin`: active member who holds the step's role), the controls here are only the UX.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListState, SelectField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useUsers } from '@/src/hooks/useUsers';
import { useApprovalChain, useMaterialRequestMutations, useStepPins } from '@/src/hooks/useMaterialRequests';
import { useLabels, useRefusalText } from '../materialRequests/useMaterialRequestText';
import { holdsJobRole } from '@/src/auth/builtInRoles';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import type { UserRow } from '@/src/lib/db/adminUsers';
import type { Role } from '@/src/auth/AuthContext';

/** Who can decide a step: its built-in role through the same rule as the database (holds_job_role), else its access level. */
const fillsStep = (u: UserRow, role: Role, jobRole: string | null): boolean =>
  u.status === 'active' && (jobRole ? holdsJobRole({ role: u.role, builtInRoleKey: u.built_in_role ?? null }, jobRole) : u.role === role);

export function ProjectApprovalPins({ projectId, managerId }: { projectId: string; managerId: string | null }) {
  const { t } = useTranslation('project');
  const { toast } = useToast();
  const refusal = useRefusalText();
  const labels = useLabels();
  const roleName = useBuiltInRoleName();
  const chain = useApprovalChain();
  const pins = useStepPins(projectId);
  const users = useUsers();
  const m = useMaterialRequestMutations();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser;
  const canManage = usePermission()('manage', 'approvalStepPin', { currentUserId: me?.id ?? null, record: { project_manager_id: managerId, viewOnly: realRole !== effectiveRole } });
  const [pending, setPending] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const title = <h4 className="text-sm font-medium text-muted-foreground">{t('projectDetail.approvalPins.title', 'Approver by step')}</h4>;
  if (chain.isPending || pins.isPending) return <div>{title}<ListState variant="loading" rows={1} /></div>;
  if (chain.isError || pins.isError) {
    return <div>{title}<ListState variant="error" title={t('projectDetail.approvalPins.loadFailed', 'Approval steps could not be loaded')} onRetry={() => { void chain.refetch(); void pins.refetch(); }} retryLabel={t('projectDetail.approvalPins.retry', 'Retry')} /></div>;
  }
  const steps = chain.data ?? [];
  // Nothing to pin until the Admin has set a chain. Everyone else sees the pins read-only.
  if (steps.length === 0) return null;
  const pinFor = (position: number, role: string, jobRole: string | null) =>
    pins.data?.find((p) => p.position === position && p.role === role && (p.jobRole ?? null) === jobRole)?.approverId ?? '';
  // #2605: a pin whose person is gone, deactivated or no longer fills the step no longer binds the step.
  const isStuck = (approverId: string, role: Role, jobRole: string | null) => { const u = users.data?.find((x) => x.id === approverId); return !u || !fillsStep(u, role, jobRole); };
  const nameOf = (id: string) => users.data?.find((u) => u.id === id)?.full_name ?? '—';

  const save = async (position: number, approverId: string) => {
    setError(null);
    try {
      await m.setStepPin.mutateAsync({ projectId, position, approverId: approverId || null });
      setPending(({ [position]: _drop, ...rest }) => rest);
      toast(approverId ? t('projectDetail.approvalPins.saved', 'Pin saved') : t('projectDetail.approvalPins.cleared', 'Pin removed'), undefined, 'success');
    } catch (err) { setError(refusal(err)); }
  };

  return (
    <div className="space-y-2" data-testid="project-approval-pins">
      {title}
      <p className="text-sm text-muted-foreground">{t('projectDetail.approvalPins.intro', "Pin a step to one person on this project. With no pin, anyone with the step's role can decide it.")}</p>
      <ul className="space-y-2">
        {steps.map((s) => {
          const jobRole = s.jobRole ?? null;
          const saved = pinFor(s.position, s.role, jobRole);
          const value = pending[s.position] ?? saved;
          const role = jobRole ? roleName(jobRole) : labels.role[s.role] ?? s.role;
          const stuck = saved !== '' && isStuck(saved, s.role, jobRole);
          const stuckNote = stuck && (
            <p role="status" className="text-sm text-warning-foreground">
              {t('projectDetail.approvalPins.stuck', '{{name}} can no longer decide this step. Anyone with the role can until you choose someone else.', { name: nameOf(saved) })}
            </p>
          );
          const stepName = t('projectDetail.approvalPins.step', 'Step {{n}}: {{label}}', { n: s.position, label: s.label });
          return (
            <li key={s.id} className="space-y-1.5">
              {canManage ? (
                <>
                  <SelectField label={stepName} value={value} fullWidth onChange={(v) => setPending((p) => ({ ...p, [s.position]: v }))}
                    options={[{ value: '', label: t('projectDetail.approvalPins.anyone', 'Anyone with the role') },
                      ...(users.data ?? []).filter((u) => fillsStep(u, s.role, jobRole) || u.id === saved).map((u) => ({ value: u.id, label: u.full_name }))]} />
                  {stuckNote}
                  {value !== saved && <Button size="sm" variant="outline" loading={m.setStepPin.isPending} onClick={() => void save(s.position, value)}>{t('projectDetail.approvalPins.save', 'Save')}</Button>}
                </>
              ) : (
                <p className="text-sm text-foreground">
                  <span className="text-muted-foreground">{stepName}: </span>
                  {saved ? t('projectDetail.approvalPins.pinnedTo', 'Pinned to {{name}}', { name: nameOf(saved) }) : t('projectDetail.approvalPins.unpinned', 'Any {{role}}', { role })}
                </p>
              )}
              {!canManage && stuckNote}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
