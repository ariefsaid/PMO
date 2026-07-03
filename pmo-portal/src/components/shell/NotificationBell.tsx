/**
 * NotificationBell — the shell ContextBar's notification bell + inbox popover
 * (FR-AAN-034/035/036, AC-AAN-032..035, NFR-AAN-A11Y-001..003).
 *
 * REC-3: an OWN component with its OWN query against `src/lib/db/notifications` —
 * it does NOT consume a `notificationCount` prop (that dead prop is dropped from
 * `ContextBarProps` in the same change, OBS-AAN-001). Mounted behind the
 * `agentAssistant` flag by `ContextBar` (FR-AAN-038).
 *
 * Severity idiom (DESIGN.md "The Status-As-Dot Rule", ADR-0037 monochrome-calm):
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
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/src/components/ui/icons';
import { cn } from '@/src/components/ui/cn';
import { useAssistantPanel } from '@/src/hooks/useAssistantPanel';
import {
  listNotifications,
  listUnreadCount,
  markNotificationRead,
  type NotificationRow,
} from '@/src/lib/db/notifications';
import { formatRelativeTime } from '@/src/lib/format';

/** Notification severity → { dot color token, AA label text class }. Mirrors the
 * StatusPill dot+label grammar but is its own small table (notifications' severity
 * vocabulary — info/warning/critical — is not a workflow/category pill). */
const SEVERITY_STYLE: Record<string, { dot: string; labelCls: string }> = {
  info: { dot: 'hsl(var(--muted-foreground))', labelCls: 'text-muted-foreground' },
  warning: { dot: 'hsl(var(--warning))', labelCls: 'text-warning-foreground' },
  critical: { dot: 'hsl(var(--destructive))', labelCls: 'text-destructive-text' },
};

function severityStyle(severity: string) {
  return SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.info;
}

/** `metadata.entity.type` → the record's base list route. Only types with a
 * routable `/x/:id` detail page are resolvable (App.tsx route table); an
 * unrecognized type falls back to mark-read-only (no navigation). */
const ENTITY_ROUTE_BASE: Record<string, string> = {
  procurement_case: '/procurement',
  project: '/projects',
  company: '/companies',
  contact: '/contacts',
  opportunity: '/sales',
};

interface NotificationEntity {
  type?: string;
  id?: string;
  label?: string;
}

interface NotificationMetadata {
  entity?: NotificationEntity;
  run_id?: string;
}

function readMetadata(metadata: NotificationRow['metadata']): NotificationMetadata {
  if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as NotificationMetadata;
  }
  return {};
}

function entityRoute(entity: NotificationEntity | undefined): string | null {
  if (!entity?.type || !entity.id) return null;
  const base = ENTITY_ROUTE_BASE[entity.type];
  return base ? `${base}/${entity.id}` : null;
}

type InboxState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; rows: NotificationRow[] };

export const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const { openPanel, openThread } = useAssistantPanel();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<InboxState>({ status: 'idle' });
  const popoverRef = useRef<HTMLDivElement>(null);

  const refreshUnreadCount = useCallback(() => {
    listUnreadCount()
      .then(setUnread)
      .catch(() => {
        // Fail-quiet on the count query — the badge simply doesn't update; opening
        // the inbox (which the user can still do) surfaces the real error state.
      });
  }, []);

  // item 9: the badge must never go stale for a mounted session — refresh on mount, on a 60s
  // interval while mounted (cleanup-safe: the interval is cleared on unmount), and again after
  // loadInbox/markRead resolve (below) so an in-session read/new-arrival is reflected promptly
  // without waiting up to 60s.
  useEffect(() => {
    refreshUnreadCount();
    const id = setInterval(refreshUnreadCount, 60_000);
    return () => clearInterval(id);
  }, [refreshUnreadCount]);

  const loadInbox = useCallback(() => {
    setInbox({ status: 'loading' });
    listNotifications()
      .then((rows) => {
        setInbox({ status: 'ready', rows });
        refreshUnreadCount();
      })
      .catch(() => setInbox({ status: 'error' }));
  }, [refreshUnreadCount]);

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
              status: 'ready',
              rows: prev.rows.map((r) =>
                r.id === row.id ? { ...r, read_at: r.read_at ?? new Date().toISOString() } : r,
              ),
            }
          : prev,
      );
      if (wasUnread) setUnread((n) => Math.max(0, n - 1));

      try {
        if (wasUnread) {
          await markNotificationRead(row.id);
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
        aria-label={`Notifications, ${unread} unread`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="touch-target relative grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[17px]"
      >
        <Icon name="bell" />
        <span aria-live="polite" className="sr-only">
          {unread > 0 ? `${unread} unread notifications` : 'No unread notifications'}
        </span>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 grid min-w-[16px] place-items-center rounded-full bg-foreground px-1 text-[10px] font-semibold leading-none text-background"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          aria-labelledby="notification-bell-inbox-heading"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-1.5 shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]"
        >
          <h2 id="notification-bell-inbox-heading" className="sr-only">
            Notifications inbox
          </h2>
          {inbox.status === 'loading' && (
            <p className="px-2.5 py-3 text-[13px] text-muted-foreground">Loading notifications…</p>
          )}
          {inbox.status === 'error' && (
            <p className="px-2.5 py-3 text-[13px] text-muted-foreground">
              Couldn&apos;t load notifications. Try again shortly.
            </p>
          )}
          {inbox.status === 'ready' && inbox.rows.length === 0 && (
            <p className="px-2.5 py-3 text-[13px] text-muted-foreground">No notifications yet.</p>
          )}
          {inbox.status === 'ready' && inbox.rows.length > 0 && (
            <ul aria-label="Notifications" className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
              {inbox.rows.map((row) => {
                const isUnread = row.read_at === null;
                const sev = severityStyle(row.severity);
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => void handleSelect(row)}
                      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <span
                          data-severity-dot
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ background: sev.dot }}
                        />
                        <span
                          className={cn('text-[11px] font-semibold uppercase tracking-wide', sev.labelCls)}
                        >
                          {row.severity}
                        </span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                          {formatRelativeTime(row.created_at)}
                        </span>
                      </span>
                      <span className={cn('text-[13px]', isUnread ? 'font-semibold text-foreground' : 'font-normal text-foreground')}>
                        {row.title}
                      </span>
                      {row.body && (
                        <span className="line-clamp-2 text-[12px] text-muted-foreground">{row.body}</span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {isUnread ? 'Unread' : 'Read'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
