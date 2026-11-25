import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useMyDeliveries, useMyHome, useMyTaskStatus } from '@/src/hooks/useMyHome';
import { AbsentTodaySection, ClockInSection, DeliveriesSection, MyIssues, MyNotices, MyTasks, MyWorkOrders } from '@/src/components/my';
import { CrewRoster } from './myHome/CrewRoster';

/**
 * The light account's one phone home screen (#2710, OD-SCOPE-4): my tasks, clock in, deliveries to confirm, issues I reported,
 * and for a Foreman the crew's attendance. One column, no project page, work-order page, list, dashboard, price or budget.
 * Every read is the person's own, and the database enforces it (restrictive RLS + `my_home()`).
 */
const MyHome: React.FC = () => {
  const { t } = useTranslation('myHome');
  const { currentUser } = useAuth();
  const home = useMyHome();
  const deliveries = useMyDeliveries();
  const status = useMyTaskStatus();
  const isForeman = currentUser?.built_in_role === 'foreman';

  return (
    <main className="mx-auto w-full max-w-xl space-y-4 p-4" aria-label={t('myHome:title', 'My work')}>
      <h1 className="text-page font-semibold tracking-[-0.01em]">{t('myHome:title', 'My work')}</h1>
      {home.isPending ? <ListState variant="loading" rows={4} />
        : home.isError ? <ListState variant="error" title={t('myHome:error', "Couldn't load your work")} onRetry={() => void home.refetch()} />
        : (
          <>
            <MyTasks tasks={home.data.tasks} busyId={status.isPending ? (status.variables?.id ?? null) : null}
              onSetStatus={(id, s) => status.mutate({ id, status: s })} />
            <MyWorkOrders workOrders={home.data.work_orders} />
            <ClockInSection today={home.data.today} workOrders={home.data.work_orders} deciderRole={home.data.decider_role} />
            <AbsentTodaySection today={home.data.today} workOrders={home.data.work_orders} />
            {isForeman && <CrewRoster today={home.data.today} workOrders={home.data.work_orders} />}
            <DeliveriesSection deliveries={deliveries.data ?? []} />
            <MyIssues issues={home.data.issues} />
            <MyNotices />
          </>
        )}
    </main>
  );
};

export default MyHome;
