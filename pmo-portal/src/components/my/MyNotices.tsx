import React from 'react';
import { useNavigate, matchPath } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { NotificationCursor } from '@/src/lib/db/notifications';
import { NotificationItem } from '@/src/components/shell/NotificationItem';
import { entityRoute, readMetadata } from '@/src/components/shell/notificationEntity';
import { LIGHT_ROUTE_PATHS } from '@/src/components/shell/lightPages';
import { MySection } from './MySection';

/** The notices sent to the person, newest first (the shell bell's data path, row and Load-more keys). A field account has no bell,
 *  so this list is where they read notices: every fetched row renders, and a further page loads on demand. A row opens its record
 *  only where a field account may go; otherwise it is marked read. */
export const MyNotices: React.FC = () => {
  const { t } = useTranslation(['myHome', 'common']);
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const key = ['my-notices', currentUser?.id];
  const notices = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => repositories.notification.listPage(pageParam ? { cursor: pageParam } : undefined),
    initialPageParam: null as NotificationCursor | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(currentUser?.id),
  });
  const rows = notices.data?.pages.flatMap((page) => page.rows) ?? [];
  const onSelect = (row: { id: string; read_at: string | null; metadata: unknown }) => {
    if (row.read_at === null) void repositories.notification.markRead(row.id).then(() => qc.invalidateQueries({ queryKey: key })).catch(() => undefined);
    const route = entityRoute(readMetadata(row.metadata as never).entity);
    if (route && LIGHT_ROUTE_PATHS.some((p) => matchPath(p, route))) navigate(route);
  };
  return (
    <MySection id="my-notices" title={t('myHome:notices.title', 'Notices')}>
      {notices.isPending ? <p className="text-control text-muted-foreground">{t('common:shell.notifications.loading', 'Loading notifications…')}</p>
        : !notices.data ? <p className="text-control text-muted-foreground">{t('common:shell.notifications.loadError', "Couldn't load notifications. Try again shortly.")}</p>
        : rows.length === 0 ? <p className="text-control text-muted-foreground">{t('common:shell.notifications.empty', 'No notifications yet.')}</p>
        : (
          <ul aria-label={t('common:shell.notifications.listLabel', 'Notifications')} className="flex flex-col gap-0.5">
            {rows.map((row) => <NotificationItem key={row.id} row={row} onSelect={onSelect} />)}
            {notices.hasNextPage && (
              <li>
                <p aria-live="polite" className="px-2.5 py-1 text-control text-muted-foreground">
                  {notices.isFetchNextPageError && t('common:shell.notifications.loadMoreError', "Couldn't load more. Try again.")}
                </p>
                <button
                  type="button"
                  onClick={() => void notices.fetchNextPage()}
                  disabled={notices.isFetchingNextPage}
                  aria-busy={notices.isFetchingNextPage}
                  className="touch-target w-full rounded-md px-2.5 py-2 text-center text-control font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  {notices.isFetchingNextPage
                    ? t('common:shell.notifications.loadingMore', 'Loading…')
                    : t('common:shell.notifications.loadMore', 'Load more')}
                </button>
              </li>
            )}
          </ul>
        )}
    </MySection>
  );
};
