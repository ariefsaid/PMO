import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, GateNotice, ListPage, SelectField, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useLeaveSettings, useLeaveSettingsMutations, useLeaveTypes } from '@/src/hooks/useLeave';
import { leaveErrorMessage } from './leaveErrors';

/** Base roles an organisation can name as the leave approver today; a built-in role key can be added to this list later. */
const APPROVER_ROLES = ['Admin', 'Executive', 'Finance', 'Project Manager'] as const;

/** /leave?view=settings (#2708, Admin): switch the feature on, pick the approver role, and keep the leave type list. */
const LeaveSettingsPage: React.FC = () => {
  const { t } = useTranslation('crews');
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const isAdmin = may('manage', 'leaveRequest', { record: { viewOnly: realRole !== effectiveRole } });
  const settings = useLeaveSettings();
  const types = useLeaveTypes();
  const { save, createType, archiveType } = useLeaveSettingsMutations();
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data) { setRole(settings.data.approver_role ?? ''); }
  }, [settings.data]);
  if (!isAdmin) return <GateNotice variant="blocked">{t('crews:leave.adminOnly', 'Only an Admin can change leave settings')}</GateNotice>;
  const guard = async (fn: () => Promise<unknown>, done?: string) => {
    setProblem(null);
    try { await fn(); if (done) toast(done, undefined, 'success'); } catch (err) { setProblem(leaveErrorMessage(t, err)); }
  };
  return (
    <ListPage title={t('crews:leave.settings', 'Leave settings')}>
      <div className="max-w-2xl space-y-6">
        <p className="text-sm"><Link className="text-primary-text hover:underline" to="/leave">{t('crews:leave.backToLeave', 'Back to leave')}</Link></p>
        {problem && <p role="alert" className="text-sm text-destructive-text">{problem}</p>}
        <Card seam>
          <CardHead>{t('crews:leave.switchHeading', 'Leave requests')}</CardHead>
          <CardPad>
            <SelectField label={t('crews:leave.approverRole', 'Who approves')} value={role} onChange={setRole}
              helper={t('crews:leave.approverHelp', "The person's line manager can always decide. Empty means Admin.")}
              options={[{ value: '', label: t('crews:leave.approverDefault', 'Line manager, or Admin') }, ...APPROVER_ROLES.map((r) => ({ value: r, label: r }))]} />
            <div className="mt-4">
              <Button variant="primary" loading={save.isPending}
                onClick={() => void guard(() => save.mutateAsync({ enabled: true, approver_role: role || null }), t('crews:leave.saved', 'Settings saved'))}>
                {t('crews:leave.saveSettings', 'Save settings')}
              </Button>
            </div>
          </CardPad>
        </Card>
        <Card seam>
          <CardHead>{t('crews:leave.typesHeading', 'Leave types')}</CardHead>
          <CardPad>
            {(types.data ?? []).filter((x) => !x.archived_at).length === 0
              ? <p className="mb-3 text-sm text-muted-foreground">{t('crews:leave.noTypes', 'No leave types yet. Add the types your organisation uses.')}</p>
              : (
                <ul className="mb-3 divide-y divide-border">
                  {(types.data ?? []).filter((x) => !x.archived_at).map((x) => (
                    <li key={x.id} className="flex items-center justify-between py-2 text-sm">
                      <span>{x.name}</span>
                      <Button variant="ghost" size="sm" onClick={() => void guard(() => archiveType.mutateAsync(x.id))}>{t('crews:archive', 'Archive')}</Button>
                    </li>
                  ))}
                </ul>
              )}
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void guard(async () => { await createType.mutateAsync(name); setName(''); }); }}>
              <TextField label={t('crews:leave.typeName', 'New type')} value={name} onChange={setName} />
              <Button type="submit" variant="outline" disabled={!name.trim()}>{t('crews:leave.addType', 'Add type')}</Button>
            </form>
          </CardPad>
        </Card>
      </div>
    </ListPage>
  );
};

export default LeaveSettingsPage;
