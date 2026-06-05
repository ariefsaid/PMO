import React from 'react';
import Card from '../components/Card';
import { useSalesPipeline } from '@/src/hooks/useDashboard';
import { formatCurrency } from '@/src/lib/format';

// OD-SP-1 fixed pipeline stage display order (FR-SPD-014).
const PIPELINE_STAGES = [
  'Leads',
  'PQ Submitted',
  'Quotation Submitted',
  'Tender Submitted',
  'Negotiation',
] as const;

const SalesPipeline: React.FC = () => {
  const { data, isPending, isError, refetch } = useSalesPipeline();

  if (isPending) {
    return (
      <div data-testid="pipeline-loading" className="animate-pulse space-y-4">
        <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded-xl" />
        <div className="grid grid-cols-5 gap-4">
          {PIPELINE_STAGES.map(s => (
            <div key={s} className="h-48 bg-gray-200 dark:bg-gray-700 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div data-testid="pipeline-error" className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Couldn&apos;t load the sales pipeline</h3>
        <button
          onClick={() => refetch()}
          className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (data.projects.length === 0) {
    return (
      <div data-testid="pipeline-empty" className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">No pipeline projects</h3>
        <p className="mt-1 text-gray-500 dark:text-gray-400">Add a lead or opportunity to see the sales pipeline.</p>
      </div>
    );
  }

  // Build a lookup from stage status → stage data (FR-SPD-014)
  const stageByStatus = new Map(data.stages.map(s => [s.status, s]));
  const totalWeightedValue = data.stages.reduce((sum, s) => sum + s.weighted_value, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Sales Pipeline</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Track opportunities, manage leads, and forecast revenue.
        </p>
      </div>

      {/* Total weighted value KPI */}
      <Card>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Pipeline Weighted Value</p>
        <p
          data-testid="pipeline-weighted-total"
          className="text-2xl font-bold text-primary-600 dark:text-primary-400"
        >
          {formatCurrency(totalWeightedValue)}
        </p>
        <p className="mt-1 text-xs text-gray-400">Σ(contract_value × win_probability) across all stages</p>
      </Card>

      {/* Stage columns — fixed order per OD-SP-1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {PIPELINE_STAGES.map(stageName => {
          const stage = stageByStatus.get(stageName);
          const count = stage?.count ?? 0;
          const totalValue = stage?.total_value ?? 0;
          const winProb = stage?.win_probability ?? 0;
          const weightedValue = stage?.weighted_value ?? 0;

          return (
            <div
              key={stageName}
              data-testid={`stage-${stageName}`}
              className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700"
            >
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 truncate" title={stageName}>
                {stageName}
              </h3>
              <dl className="space-y-2">
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">Count</dt>
                  <dd className="text-xl font-bold text-gray-900 dark:text-white">{count}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">Total Value</dt>
                  <dd className="text-sm font-semibold text-gray-800 dark:text-gray-200">{formatCurrency(totalValue)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">Win Probability</dt>
                  <dd className="text-sm text-gray-600 dark:text-gray-300">{(winProb * 100).toFixed(0)}%</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">Weighted Value</dt>
                  <dd className="text-sm font-semibold text-primary-600 dark:text-primary-400">{formatCurrency(weightedValue)}</dd>
                </div>
              </dl>

              {/* Project list within stage */}
              {count > 0 && (
                <ul className="mt-3 space-y-1 border-t border-gray-200 dark:border-gray-600 pt-3">
                  {data.projects.filter(p => p.status === stageName).map(p => (
                    <li key={p.id} className="text-xs text-gray-700 dark:text-gray-300 truncate" title={p.name}>
                      {p.name}
                      {p.client_name && (
                        <span className="text-gray-400 dark:text-gray-500"> — {p.client_name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SalesPipeline;
