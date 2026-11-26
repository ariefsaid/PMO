import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui';
import { useAttendanceDay, useWorkOrderRoster } from '@/src/hooks/useCrews';
import { TickForm } from '@/pages/crews/AttendanceTick';
import type { MyHomeWorkOrder } from '@/src/lib/repositories/myHome';
import { MySection } from '@/src/components/my/MySection';

const OneRoster: React.FC<{ wo: MyHomeWorkOrder; today: string }> = ({ wo, today }) => {
  const { t } = useTranslation('myHome');
  const roster = useWorkOrderRoster(wo.work_order_id, today);
  const day = useAttendanceDay(wo.work_order_id, today);
  const crew = roster.data?.find((c) => c.crew_id === wo.crew_id);
  return (
    <div className="rounded-md border border-border p-3 [&_[data-mobile-action-bar]]:static! [&_[data-mobile-action-bar]]:mt-4">
      <p className="text-control font-semibold">{wo.title}</p>
      {roster.isPending || day.isPending ? <ListState variant="loading" rows={2} />
        : roster.isError || day.isError ? <ListState variant="error" quiet title={t('myHome:roster.error', "Couldn't load the crew")} onRetry={() => { void roster.refetch(); void day.refetch(); }} />
        : !crew ? <p className="text-control text-muted-foreground">{t('myHome:roster.empty', 'No crew on this work order today')}</p>
        : <TickForm key={`${crew.crew_id}-${day.data?.length ?? 0}`} crew={crew} workOrderId={wo.work_order_id} date={today} held={day.data ?? []} canRecord />}
    </div>
  );
};

/** The Foreman ticks their own crew's attendance (existing roster-tick path). Only work orders where they lead the crew. */
export const CrewRoster: React.FC<{ today: string; workOrders: MyHomeWorkOrder[] }> = ({ today, workOrders }) => {
  const { t } = useTranslation('myHome');
  const mine = workOrders.filter((w) => w.is_controller);
  if (mine.length === 0) return null;
  return (
    <MySection id="my-crew" title={t('myHome:roster.title', 'My crew today')}>
      {mine.map((wo) => <OneRoster key={`${wo.work_order_id}-${wo.crew_id}`} wo={wo} today={today} />)}
    </MySection>
  );
};
