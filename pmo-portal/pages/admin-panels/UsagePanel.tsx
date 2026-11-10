import React from 'react';
import { AgentCostMetrics } from '@/src/components/admin/AgentCostMetrics';
import { SectionHeader } from '@/src/components/ui';
import { useUsage, useAgentRunStats } from '@/src/hooks/useUsage';
import { AdministrationUsage } from '../AdministrationUsage';
import type { AdministrationPanelProps } from './types';

const UsagePanel: React.FC<AdministrationPanelProps> = ({ label }) => {
  const usageQuery = useUsage();
  const runStatsQuery = useAgentRunStats();

  return (
    <div data-testid="administration-panel-usage" className="min-w-0">
      <SectionHeader title={label('usage')} />
      <div className="mb-4">
        <AgentCostMetrics
          summaryRows={usageQuery.data ?? []}
          runStatsRows={runStatsQuery.data ?? []}
          isPending={usageQuery.isPending || runStatsQuery.isPending}
          isError={usageQuery.isError || runStatsQuery.isError}
          onRetry={() => {
            void usageQuery.refetch();
            void runStatsQuery.refetch();
          }}
        />
      </div>
      <AdministrationUsage
        rows={usageQuery.data ?? []}
        isPending={usageQuery.isPending}
        isError={usageQuery.isError}
        onRetry={() => void usageQuery.refetch()}
      />
    </div>
  );
};

export default UsagePanel;
