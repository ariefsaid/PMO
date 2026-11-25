/**
 * One notification row, shared by the shell bell's inbox popover and the field account's "My work" list
 * (#2887): the same severity dot, title, body and read marker, and the same deep-link resolution.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { notificationBody, notificationTitle } from '@/src/lib/i18n/notificationCopy';
import { cn } from '@/src/components/ui/cn';
import type { NotificationListItem as NotificationRow } from '@/src/lib/db/notifications';
import { formatRelativeTime } from '@/src/lib/format';
import { readMetadata } from './notificationEntity';

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

export const NotificationItem: React.FC<{ row: NotificationRow; onSelect: (row: NotificationRow) => void }> = ({ row, onSelect }) => {
  const { t, i18n } = useTranslation(['common', 'incidents', 'notifications']);
  const isUnread = row.read_at === null;
  const sev = severityStyle(row.severity);
  const body = notificationBody(row, t, i18n.language);
  // fix-waiting item 4: a decision notification says WHAT was decided (the record's number or name), not only that something was.
  const entityLabel = readMetadata(row.metadata).entity?.label?.trim() || null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row)}
        className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex w-full items-center gap-1.5">
          <span data-severity-dot aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: sev.dot }} />
          <span className={cn('text-control font-semibold', sev.labelCls)}>{row.severity}</span>
          <span className="ml-auto shrink-0 text-support text-muted-foreground">{formatRelativeTime(row.created_at)}</span>
        </span>
        <span className={cn('break-words text-control', isUnread ? 'font-semibold text-foreground' : 'font-normal text-foreground')}>
          {row.title === 'Issue is overdue' && readMetadata(row.metadata).entity?.type === 'incident'
            ? t('incidents:notification.overdue', 'Issue is overdue')
            : notificationTitle(row, t)}
        </span>
        {entityLabel && !(body ?? '').includes(entityLabel) && !notificationTitle(row, t).includes(entityLabel) && (
          <span className="break-words text-control font-medium text-foreground" data-testid="notification-entity-label">{entityLabel}</span>
        )}
        {body && <span className="break-words text-control text-muted-foreground">{body}</span>}
        <span className="text-control text-muted-foreground">
          {isUnread ? t('shell.notifications.unread', 'Unread') : t('shell.notifications.read', 'Read')}
        </span>
      </button>
    </li>
  );
};
