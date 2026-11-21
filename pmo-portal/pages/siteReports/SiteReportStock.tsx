import React from 'react';
import { useTranslation } from 'react-i18next';
import { RecordSection, StatusPill } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import { isFlaggedLine, type DsrStockLine, type DsrStockStatus } from '@/src/lib/db/dsrStockIssue';
import { useDsrStockStatus } from '@/src/hooks/useDsrStockIssue';

/** The plain-words reason for a flagged line (#2676 FR-DRS-031). A failed line shows the engine's reason code as written by the database. */
export function stockLineReason(t: (k: string, o?: Record<string, unknown>) => string, l: DsrStockLine, location: string | null): string {
  switch (l.state) {
    case 'short': return t('stock.reason.short', { n: l.shortBy ?? '', location: location ?? '' });
    case 'no_location': return t('stock.reason.noLocation');
    case 'no_work_item': return t('stock.reason.noWorkItem');
    case 'failed': return t('stock.reason.failed', { reason: l.reason ?? '' });
    case 'not_stocked': return t('stock.reason.notStocked');
    default: return '';
  }
}

export const SiteReportStockView: React.FC<{ status: DsrStockStatus }> = ({ status }) => {
  const { t } = useTranslation('siteReport');
  const flagged = status.lines.filter((l) => isFlaggedLine(l.state));
  return (
    <RecordSection title={t('stock.title', 'Stock')} data-testid="dsr-stock">
      {status.documentNumber && (
        <p className="text-foreground" data-testid="dsr-stock-posted">
          {t('stock.issued', { number: status.documentNumber, date: status.occurredOn ? formatDay(status.occurredOn) : '' })}
          {status.location ? ` · ${status.location}` : ''}
        </p>
      )}
      {status.reversed && <p className="text-muted-foreground">{t('stock.reversed')}</p>}
      {flagged.length > 0 && (
        <div role="alert" className="mt-2 rounded-lg border border-warning/30 bg-waiting-surface px-3.5 py-3" data-testid="dsr-stock-warning">
          <div className="font-semibold text-warning-foreground">{t('stock.warning')}</div>
          <ul className="mt-1 space-y-1">
            {flagged.map((l) => (
              <li key={l.consumableId} className="text-foreground">
                <span className="font-medium">{l.itemCode} · {l.itemName}</span> <span className="tabular-nums">{l.quantity} {l.unit}</span>
                {' — '}{stockLineReason(t as never, l, status.location)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground">{t('stock.fix')}</p>
        </div>
      )}
      {status.lines.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {status.lines.map((l) => (
            <li key={l.consumableId} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <span className="text-foreground">{l.itemCode} · {l.itemName} <span className="tabular-nums text-muted-foreground">{l.quantity} {l.unit}</span></span>
              <StatusPill variant={l.state === 'posted' ? 'won' : l.state === 'not_stocked' ? 'neutral' : 'warn'}>{t(`stock.state.${l.state}`)}</StatusPill>
            </li>
          ))}
        </ul>
      )}
    </RecordSection>
  );
};

/** Shown on a validated report only while the organisation's setting is on; renders nothing when nothing was posted or flagged. */
export const SiteReportStock: React.FC<{ reportId: string; enabled: boolean }> = ({ reportId, enabled }) => {
  const q = useDsrStockStatus(reportId, enabled);
  if (!enabled || !q.data) return null;
  return <SiteReportStockView status={q.data} />;
};
