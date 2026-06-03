import React, { useMemo } from 'react';
import { ProjectStatus } from '../types';
import SalesKanbanBoard from '../components/SalesKanbanBoard';
import Card from '../components/Card';
import { PlusIcon, ChartBarIcon, CurrencyDollarIcon, FunnelIcon } from '../components/icons';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProjects } from '@/src/hooks/useProjects';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// Funnel stages + per-stage win probability (OBS-001/002). [OWNER-DECISION] OD-SP-1/OD-SP-2:
// these mirror the prototype; the open-pipeline membership and weights are owner-tunable.
const PIPELINE_STAGES: ReadonlyArray<{ status: ProjectStatus; probability: number }> = [
  { status: ProjectStatus.Leads, probability: 0.1 },
  { status: ProjectStatus.PQSubmitted, probability: 0.2 },
  { status: ProjectStatus.QuotationSubmitted, probability: 0.4 },
  { status: ProjectStatus.TenderSubmitted, probability: 0.6 },
  { status: ProjectStatus.Negotiation, probability: 0.8 },
  { status: ProjectStatus.WonPendingKoM, probability: 1.0 },
];
const PIPELINE_STATUSES = PIPELINE_STAGES.map((s) => s.status);
const PROBABILITY: Record<string, number> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.status, s.probability]),
);

// [OWNER-DECISION] OD-SP-3: win-rate denominator. Mirrors the prototype; relates to backlog
// "OD — Win-rate metric". won = closed-or-progressed tenders; lost = Loss Tender.
const WON_STATUSES: ProjectStatus[] = [
  ProjectStatus.WonPendingKoM,
  ProjectStatus.Ongoing,
  ProjectStatus.CloseOut,
];
const LOST_STATUSES: ProjectStatus[] = [ProjectStatus.Loss];

const SalesPipeline: React.FC = () => {
  useEffectiveRole(); // wires ImpersonationProvider in Shell (parity with other pages)

  const { data, isPending, isError, refetch } = useProjects();
  const allProjects = useMemo<ProjectWithRefs[]>(() => data ?? [], [data]);

  // Funnel = projects in an active sales stage (OBS-001), derived once per data change.
  const salesProjects = useMemo(
    () => allProjects.filter((p) => PIPELINE_STATUSES.includes(p.status as ProjectStatus)),
    [allProjects],
  );

  const kpis = useMemo(() => {
    const totalPipelineValue = salesProjects.reduce((sum, p) => sum + p.contract_value, 0);
    const weightedPipelineValue = salesProjects.reduce(
      (sum, p) => sum + p.contract_value * (PROBABILITY[p.status] ?? 0),
      0,
    );
    const activeDeals = salesProjects.filter(
      (p) => (p.status as ProjectStatus) !== ProjectStatus.WonPendingKoM,
    );
    const activeDealsCount = activeDeals.length;
    const avgDealSize = activeDealsCount > 0
      ? activeDeals.reduce((sum, p) => sum + p.contract_value, 0) / activeDealsCount
      : 0;

    // Historical win-rate over ALL projects (OBS-005), not just the funnel.
    const wonCount = allProjects.filter((p) => WON_STATUSES.includes(p.status as ProjectStatus)).length;
    const lossCount = allProjects.filter((p) => LOST_STATUSES.includes(p.status as ProjectStatus)).length;
    const totalClosed = wonCount + lossCount;
    const winRate = totalClosed > 0 ? (wonCount / totalClosed) * 100 : 0;

    return { totalPipelineValue, weightedPipelineValue, activeDealsCount, avgDealSize, wonCount, lossCount, winRate };
  }, [salesProjects, allProjects]);

  if (isPending) {
    return (
      <div data-testid="sales-loading" className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded-xl" />)}
        </div>
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Couldn't load the sales pipeline</h3>
        <p className="mt-1 text-gray-500 dark:text-gray-400">Something went wrong fetching your projects.</p>
        <button onClick={() => refetch()} className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Sales Pipeline</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Track opportunities, manage leads, and forecast revenue.</p>
        </div>
        <div className="mt-4 md:mt-0">
          <button className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 shadow-sm transition-colors">
            <PlusIcon className="w-5 h-5 mr-2" />
            Add Lead
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 flex-shrink-0">
        <Card className="flex items-center p-4">
          <div className="p-3 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300 mr-4">
            <CurrencyDollarIcon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Pipeline Value</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(kpis.totalPipelineValue)}</p>
          </div>
        </Card>
        <Card className="flex items-center p-4">
          <div className="p-3 rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300 mr-4">
            <ChartBarIcon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Weighted Forecast</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(kpis.weightedPipelineValue)}</p>
          </div>
        </Card>
        <Card className="flex items-center p-4">
          <div className="p-3 rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300 mr-4">
            <FunnelIcon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Active Deals</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{kpis.activeDealsCount}</p>
            <p className="text-xs text-gray-400">Avg size: {formatCurrency(kpis.avgDealSize)}</p>
          </div>
        </Card>
        <Card className="flex items-center p-4">
          <div className="p-3 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300 mr-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Historical Win Rate</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{kpis.winRate.toFixed(1)}%</p>
            <p className="text-xs text-gray-400">{kpis.wonCount} won / {kpis.lossCount} lost</p>
          </div>
        </Card>
      </div>

      {/* Pipeline Board */}
      <div className="flex-1 min-h-0">
        <SalesKanbanBoard projects={salesProjects} />
      </div>
    </div>
  );
};

export default SalesPipeline;
