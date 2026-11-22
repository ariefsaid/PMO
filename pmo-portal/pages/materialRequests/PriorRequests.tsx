import React from 'react';
import { useTranslation } from 'react-i18next';
import { statusLabel } from '@/src/lib/status/statusMap';
import { formatDay } from '@/src/lib/format';
import { usePriorRequests } from '@/src/hooks/useMaterialRequests';

interface Props {
  workOrderId: string;
  itemId: string;
  excludeRequestId?: string | null;
  /** The "already requested" figure the line shows. */
  prior: number;
}

/**
 * The "already requested N" figure, made tappable: it opens the earlier requests (number, status, quantity, date) that add up to it.
 * What the requests do not cover is stock already sent to the work order, and the list says so instead of leaving the figure unexplained.
 */
export const PriorRequests: React.FC<Props> = ({ workOrderId, itemId, excludeRequestId, prior }) => {
  const { t } = useTranslation('materialRequests');
  const { t: tStatus } = useTranslation('status');
  const [open, setOpen] = React.useState(false);
  const list = usePriorRequests(workOrderId, itemId, excludeRequestId, open);
  const requested = (list.data ?? []).reduce((sum, r) => sum + r.quantity, 0);
  const sent = Math.max(0, Math.round((prior - requested) * 1000) / 1000);
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="touch-target inline-flex min-h-11 items-center underline decoration-border underline-offset-4 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        data-testid="mrq-prior-toggle">
        {t('form.priorToggle', { defaultValue: 'already requested {{prior}}', prior })}
      </button>
      {open && (
        <div role="region" aria-label={t('form.priorTitle', 'Earlier requests for this item')} className="mt-1 rounded-md border border-border bg-card p-2 text-foreground" data-testid="mrq-prior-list">
          {list.isPending ? <p>…</p>
            : list.isError ? <p>{t('form.priorError', "Couldn't load the earlier requests")}</p>
              : (
                <ul className="space-y-1">
                  {(list.data ?? []).map((r) => (
                    <li key={r.requestId}>{t('form.priorRow', { defaultValue: '{{number}} · {{status}} · {{quantity}} · needed {{date}}', number: r.number, status: statusLabel('materialRequest', r.status, tStatus), quantity: r.quantity, date: formatDay(r.neededBy) })}</li>
                  ))}
                  {sent > 0 && <li>{t('form.priorSent', { defaultValue: 'Stock already sent to this work order: {{quantity}}', quantity: sent })}</li>}
                  {(list.data ?? []).length === 0 && sent === 0 && <li>{t('form.priorNone', 'No earlier request for this item')}</li>}
                </ul>
              )}
        </div>
      )}
    </>
  );
};
