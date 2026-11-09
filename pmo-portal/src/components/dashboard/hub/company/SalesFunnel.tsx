import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SALES_COLUMNS } from '@/components/salesPipeline';
import { ListState } from '@/src/components/ui/ListState';
import { cn } from '@/src/components/ui/cn';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { formatCompactCurrency } from '@/src/lib/format';
import type { PipelineStage } from '@/src/lib/db/dashboard';

const OPEN_STATUSES = new Set(SALES_COLUMNS.filter((column) => !column.terminal).flatMap((column) => column.statuses));
const BAND = [
  'bg-primary text-primary-foreground',
  'bg-primary text-primary-foreground',
  'bg-status-violet-surface text-status-violet-text ring-1 ring-inset ring-violet/40',
  'bg-status-violet-surface text-status-violet-text ring-1 ring-inset ring-violet/40',
  'bg-status-violet-surface text-status-violet-text ring-1 ring-inset ring-violet/40',
];

/** Open pipeline stages as stacked bands that narrow stage by stage: name and count on the left, gross and weighted value on the right. */
/** `won`: the period's won result as the last band; `value` is the figure as shown (count and amount), `href` its drill. */
export const SalesFunnel: React.FC<{ stages: PipelineStage[]; currency: string; won?: { value: string; href?: string } }> = ({ stages, currency, won }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const open = stages.filter((stage) => OPEN_STATUSES.has(stage.status as string));
  if (open.length === 0) return <ListState variant="empty" icon="pipe" title={t('hub.company.noPipeline', 'No open pipeline stages')} />;
  return (
    <ul className="grid gap-1.5">
      {open.map((stage, index) => (
        <li key={stage.status as string} style={{ width: `${Math.max(62, 100 - index * 9)}%` }} className="mx-auto">
          <button
            type="button"
            onClick={() => navigate(`/sales?status=${encodeURIComponent(stage.status as string)}`)}
            className={cn('flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1 text-left text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', BAND[index % BAND.length])}
          >
            <span className="truncate">{statusLabel(stage.status as string)} · {stage.count}</span>
            <span className="shrink-0 tabular-nums">{formatCompactCurrency(stage.total_value, currency)} · {t('hub.company.funnelWeightedShort', 'w {{amount}}', { amount: formatCompactCurrency(stage.weighted_value, currency) })}</span>
          </button>
        </li>
      ))}
      {won && (
        <li style={{ width: `${Math.max(62, 100 - open.length * 9)}%` }} className="mx-auto">
          <button
            type="button"
            onClick={() => navigate(won.href ?? '/projects?filter=won')}
            className="flex min-h-8 w-full items-center justify-between gap-2 rounded-md bg-success px-2.5 py-1 text-left text-xs font-semibold text-success-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="truncate">{t('dashboard:winRate.won', 'Won')}</span>
            <span className="shrink-0 tabular-nums">{won.value}</span>
          </button>
        </li>
      )}
    </ul>
  );
};
