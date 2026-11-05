import React from 'react';
import { Button, Icon } from '@/src/components/ui';
import type { TierHealthState } from './useIntegrationsHealth';

interface IntegrationHealthPanelProps {
  state: TierHealthState;
  onRetry: () => void;
  t: (key: string, def: string, options?: Record<string, string | number>) => string;
}

/** The per-tier health read: loading / unavailable / available (AC-IRUX-003/004). */
export const IntegrationHealthPanel: React.FC<IntegrationHealthPanelProps> = ({ state, onRetry, t }) => {
  if (state.kind === 'loading') {
    return (
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        {t('integrations.organization.readiness.health.loading', 'Checking outbound work status…')}
      </p>
    );
  }
  if (state.kind === 'unavailable') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground" role="status">
        <span>
          {t('integrations.organization.readiness.health.unavailableTitle', 'Outbound work status unavailable')} — {t('integrations.organization.readiness.health.unavailableSub', 'Outstanding outbound work could not be read. Try again.')}
        </span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <Icon name="refresh" className="size-3.55" aria-hidden="true" />{t('integrations.organization.readiness.health.retry', 'Retry outbound status')}
        </Button>
      </div>
    );
  }
  const counts = state.health.state_counts;
  const recordsHref = state.health.tier === 'erpnext' ? '/companies' : '/projects';
  const recoveryHref = state.health.tier === 'erpnext' ? '/approvals' : '/projects';
  const attention = [
    { state: 'failed', count: counts.failed, href: recordsHref },
    { state: 'quarantined', count: counts.quarantined, href: recoveryHref },
    { state: 'held', count: counts.held, href: state.health.tier === 'erpnext' ? '/timesheets' : '/projects' },
  ] as const;
  return (
    <div className="mt-3 space-y-2 text-sm">
      <p className="flex items-center gap-1 text-muted-foreground" role="status">
        <Icon name={counts.pending === 0 ? 'check' : 'info'} className="size-3.55 shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{counts.pending === 0
          ? t('uxs07.pendingZero', 'No updates waiting to send')
          : counts.pending === 1
            ? t('uxs07.pendingOne', '{{count}} update waiting to send', { count: counts.pending })
            : t('uxs07.pendingMany', '{{count}} updates waiting to send', { count: counts.pending })}</span>
      </p>
      {attention.filter((item) => item.count > 0).map((item) => (
        <p key={item.state} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3 py-2 text-destructive-text" role="status">
          <span>{item.state === 'failed'
            ? item.count === 1 ? t('uxs07.failedAttentionOne', '1 failed update needs attention') : t('uxs07.failedAttentionMany', '{{count}} failed updates need attention', { count: item.count })
            : item.state === 'quarantined'
            ? item.count === 1 ? t('uxs07.quarantinedAttentionOne', '1 quarantined update needs attention') : t('uxs07.quarantinedAttentionMany', '{{count}} quarantined updates need attention', { count: item.count })
            : item.count === 1 ? t('uxs07.heldAttentionOne', '1 held update needs attention') : t('uxs07.heldAttentionMany', '{{count}} held updates need attention', { count: item.count })}</span>
          <a className="font-medium underline underline-offset-4" href={item.href}>{item.state === 'failed'
            ? t('uxs07.reviewFailed', 'Review failed updates')
            : item.state === 'quarantined'
            ? t('uxs07.reviewQuarantined', 'Review quarantined updates')
            : t('uxs07.reviewHeld', 'Review held updates')}</a>
        </p>
      ))}
      <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>{t('uxs07.liveRecordCheck', 'Not yet verified: review a connected record to confirm the data is usable.')}</span>
        <a className="font-medium text-foreground underline underline-offset-4" href={recordsHref}>
          {t('uxs07.reviewRecords', 'Review connected records')}
        </a>
      </p>
    </div>
  );
};
