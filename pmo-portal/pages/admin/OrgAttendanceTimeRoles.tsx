import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { BUILT_IN_ROLES } from '@/src/auth/builtInRoles';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useAttendanceTimeRoles, useSaveAttendanceTimeRoles } from '@/src/hooks/useAttendanceSecondRecords';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { Button, Checkbox, FieldError, ListState, useToast } from '@/src/components/ui';

/**
 * Administration › People › Time records (pay-time, migration 1700). The organisation names which built-in roles may enter a second
 * record of a worker's day and which decide a disagreement (empty: today's approvers). Role names are the organisation's own. Anyone
 * who opens Administration reads it; only an Admin changes it (UX gate; `set_attendance_time_roles` is the authority, ADR-0016).
 */
const RoleGroup: React.FC<{ legend: string; helper: string; value: string[]; onChange: (next: string[]) => void; disabled: boolean }> = ({ legend, helper, value, onChange, disabled }) => {
  const roleName = useBuiltInRoleName();
  const helperId = useId();
  const toggle = (key: string, on: boolean) => onChange(on ? [...value, key] : value.filter((k) => k !== key));
  return (
    <fieldset className="min-w-0" aria-describedby={helperId}>
      <legend className="text-control font-medium text-foreground">{legend}</legend>
      <p id={helperId} className="mb-2 text-control text-muted-foreground">{helper}</p>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        {BUILT_IN_ROLES.map((r) => (
          <Checkbox key={r.key} label={roleName(r.key)} checked={value.includes(r.key)} disabled={disabled} onChange={(on) => toggle(r.key, on)} className="min-h-11">
            {roleName(r.key)}
          </Checkbox>
        ))}
      </div>
    </fieldset>
  );
};

export default function OrgAttendanceTimeRoles() {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const canManage = usePermission()('manage', 'orgAccounting');
  const query = useAttendanceTimeRoles();
  const save = useSaveAttendanceTimeRoles();
  const [second, setSecond] = useState<string[]>([]);
  const [decider, setDecider] = useState<string[]>([]);
  useEffect(() => {
    if (query.data) { setSecond(query.data.secondRecordRoles); setDecider(query.data.deciderRoles); }
  }, [query.data]);
  const dirty = !!query.data && (second.join() !== query.data.secondRecordRoles.join() || decider.join() !== query.data.deciderRoles.join());
  const saveError = save.isError ? classifyMutationError(save.error) : null;
  return (
    <section id="org-attendance-time-roles" tabIndex={-1} className="scroll-mt-4 mt-6" aria-labelledby="org-attendance-time-roles-heading">
      <h2 id="org-attendance-time-roles-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.attendanceRoles.title', 'Time records')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">{t('admin.attendanceRoles.intro', "Name who may enter a second record of a worker's day (a surveyor or timekeeper) and who decides which hours stand when two records differ. A second record never changes paid hours on its own.")}</p>
      <div className="mt-3 space-y-4">
        {query.isError ? <ListState variant="error" title={t('admin.attendanceRoles.loadError', "Couldn't load the time record roles")} onRetry={() => void query.refetch()} />
          : query.isPending ? <ListState variant="loading" rows={1} />
          : (
            <>
              <RoleGroup legend={t('admin.attendanceRoles.secondLabel', 'May enter a second record')} helper={t('admin.attendanceRoles.secondHelper', 'An Admin, Executive or Project Manager always may.')}
                value={second} onChange={setSecond} disabled={!canManage || save.isPending} />
              <RoleGroup legend={t('admin.attendanceRoles.deciderLabel', 'Decides which hours stand')} helper={t('admin.attendanceRoles.deciderHelper', "Leave empty to use today's approvers (Admin, Executive, Project Manager). Nobody decides hours they recorded.")}
                value={decider} onChange={setDecider} disabled={!canManage || save.isPending} />
              {canManage ? (
                <Button variant="primary" disabled={!dirty || save.isPending}
                  onClick={() => { save.reset(); save.mutate({ secondRecordRoles: second, deciderRoles: decider }, { onSuccess: () => toast(t('admin.attendanceRoles.saved', 'Time record roles saved'), 'success') }); }}>
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
