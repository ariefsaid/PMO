/**
 * NotificationBell — the shell ContextBar's notification bell + inbox popover
 * (FR-AAN-034/035/036, AC-AAN-032..035, NFR-AAN-A11Y-001..003).
 *
 * REC-3: an OWN component with its OWN query against the notification repository —
 * it does NOT consume a `notificationCount` prop (that dead prop is dropped from
 * `ContextBarProps` in the same change, OBS-AAN-001). Mounted for every
 * signed-in user by `ContextBar` (#788; was behind `agentAssistant`, FR-AAN-038).
 *
 * Severity idiom (DESIGN.md "The Status-As-Dot Rule", ADR-0068 monochrome-calm):
 * a quiet colored dot + AA-text label — NEVER a loud filled slab. Reuses the same
 * dot+label grammar as `StatusPill`, mapped through a local severity→variant table
 * (notifications' own `info|warning|critical` domain, not `StatusPill`'s workflow
 * vocabulary, so it is NOT routed through `statusVariants.ts` — CW-2 governs
 * status/severity/category pills sharing a vocabulary; this is a distinct one).
 *
 * Deep-link resolution (FR-AAN-036): `metadata.entity` → navigate to that record;
 * else `metadata.run_id` → open the assistant panel and resume that run's transcript
 * (the ADR-0043/FR-AGP-021 resume path); neither present → selecting only marks read.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/src/components/ui/icons';
import { useAssistantPanel } from '@/src/hooks/useAssistantPanel';
import { repositories } from '@/src/lib/repositories';
import type { NotificationCursor, NotificationListItem as NotificationRow } from '@/src/lib/db/notifications';
import { NotificationItem } from './NotificationItem';
import { entityRoute, readMetadata } from './notificationEntity';

type InboxState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; rows: NotificationRow[]; nextCursor: NotificationCursor | null };

export const NotificationBell: React.FC = () => {
  const { t } = useTranslation(['common', 'incidents', 'notifications']);
  const navigate = useNavigate();
  const { openPanel, openThread } = useAssistantPanel();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  // #2122: a keyboard-activated open appears instantly (no 120ms menuPopIn). A keyboard / AT
  // activation arrives as a click with `detail === 0`; a pointer click has `detail >= 1`.
  const [instant, setInstant] = useState(false);
  const [inbox, setInbox] = useState<InboxState>({ status: 'idle' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  // Bumped by every inbox (re)load; a Load more response from an earlier generation is stale.
  const generation = useRef(0);
  const popoverRef = useRef<HTMLDivElement>(null);

  const refreshUnreadCount = useCallback(() => {
    repositories.notification.unreadCount()
      .then(setUnread)
      .catch(() => {
        // Fail-quiet on the count query — the badge simply doesn't update; opening
        // the inbox (which the user can still do) surfaces the real error state.
      });
  }, []);

  // item 9: the badge must never go stale for a mounted session — refresh on mount, every 60s while
  // the tab is visible (a hidden tab sends no request; it refreshes the moment the tab returns, #2105),
  // and again after loadInbox/markRead resolve (below) so an in-session read/new-arrival is reflected
  // promptly without waiting up to 60s.
  useEffect(() => {
    refreshUnreadCount();
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') refreshUnreadCount();
    };
    const id = setInterval(refreshIfVisible, 60_000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [refreshUnreadCount]);

  const loadInbox = useCallback(() => {
    generation.current += 1;
    setLoadingMore(false);
    setLoadMoreError(false);
    const gen = generation.current;
    setInbox({ status: 'loading' });
    repositories.notification.listPage()
      .then(({ rows, nextCursor }) => {
        if (gen !== generation.current) return;
        setInbox({ status: 'ready', rows, nextCursor });
        refreshUnreadCount();
      })
      .catch(() => {
        if (gen === generation.current) setInbox({ status: 'error' });
      });
  }, [refreshUnreadCount]);

  // Keyset "Load more" (#843): append the next page; a failure keeps the rows already shown.
  const loadMore = useCallback(() => {
    if (inbox.status !== 'ready' || !inbox.nextCursor || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    setLoadMoreError(false);
    repositories.notification.listPage({ cursor: inbox.nextCursor })
      .then(({ rows, nextCursor }) => {
        if (gen !== generation.current) return;
        setInbox((prev) =>
          prev.status === 'ready'
            ? {
                status: 'ready',
                rows: [...prev.rows, ...rows.filter((r) => !prev.rows.some((p) => p.id === r.id))],
                nextCursor,
              }
            : prev,
        );
      })
      .catch(() => {
        if (gen === generation.current) setLoadMoreError(true);
      })
      .finally(() => {
        if (gen === generation.current) setLoadingMore(false);
      });
  }, [inbox, loadingMore]);

  useEffect(() => {
    if (open) loadInbox();
  }, [open, loadInbox]);

  // Close on outside click / Escape (mirrors ContextBar's existing popover pattern).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSelect = useCallback(
    async (row: NotificationRow) => {
      const wasUnread = row.read_at === null;
      // Optimistic local update so the badge/list feel immediate; the mark-read
      // UPDATE below is the source of truth (RLS + the mark-read-only trigger).
      setInbox((prev) =>
        prev.status === 'ready'
          ? {
              ...prev,
              rows: prev.rows.map((r) =>
                r.id === row.id ? { ...r, read_at: r.read_at ?? new Date().toISOString() } : r,
              ),
            }
          : prev,
      );
      if (wasUnread) setUnread((n) => Math.max(0, n - 1));

      try {
        if (wasUnread) {
          await repositories.notification.markRead(row.id);
          // item 9: reconcile the badge against the server's actual count after a successful
          // mark-read — the optimistic decrement above is immediate-feel; this is the source of
          // truth (guards drift from a concurrent notification elsewhere).
          refreshUnreadCount();
        }
      } catch {
        // Fail-quiet: the row stays optimistically read in this session; the next
        // full inbox load reconciles against the server's actual read_at.
      }

      const { entity, run_id: runId } = readMetadata(row.metadata);
      const route = entityRoute(entity);
      if (route) {
        setOpen(false);
        navigate(route);
        return;
      }
      if (runId) {
        setOpen(false);
        openPanel();
        openThread(runId);
      }
    },
    [navigate, openPanel, openThread, refreshUnreadCount],
  );

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        aria-label={t('shell.notifications.bellLabel', 'Notifications, {{count}} unread', { count: unread })}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => {
          setInstant(e.detail === 0);
          setOpen((v) => !v);
        }}
        className="touch-target relative grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[17px]"
      >
        <Icon name="bell" />
        <span aria-live="polite" className="sr-only">
          {unread > 0
            ? `${unread} unread notifications`
            : t('shell.notifications.noneUnread', 'No unread notifications')}
        </span>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 grid min-w-[16px] place-items-center rounded-full bg-foreground px-1 text-support font-semibold leading-none text-background"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          aria-labelledby="notification-bell-inbox-heading"
          data-instant={instant || undefined}
          className="menu-pop-anim [--menu-origin:top_right] motion-reduce:animate-none absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-1.5 shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]"
        >
          <h2 id="notification-bell-inbox-heading" className="sr-only">
            {t('shell.notifications.inboxHeading', 'Notifications inbox')}
          </h2>
          {inbox.status === 'loading' && (
            <p className="px-2.5 py-3 text-control text-muted-foreground">
              {t('shell.notifications.loading', 'Loading notifications…')}
            </p>
          )}
          {inbox.status === 'error' && (
            <p className="px-2.5 py-3 text-control text-muted-foreground">
              {t(
                'shell.notifications.loadError',
                "Couldn't load notifications. Try again shortly.",
              )}
            </p>
          )}
          {inbox.status === 'ready' && inbox.rows.length === 0 && (
            <p className="px-2.5 py-3 text-control text-muted-foreground">
              {t('shell.notifications.empty', 'No notifications yet.')}
            </p>
          )}
          {inbox.status === 'ready' && inbox.rows.length > 0 && (
            <ul aria-label={t('shell.notifications.listLabel', 'Notifications')} className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
              {inbox.rows.map((row) => <NotificationItem key={row.id} row={row} onSelect={(r) => void handleSelect(r)} />)}
              {inbox.nextCursor && (
                <li>
                  <p aria-live="polite" className="px-2.5 py-1 text-control text-muted-foreground">
                    {loadMoreError &&
                      t('shell.notifications.loadMoreError', "Couldn't load more. Try again.")}
                  </p>
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    aria-busy={loadingMore}
                    className="touch-target w-full rounded-md px-2.5 py-2 text-center text-control font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {loadingMore
                      ? t('shell.notifications.loadingMore', 'Loading…')
                      : t('shell.notifications.loadMore', 'Load more')}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
