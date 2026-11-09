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
const BAND = ['bg-primary', 'bg-primary/85', 'bg-violet', 'bg-violet/80', 'bg-violet/65'];

/** Open pipeline stages as stacked bands that narrow stage by stage: name and count on the left, gross and weighted value on the right. */
export const SalesFunnel: React.FC<{ stages: PipelineStage[]; currency: string }> = ({ stages, currency }) => {
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
            className={cn('flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1 text-left text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', BAND[index % BAND.length])}
          >
            <span className="truncate">{statusLabel(stage.status as string)} · {stage.count}</span>
            <span className="shrink-0 tabular-nums">{formatCompactCurrency(stage.total_value, currency)} · {t('hub.company.funnelWeightedShort', 'w {{amount}}', { amount: formatCompactCurrency(stage.weighted_value, currency) })}</span>
          </button>
        </li>
      ))}
    </ul>
  );
};
