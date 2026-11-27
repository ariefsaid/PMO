import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { BUILT_IN_ROLES } from '@/src/auth/builtInRoles';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useAttendanceTimeRoles, useSaveAttendanceTimeRoles } from '@/src/hooks/useAttendanceSecondRecords';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { Button, FieldError, ListState, useToast } from '@/src/components/ui';
import { useRemoteStringDraft } from '@/src/hooks/useRemoteStringDraft';
import { RoleChecklist } from '@/src/components/admin/RoleChecklist';

/**
 * Administration › People › Time records (pay-time, migration 1700). The organisation names which built-in roles may enter a second
 * record of a worker's day and which decide a disagreement (empty: today's approvers). Role names are the organisation's own. Anyone
 * who opens Administration reads it; only an Admin changes it (UX gate; `set_attendance_time_roles` is the authority, ADR-0016).
 */
const RoleGroup: React.FC<{ legend: string; helper: string; value: string[]; onChange: (next: string[]) => void; disabled: boolean }> = ({ legend, helper, value, onChange, disabled }) => {
  const roleName = useBuiltInRoleName();
  return (
    <RoleChecklist legend={legend} helper={helper} options={BUILT_IN_ROLES.map((r) => ({ key: r.key, name: roleName(r.key) }))}
      value={value} onChange={onChange} disabled={disabled} />
  );
};

function sameRoles(a: string[], b: string[]) {
  return a.length === b.length && a.every((role) => b.includes(role));
}

export default function OrgAttendanceTimeRoles() {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const canManage = usePermission()('manage', 'orgAccounting');
  const query = useAttendanceTimeRoles();
  const save = useSaveAttendanceTimeRoles();
  const remoteDraft = useRemoteStringDraft({ remote: JSON.stringify(query.data ?? { secondRecordRoles: [], deciderRoles: [] }), isSuccess: query.isSuccess });
  const roles: { secondRecordRoles: string[]; deciderRoles: string[] } = remoteDraft.draft ? JSON.parse(remoteDraft.draft) : { secondRecordRoles: [], deciderRoles: [] };
  const second = roles.secondRecordRoles;
  const decider = roles.deciderRoles;
  const setSecond = (value: string[]) => remoteDraft.setDraft(JSON.stringify({ ...roles, secondRecordRoles: value }));
  const setDecider = (value: string[]) => remoteDraft.setDraft(JSON.stringify({ ...roles, deciderRoles: value }));
  const dirty = !!query.data && (!sameRoles(second, query.data.secondRecordRoles) || !sameRoles(decider, query.data.deciderRoles));
  const saveError = save.isError ? classifyMutationError(save.error) : null;
  return (
    <section id="org-attendance-time-roles" tabIndex={-1} className="scroll-mt-4" aria-labelledby="org-attendance-time-roles-heading">
      <h2 id="org-attendance-time-roles-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.attendanceRoles.title', 'Time records')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">{t('admin.attendanceRoles.intro', "Name who may enter a second record of a worker's day (a surveyor or timekeeper) and who decides which hours stand when two records differ. A second record never changes paid hours on its own.")}</p>
      <div className="mt-3 space-y-4">
        {query.isError ? <ListState variant="error" title={t('admin.attendanceRoles.loadError', "Couldn't load the time record roles")} onRetry={() => void query.refetch()} />
          : query.isPending ? <ListState variant="loading" rows={1} />
          : (
            <>
              {remoteDraft.remoteChanged && <div role="status"><p>{t('common:uxs11.downPaymentRemoteChanged', 'The saved item changed. Your edit is kept; reload the saved value to discard it.')}</p><Button variant="outline" size="sm" onClick={remoteDraft.reload}>{t('common:uxs11.reloadSaved', 'Reload saved values')}</Button></div>}
              <RoleGroup legend={t('admin.attendanceRoles.secondLabel', 'May enter a second record')} helper={t('admin.attendanceRoles.secondHelper', 'An Admin, Executive or Project Manager always may.')}
                value={second} onChange={setSecond} disabled={!canManage || save.isPending} />
              <RoleGroup legend={t('admin.attendanceRoles.deciderLabel', 'Decides which hours stand')} helper={t('admin.attendanceRoles.deciderHelper', "Leave empty to use today's approvers (Admin, Executive, Project Manager). Nobody decides hours they recorded.")}
                value={decider} onChange={setDecider} disabled={!canManage || save.isPending} />
              {canManage ? (
                <Button variant="primary" disabled={!dirty || save.isPending}
                  onClick={() => { save.reset(); save.mutate({ secondRecordRoles: second, deciderRoles: decider }, { onSuccess: () => { remoteDraft.acceptSaved(JSON.stringify(roles)); toast(t('admin.attendanceRoles.saved', 'Time record roles saved'), 'success'); } }); }}>
                  {t('admin.attendanceRoles.save', 'Save')}
                </Button>
              ) : <p className="text-control text-muted-foreground">{t('admin.attendanceRoles.adminOnly', 'Only an Admin can change this.')}</p>}
            </>
          )}
        {saveError && <FieldError>{saveError.detail || saveError.headline}</FieldError>}
      </div>
    </section>
  );
}
