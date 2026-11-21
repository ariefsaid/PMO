import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Switch, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useLeaveSettings, useLeaveSettingsMutations } from '@/src/hooks/useLeave';

/**
 * Administration › People: the org Admin's switch for leave and sick requests (#2708). Only the switch lives here, beside
 * the other org-level toggles; the approver role and the leave type list are on the Leave page. Nothing renders for
 * anyone who cannot manage the setting, so the screen is unchanged for them. UX only: `set_leave_settings` (1242) re-checks Admin.
 */
const LeaveRequestsSetting: React.FC = () => {
  const { t } = useTranslation('crews');
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const settings = useLeaveSettings();
  const { save } = useLeaveSettingsMutations();
  if (!may('manage', 'leaveRequest', { record: { viewOnly: realRole !== effectiveRole } }) || !settings.data) return null;
  const { enabled, approver_role } = settings.data;
  const label = t('crews:leave.switchLabel', 'People can request leave and report sickness');
  return (
    <section className="mt-4 rounded-lg border border-border bg-card px-4 py-3" aria-label={t('crews:leave.switchHeading', 'Leave requests')}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-control font-medium">{label}</span>
        <Switch checked={enabled} label={label} disabled={save.isPending}
          onChange={(next) => save.mutate({ enabled: next, approver_role }, {
            onError: (err) => { const c = classifyMutationError(err, {}); toast(c.headline, c.detail, 'warning'); },
          })} />
      </div>
      {enabled && (
        <p className="mt-2 text-control">
          <Link className="text-primary-text hover:underline" to="/leave?view=settings">{t('crews:leave.openSettings', 'Open leave settings')}</Link>
        </p>
      )}
    </section>
  );
};

export default LeaveRequestsSetting;
