import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead } from '@/src/components/ui';
import { useLeaveRequests } from '@/src/hooks/useLeave';
import { LeaveRequestList } from '../leave/LeaveRequestList';

/** "Leave requests awaiting you" on /approvals (#2708). Renders nothing while leave is off or nothing waits for the viewer. */
export const LeaveApprovalSection: React.FC = () => {
  const { t } = useTranslation('crews');
  const { data } = useLeaveRequests();
  const rows = (data ?? []).filter((r) => r.can_decide);
  if (rows.length === 0) return null;
  return (
    <section aria-label={t('crews:leave.sectionLabel', 'Leave requests awaiting you')} className="mb-4">
      <Card seam>
        <CardHead className="rounded-t-lg">{t('crews:leave.waiting', 'Waiting for your decision ({{count}})', { count: rows.length })}</CardHead>
        <LeaveRequestList rows={rows} />
      </Card>
    </section>
  );
};
