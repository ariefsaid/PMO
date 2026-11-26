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
        // Spans with grid roles, not a <table>: the disclosure opens inside the line's plan sentence (a paragraph).
        <span role="region" aria-label={t('form.priorTitle', 'Earlier requests for this item')} className="mt-1 block rounded-md border border-border bg-card p-3 text-control text-foreground" data-testid="mrq-prior-list">
          {list.isPending ? <span className="block">…</span>
            : list.isError ? <span className="block" role="alert">{t('form.priorError', "Couldn't load the earlier requests")}</span>
              : (list.data ?? []).length === 0 && sent === 0 ? <span className="block">{t('form.priorNone', 'No earlier request for this item')}</span>
                : (
                  <span role="table" aria-label={t('form.priorTitle', 'Earlier requests for this item')} className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr_auto_auto]">
                    {(list.data ?? []).map((r) => (
                      <span key={r.requestId} role="row" className="contents">
                        <span role="rowheader" className="font-semibold">{r.number}</span>
                        <span role="cell">{statusLabel('materialRequest', r.status, tStatus)}</span>
                        <span role="cell" className="text-right tabular-nums">{r.quantity}</span>
                        <span role="cell" className="col-span-3 -mt-1 text-muted-foreground sm:col-span-1 sm:mt-0 sm:text-right">{t('form.priorNeeded', { defaultValue: 'needed {{date}}', date: formatDay(r.neededBy) })}</span>
                      </span>
                    ))}
                    {sent > 0 && (
                      <span role="row" className="contents">
                        <span role="rowheader" className="col-span-2 border-t border-border pt-2 text-muted-foreground">{t('form.priorSentLabel', 'Stock already sent to this work order')}</span>
                        <span role="cell" className="border-t border-border pt-2 text-right tabular-nums">{sent}</span>
                        <span role="cell" className="hidden border-t border-border pt-2 sm:block" />
                      </span>
                    )}
                  </span>
                )}
        </span>
      )}
    </>
  );
};
