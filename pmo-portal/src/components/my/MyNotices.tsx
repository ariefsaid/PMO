import React from 'react';
import { useNavigate, matchPath } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { NotificationItem } from '@/src/components/shell/NotificationItem';
import { entityRoute, readMetadata } from '@/src/components/shell/notificationEntity';
import { LIGHT_ROUTE_PATHS } from '@/src/components/shell/lightPages';
import { MySection } from './MySection';

/** The notices sent to the person, newest first (the shell bell's data path and row). A row opens its record only where a field account may go; otherwise it is marked read. */
export const MyNotices: React.FC = () => {
  const { t } = useTranslation(['myHome', 'common']);
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const key = ['my-notices', currentUser?.id];
  const notices = useQuery({ queryKey: key, queryFn: () => repositories.notification.listPage(), enabled: Boolean(currentUser?.id) });
  const onSelect = (row: { id: string; read_at: string | null; metadata: unknown }) => {
    if (row.read_at === null) void repositories.notification.markRead(row.id).then(() => qc.invalidateQueries({ queryKey: key })).catch(() => undefined);
    const route = entityRoute(readMetadata(row.metadata as never).entity);
    if (route && LIGHT_ROUTE_PATHS.some((p) => matchPath(p, route))) navigate(route);
  };
  return (
    <MySection id="my-notices" title={t('myHome:notices.title', 'Notices')}>
      {notices.isPending ? <p className="text-control text-muted-foreground">{t('common:shell.notifications.loading', 'Loading notifications…')}</p>
        : notices.isError ? <p className="text-control text-muted-foreground">{t('common:shell.notifications.loadError', "Couldn't load notifications. Try again shortly.")}</p>
        : notices.data.rows.length === 0 ? <p className="text-control text-muted-foreground">{t('common:shell.notifications.empty', 'No notifications yet.')}</p>
        : (
          <ul aria-label={t('common:shell.notifications.listLabel', 'Notifications')} className="flex flex-col gap-0.5">
            {notices.data.rows.slice(0, 10).map((row) => <NotificationItem key={row.id} row={row} onSelect={onSelect} />)}
          </ul>
        )}
    </MySection>
  );
};
