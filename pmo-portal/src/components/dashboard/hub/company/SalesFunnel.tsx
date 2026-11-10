import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SALES_COLUMNS } from '@/components/salesPipeline';
import { Funnel } from '@/src/components/ui/Funnel';
import { ListState } from '@/src/components/ui/ListState';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { formatCompactCurrency } from '@/src/lib/format';
import type { PipelineStage } from '@/src/lib/db/dashboard';

const OPEN_STATUSES = new Set(SALES_COLUMNS.filter((column) => !column.terminal).flatMap((column) => column.statuses));

/** Open pipeline stages as one funnel band: the count leads each stage, the weighted value sits under it. */
export const SalesFunnel: React.FC<{ stages: PipelineStage[]; currency: string }> = ({ stages, currency }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const open = stages.filter((stage) => OPEN_STATUSES.has(stage.status as string));
  if (open.length === 0) return <ListState variant="empty" icon="pipe" title={t('hub.company.noPipeline', 'No open pipeline stages')} />;
  const max = Math.max(1, ...open.map((stage) => stage.count));
  return (
    <Funnel
      presentation="flat"
      onSelect={(index) => navigate(`/sales?status=${encodeURIComponent(open[index].status as string)}`)}
      stages={open.map((stage) => ({
        name: statusLabel(stage.status as string),
        value: stage.count,
        weighted: t('hub.company.funnelWeighted', '{{amount}} weighted', { amount: formatCompactCurrency(stage.weighted_value, currency) }),
        barPct: (stage.count / max) * 100,
      }))}
    />
  );
};
