import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, Icon, ListPage, ListState } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useLeaveEnabled, useLeaveRequests, useLeaveSettings } from '@/src/hooks/useLeave';
import { LeaveRequestList } from './LeaveRequestList';
import { LeaveRequestForm } from './LeaveRequestForm';

/** /leave (#2708): my requests, and the requests waiting for my decision. Off until the organisation switches it on. */
const LeaveRequestsPage: React.FC = () => {
  const { t } = useTranslation('crews');
  const settings = useLeaveSettings();
  const enabled = useLeaveEnabled();
  const requests = useLeaveRequests();
  const isAdmin = useAuth().currentUser?.role === 'Admin';
  const [creating, setCreating] = useState(false);
  const rows = requests.data ?? [];
  const waiting = rows.filter((r) => r.can_decide);
  const mine = rows.filter((r) => !r.can_decide);
  return (
    <ListPage title={t('crews:leave.title', 'Leave')}
      primaryAction={enabled ? <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" />{t('crews:leave.request', 'Request leave')}</Button> : undefined}>
      {settings.isPending && <ListState variant="loading" rows={3} />}
      {!settings.isPending && !enabled && (
        <p className="text-sm text-muted-foreground">
          {t('crews:leave.off', 'Leave requests are not switched on for your organisation.')}{' '}
          {isAdmin && <Link className="text-primary-text hover:underline" to="/leave/settings">{t('crews:leave.openSettings', 'Open leave settings')}</Link>}
        </p>
      )}
      {enabled && requests.isError && (
        <ListState variant="error" title={t('crews:leave.loadError', "Couldn't load leave requests")} onRetry={() => void requests.refetch()} retryLabel={t('crews:retry', 'Retry')} />
      )}
      {enabled && !requests.isPending && !requests.isError && (
        <div className="space-y-6">
          {waiting.length > 0 && (
            <Card seam>
              <CardHead>{t('crews:leave.waiting', 'Waiting for your decision ({{count}})', { count: waiting.length })}</CardHead>
              <LeaveRequestList rows={waiting} />
            </Card>
          )}
          <Card seam>
            <CardHead actions={isAdmin ? <Link className="text-sm text-primary-text hover:underline" to="/leave/settings">{t('crews:leave.settings', 'Leave settings')}</Link> : undefined}>
              {t('crews:leave.mine', 'Requests')}
            </CardHead>
            {mine.length === 0
              ? <p className="px-4 py-6 text-sm text-muted-foreground">{t('crews:leave.none', 'No leave requests yet.')}</p>
              : <LeaveRequestList rows={mine} />}
          </Card>
        </div>
      )}
      {creating && <LeaveRequestForm onClose={() => setCreating(false)} />}
    </ListPage>
  );
};

export default LeaveRequestsPage;
