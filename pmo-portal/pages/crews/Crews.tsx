import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListPage, Tabs, tabId, tabPanelId, useUrlFilters } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { CrewList } from './CrewList';
import { WorkOrderRoster } from './WorkOrderRoster';
import { AttendanceTick } from './AttendanceTick';
import { CrewImports } from './CrewImports';
import { CrewLoans } from './CrewLoans';
import { CheckInRequests } from './CheckInRequests';
import { CheckInSettings } from './CheckInSettings';
import { CrewTools } from './CrewTools';

type View = 'crews' | 'roster' | 'attendance' | 'tools';

/**
 * Crews (#2528): the crew master, the roster per work order and the daily attendance tick, as three views of one page.
 * The view lives in the address (`?view=`), so Back and a shared link return to it.
 */
const CrewsPage: React.FC = () => {
  const { t } = useTranslation('crews');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const canManage = may('manage', 'crew', { record: { viewOnly: realRole !== effectiveRole } });
  const { values, setFilter } = useUrlFilters(['view']);
  const view: View = values.view === 'roster' || values.view === 'attendance' || values.view === 'tools' ? values.view : 'crews';
  const [creating, setCreating] = useState(false);
  const tabs = [
    { value: 'crews' as View, label: t('crews:tabs.crews', 'Crews') },
    { value: 'roster' as View, label: t('crews:tabs.roster', 'Roster') },
    { value: 'attendance' as View, label: t('crews:tabs.attendance', 'Attendance') },
    { value: 'tools' as View, label: t('crews:tabs.tools', 'Tools') },
  ];
  return (
    <ListPage
      title={t('crews:title', 'Crews')}
      importAction={view === 'crews' ? <CrewImports /> : undefined}
      primaryAction={canManage
        ? <Button variant="primary" onClick={() => { setFilter('view', ''); setCreating(true); }}><Icon name="plus" />{t('crews:new', 'New crew')}</Button>
        : undefined}
    >
      <CheckInRequests />
      <Tabs items={tabs} value={view} onChange={(v) => setFilter('view', v === 'crews' ? '' : v)}
        ariaLabel={t('crews:tabsLabel', 'Crew views')} idBase="crews" className="mb-4" />
      <div id={tabPanelId('crews', view)} role="tabpanel" aria-labelledby={tabId('crews', view)}>
        {view === 'crews' && <CrewList creating={creating} onCreate={() => setCreating(true)} onCloseCreate={() => setCreating(false)} />}
        {view === 'crews' && <CrewLoans />}
        {view === 'roster' && <><WorkOrderRoster /><CheckInSettings /></>}
        {view === 'attendance' && <AttendanceTick />}
        {view === 'tools' && <CrewTools />}
      </div>
    </ListPage>
  );
};
export default CrewsPage;
