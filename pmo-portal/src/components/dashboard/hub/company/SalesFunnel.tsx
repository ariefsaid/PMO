import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui/ListState';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { formatTileMoney } from '@/src/lib/format';
import { tileMoneyLines } from '@/src/components/dashboard/restructure/currencyOrder';
import type { PipelineStage } from '@/src/lib/db/dashboard';
import { openPipelineStages } from './pipelineStages';


const Bar: React.FC<{ label: string; value: string; share: number; onOpen: () => void }> = ({ label, value, share, onOpen }) => (
  <li>
    <button type="button" onClick={onOpen} className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-left text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <span className="min-w-0 truncate font-medium">{label}</span>
      <span className="tabular font-semibold">{value}</span>
      <span aria-hidden="true" className="col-span-2 h-2 rounded-full bg-secondary">
        <span className="block h-2 rounded-full bg-muted-foreground/40" style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
      </span>
    </button>
  </li>
);

/**
 * The open pipeline as ONE set of bars (weighted value per stage), one per stage; "Won" ends it. No second table of the
 * same stages. `won`: the period's won deals (count and per-currency amounts) and its drill link.
 */
export const SalesFunnel: React.FC<{ stages: PipelineStage[]; currency: string; period?: string; won?: { count: number; amounts: Array<{ currency: string; amount: number }>; href?: string } }> = ({ stages, currency, period, won }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const open = openPipelineStages(stages);
  if (open.length === 0 && !won) return <ListState variant="empty" icon="pipe" title={t('hub.company.noPipeline', 'No open pipeline stages')} />;
  const max = Math.max(1, ...open.map((stage) => stage.weighted_value));
  const wonValue = won ? tileMoneyLines(won.amounts, currency, formatTileMoney).join(' ') : '';
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1">
        {open.map((stage) => (
          <Bar key={stage.status as string} label={`${statusLabel(stage.status as string)} · ${stage.count}`} value={formatTileMoney(stage.weighted_value, currency) ?? '—'} share={stage.weighted_value / max} onOpen={() => navigate(`/sales?status=${encodeURIComponent(stage.status as string)}`)} />
        ))}
      </ul>
      {won && (
        <button type="button" onClick={() => navigate(won.href ?? '/projects?filter=won')} className="min-h-11 w-full border-t border-border pt-2 text-left text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <span className="font-medium">{t('home.wonThisYear', 'Won')}{period ? ` · ${period}` : ''} · {won.count} ·</span> <span className="tabular font-semibold">{wonValue}</span>
        </button>
      )}
    </div>
  );
};
