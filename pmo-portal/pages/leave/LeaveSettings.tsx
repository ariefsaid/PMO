import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, GateNotice, ListPage, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useLeaveSettingsMutations, useLeaveTypes } from '@/src/hooks/useLeave';
import { useLeaveErrorText } from '../crews/crewErrors';

/** /leave?view=settings (#2708, Admin): show the fixed decider route and keep the leave type list. */
const LeaveSettingsPage: React.FC = () => {
  const { t } = useTranslation('crews');
  const writeError = useLeaveErrorText();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const isAdmin = may('manage', 'leaveRequest', { record: { viewOnly: realRole !== effectiveRole } });
  const types = useLeaveTypes();
  const { createType, archiveType } = useLeaveSettingsMutations();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (!isAdmin) return <GateNotice variant="blocked">{t('crews:leave.adminOnly', 'Only an Admin can change leave settings')}</GateNotice>;
  const guard = async (fn: () => Promise<unknown>, done?: string) => {
    setProblem(null);
    try { await fn(); if (done) toast(done, undefined, 'success'); } catch (err) { setProblem(writeError(err)); }
  };
  return (
    <ListPage title={t('crews:leave.settings', 'Leave settings')}>
      <div className="max-w-2xl space-y-6">
        <p className="text-sm"><Link className="text-primary-text hover:underline" to="/leave">{t('crews:leave.backToLeave', 'Back to leave')}</Link></p>
        {problem && <p role="alert" className="text-sm text-destructive-text">{problem}</p>}
        <Card seam>
          <CardHead>{t('crews:leave.switchHeading', 'Leave requests')}</CardHead>
          <CardPad>
            <p className="text-sm text-muted-foreground">{t('crews:leave.approvalRouting', 'A pending request goes to the active manager on the person record. If missing or inactive, it goes to an HR Manager, then an Admin. The person on leave and the person who entered the request cannot decide it.')}</p>
          </CardPad>
        </Card>
        <Card seam>
          <CardHead>{t('crews:leave.typesHeading', 'Leave types')}</CardHead>
          <CardPad>
            {types.isError ? <ListState variant="error" title={t('common:readError')} onRetry={() => void types.refetch()} /> : (types.data ?? []).filter((x) => !x.archived_at).length === 0
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
              <Button type="submit" className="whitespace-nowrap" variant="outline" disabled={!name.trim()}>{t('crews:leave.addType', 'Add type')}</Button>
            </form>
          </CardPad>
        </Card>
      </div>
    </ListPage>
  );
};

export default LeaveSettingsPage;
