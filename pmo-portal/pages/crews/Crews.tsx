import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListPage, Tabs, tabId, tabPanelId, useUrlFilters } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAttendanceTarget } from '@/src/hooks/useAttendanceRate';
import { CrewList } from './CrewList';
import { WorkOrderRoster } from './WorkOrderRoster';
import { AttendanceTick } from './AttendanceTick';
import { CrewImports } from './CrewImports';
import AttendanceRate from './AttendanceRate';

type View = 'crews' | 'roster' | 'attendance' | 'rate';

/**
 * Crews (#2528): the crew master, the roster per work order and the daily attendance tick, as three views of one page.
 * #2706 adds a fourth — the attendance rate against the organisation's target — offered only once a target is set, so
 * an organisation that never sets one sees the page exactly as before.
 * The view lives in the address (`?view=`), so Back and a shared link return to it.
 */
const CrewsPage: React.FC = () => {
  const { t } = useTranslation('crews');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const canManage = may('manage', 'crew', { record: { viewOnly: realRole !== effectiveRole } });
  const maySeeRate = may('view', 'attendanceRate');
  const target = useAttendanceTarget();
  const rateOffered = maySeeRate && target.data !== null && target.data !== undefined;
  const { values, setFilter } = useUrlFilters(['view']);
  const view: View = values.view === 'roster' || values.view === 'attendance' || (values.view === 'rate' && rateOffered)
    ? values.view as View
    : 'crews';
  const [creating, setCreating] = useState(false);
  const tabs = [
    { value: 'crews' as View, label: t('crews:tabs.crews', 'Crews') },
    { value: 'roster' as View, label: t('crews:tabs.roster', 'Roster') },
    { value: 'attendance' as View, label: t('crews:tabs.attendance', 'Attendance') },
    ...(rateOffered ? [{ value: 'rate' as View, label: t('crews:tabs.rate', 'Rate') }] : []),
  ];
  return (
    <ListPage
      title={t('crews:title', 'Crews')}
      importAction={view === 'crews' ? <CrewImports /> : undefined}
      primaryAction={canManage
        ? <Button variant="primary" onClick={() => { setFilter('view', ''); setCreating(true); }}><Icon name="plus" />{t('crews:new', 'New crew')}</Button>
        : undefined}
    >
      <Tabs items={tabs} value={view} onChange={(v) => setFilter('view', v === 'crews' ? '' : v)}
        ariaLabel={t('crews:tabsLabel', 'Crew views')} idBase="crews" className="mb-4" />
      <div id={tabPanelId('crews', view)} role="tabpanel" aria-labelledby={tabId('crews', view)}>
        {view === 'crews' && <CrewList creating={creating} onCreate={() => setCreating(true)} onCloseCreate={() => setCreating(false)} />}
        {view === 'roster' && <WorkOrderRoster />}
        {view === 'attendance' && <AttendanceTick />}
        {view === 'rate' && <AttendanceRate />}
      </div>
    </ListPage>
  );
};
export default CrewsPage;
