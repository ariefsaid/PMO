
import React from 'react';
import { projects } from '../data/mockData';
import { ProjectStatus } from '../types';
import SalesKanbanBoard from '../components/SalesKanbanBoard';
import Card from '../components/Card';
import { PlusIcon, ChartBarIcon, CurrencyDollarIcon, FunnelIcon } from '../components/icons';

const SalesPipeline: React.FC = () => {
    // 1. Filter Projects relevant to Sales Pipeline
    // We include active sales stages + recently Won. We exclude 'Ongoing', 'Internal', 'CloseOut' from the main funnel, 
    // unless they are 'Won, Pending KoM' which sits at the end of the funnel.
    const salesProjects = projects.filter(p => [
        ProjectStatus.Leads,
        ProjectStatus.PQSubmitted,
        ProjectStatus.QuotationSubmitted,
        ProjectStatus.TenderSubmitted,
        ProjectStatus.Negotiation,
        ProjectStatus.WonPendingKoM
    ].includes(p.status));

    // 2. Define Probabilities
    const probabilities: Record<string, number> = {
        [ProjectStatus.Leads]: 0.1,
        [ProjectStatus.PQSubmitted]: 0.2,
        [ProjectStatus.QuotationSubmitted]: 0.4,
        [ProjectStatus.TenderSubmitted]: 0.6,
        [ProjectStatus.Negotiation]: 0.8,
        [ProjectStatus.WonPendingKoM]: 1.0,
    };

    // 3. Calculate KPIs
    const totalPipelineValue = salesProjects.reduce((sum, p) => sum + p.contractValue, 0);
    
    const weightedPipelineValue = salesProjects.reduce((sum, p) => {
        const prob = probabilities[p.status] || 0;
        return sum + (p.contractValue * prob);
    }, 0);

    const activeDealsCount = salesProjects.filter(p => p.status !== ProjectStatus.WonPendingKoM).length;
    
    // Simple Win Rate Calculation (Won / (Won + Loss) in the dataset)
    // Note: This looks at ALL projects in mockData to get a historical trend, not just the active sales pipeline
    const wonCount = projects.filter(p => p.status === ProjectStatus.WonPendingKoM || p.status === ProjectStatus.Ongoing || p.status === ProjectStatus.CloseOut).length;
    const lossCount = projects.filter(p => p.status === ProjectStatus.Loss).length;
    const totalClosed = wonCount + lossCount;
    const winRate = totalClosed > 0 ? (wonCount / totalClosed) * 100 : 0;

    const avgDealSize = activeDealsCount > 0 
        ? salesProjects.filter(p => p.status !== ProjectStatus.WonPendingKoM).reduce((sum, p) => sum + p.contractValue, 0) / activeDealsCount 
        : 0;

    const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

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
                        <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(totalPipelineValue)}</p>
                    </div>
                </Card>
                <Card className="flex items-center p-4">
                    <div className="p-3 rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300 mr-4">
                        <ChartBarIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Weighted Forecast</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(weightedPipelineValue)}</p>
                    </div>
                </Card>
                <Card className="flex items-center p-4">
                    <div className="p-3 rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300 mr-4">
                        <FunnelIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Active Deals</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-white">{activeDealsCount}</p>
                         <p className="text-xs text-gray-400">Avg size: {formatCurrency(avgDealSize)}</p>
                    </div>
                </Card>
                 <Card className="flex items-center p-4">
                    <div className="p-3 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300 mr-4">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Historical Win Rate</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-white">{winRate.toFixed(1)}%</p>
                        <p className="text-xs text-gray-400">{wonCount} won / {lossCount} lost</p>
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
