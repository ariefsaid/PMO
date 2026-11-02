import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLossBreakdown, type WinRateRange } from '@/src/hooks/useDashboard';
import { Button } from '@/src/components/ui';
import { lostReasonLabel } from '@/src/lib/lostReasons';

export const LossBreakdown: React.FC<{ range: WinRateRange }> = ({ range }) => {
  const { t } = useTranslation('lostReason');
  const { data, isError, isPending, refetch } = useLossBreakdown(range);
  if (isPending) return null;
  if (isError || !data) {
    return (
      <div data-testid="loss-breakdown-error" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        {t('breakdown.errorTitle', "Couldn't load the loss breakdown")}
        <Button variant="ghost" size="sm" onClick={() => void refetch()}>{t('breakdown.retry', 'Try again')}</Button>
      </div>
    );
  }
  const max = Math.max(1, ...data.by_reason.map((r) => r.losses_count + r.declined_count));
  return (
    <div data-testid="loss-breakdown" className="mt-4 grid gap-4 border-t border-border pt-3">
      <section aria-label={t('breakdown.reasonsTitle', 'Why deals were lost')}>
        <h4 className="mb-2 text-xs font-semibold">{t('breakdown.reasonsTitle', 'Why deals were lost')}</h4>
        {data.by_reason.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('breakdown.none', 'No lost deals in this period.')}</p>
        ) : (
          <ul className="grid gap-1.5">
            {data.by_reason.map((r) => {
              const total = r.losses_count + r.declined_count;
              return (
                <li key={r.reason ?? 'not-recorded'} className="grid gap-0.5" data-testid={`loss-reason-${r.reason ?? 'not_recorded'}`}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span>{lostReasonLabel((key, d) => String(t(key, d)), r.reason)}</span>
                    <span className="tabular text-muted-foreground">
                      {[
                        r.losses_count > 0 && t('breakdown.lostCount', '{{n}} lost', { n: r.losses_count }),
                        r.declined_count > 0 && t('breakdown.declinedCount', '{{n}} declined', { n: r.declined_count }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${(total / max) * 100}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {data.by_client.length > 0 && (
        <section aria-label={t('breakdown.clientsTitle', 'Win and loss by client')}>
          <h4 className="mb-2 text-xs font-semibold">{t('breakdown.clientsTitle', 'Win and loss by client')}</h4>
          <ul className="grid gap-1 text-xs">
            {data.by_client.map((c) => (
              <li key={c.client_id ?? 'unknown'} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">{c.client_name ?? t('breakdown.unknownClient', 'Unknown client')}</span>
                <span className="shrink-0 tabular text-muted-foreground">
                  {t('breakdown.wonLost', '{{won}} won, {{lost}} lost', { won: c.wins_count, lost: c.losses_count })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
