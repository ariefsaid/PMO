
import React, { useState, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Card from '../components/Card';
import ProjectStatusBadge from '../components/ProjectStatusBadge';
import { projects, users, companies, budgetLineItems, budgetVersions, procurements, timesheetEntries, timesheets, tasks as allTasks, projectDocuments } from '../data/mockData';
import { BudgetCategory, BudgetVersion, Task, TaskStatus, Procurement, ProcurementStatus, ProjectDocument } from '../types';
import { BuildingOfficeIcon, CalendarDaysIcon, CurrencyDollarIcon, UserIcon, CheckCircleIcon, PlusIcon, PencilSquareIcon, TrashIcon, ClipboardDocumentCheckIcon, DocumentIcon, CloudArrowUpIcon, EyeIcon } from '../components/icons';
import ProcurementStatusBadge from '../components/ProcurementStatusBadge';

const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

const MetricCard: React.FC<{ title: string; value: string; icon: React.ElementType; color?: string }> = ({ title, value, icon: Icon, color = "primary" }) => {
    const colorClasses: Record<string, string> = {
        primary: "text-primary-500 bg-primary-100 dark:bg-primary-500/20",
        green: "text-green-500 bg-green-100 dark:bg-green-500/20",
        orange: "text-orange-500 bg-orange-100 dark:bg-orange-500/20",
        red: "text-red-500 bg-red-100 dark:bg-red-500/20",
    };
    
    return (
        <div className="flex items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-700">
            <div className={`p-3 mr-4 rounded-full ${colorClasses[color] || colorClasses.primary}`}>
                <Icon className="w-5 h-5" />
            </div>
            <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{value}</p>
            </div>
        </div>
    );
};

// --- START: Drawer Components ---

const TimelineItem: React.FC<{ event: { status: string; date: string; notes?: string }, isActive: boolean }> = ({ event, isActive }) => {
    const iconWrapperClass = `absolute flex items-center justify-center w-8 h-8 rounded-full -left-4 ring-4 ring-white dark:ring-gray-800 ${
        isActive ? 'bg-primary-500' : 'bg-green-500'
    }`;

    return (
        <li className="mb-8 ml-10">
            <div className={iconWrapperClass}>
                <CheckCircleIcon className="w-5 h-5 text-white" />
            </div>
            <h3 className="flex items-center mb-1 text-base font-semibold text-gray-900 dark:text-white">
                {event.status}
                {isActive && <span className="bg-primary-100 text-primary-800 text-sm font-medium mr-2 px-2.5 py-0.5 rounded dark:bg-primary-900 dark:text-primary-300 ml-3">Current</span>}
            </h3>
            <time className="block mb-2 text-sm font-normal leading-none text-gray-400 dark:text-gray-500">{new Date(event.date).toLocaleString()}</time>
            {event.notes && <p className="text-sm font-normal text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 p-2 rounded-md">{event.notes}</p>}
        </li>
    );
};

const ProcurementDrawer: React.FC<{ procurement: Procurement | null; onClose: () => void }> = ({ procurement, onClose }) => {
    if (!procurement) return null;

    const vendor = companies.find(c => c.id === procurement.vendorId);

    // Derive timeline from documents
    const timeline = procurement.documents.map(doc => ({
        status: `${doc.type} (${doc.status})`,
        date: doc.date,
        notes: doc.referenceNumber
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const isPendingApproval = procurement.status === ProcurementStatus.Requested;

    return (
        <div className="fixed inset-0 z-50 overflow-hidden" aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
            <div className="absolute inset-0 overflow-hidden">
                {/* Backdrop */}
                <div className="absolute inset-0 bg-gray-900 bg-opacity-50 backdrop-blur-sm transition-opacity" onClick={onClose} aria-hidden="true"></div>

                <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 sm:pl-16">
                    <div className="pointer-events-auto w-screen max-w-lg">
                        <div className="flex h-full flex-col overflow-y-scroll bg-white dark:bg-gray-800 shadow-2xl">
                            {/* Header */}
                            <div className="bg-primary-600 px-4 py-6 sm:px-6 relative overflow-hidden">
                                {/* Decorative circle */}
                                <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full bg-white opacity-10 pointer-events-none"></div>
                                
                                <div className="flex items-center justify-between relative z-10">
                                    <h2 className="text-lg font-medium text-white" id="slide-over-title">
                                        Quick View
                                    </h2>
                                    <div className="ml-3 flex h-7 items-center">
                                        <button
                                            type="button"
                                            className="rounded-md bg-primary-600 text-primary-200 hover:text-white focus:outline-none focus:ring-2 focus:ring-white"
                                            onClick={onClose}
                                        >
                                            <span className="sr-only">Close panel</span>
                                            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-4 relative z-10">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="text-xl font-bold text-white leading-snug">{procurement.title}</p>
                                            <p className="text-primary-200 text-sm mt-1">{procurement.id}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-primary-100 text-xs uppercase font-medium tracking-wider">Total Value</p>
                                            <p className="text-2xl font-bold text-white">{formatCurrency(procurement.totalValue)}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Action Bar for Pending Items */}
                            {isPendingApproval && (
                                <div className="bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3 border-b border-yellow-100 dark:border-yellow-900/50 flex items-center justify-between">
                                    <div className="text-sm text-yellow-800 dark:text-yellow-200">
                                        <span className="font-semibold">Action Required:</span> Approval Pending
                                    </div>
                                    <div className="flex space-x-2">
                                        <button className="px-3 py-1 bg-white dark:bg-gray-800 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs font-semibold rounded hover:bg-red-50 dark:hover:bg-red-900/30">Reject</button>
                                        <button className="px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded hover:bg-green-700 shadow-sm">Approve</button>
                                    </div>
                                </div>
                            )}

                            <div className="relative flex-1 px-4 py-6 sm:px-6 space-y-8">
                                {/* Status & Metadata */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">Status</p>
                                        <div className="mt-1"><ProcurementStatusBadge status={procurement.status} /></div>
                                    </div>
                                    <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">Vendor</p>
                                        <p className="text-sm font-semibold text-gray-900 dark:text-white mt-1">{vendor?.name || 'Pending Selection'}</p>
                                    </div>
                                </div>

                                {/* Items Preview */}
                                <div>
                                    <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider mb-3">Items Summary</h3>
                                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                                <tr>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Item</th>
                                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">Qty</th>
                                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">Amount</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                                {procurement.items.slice(0, 3).map((item, idx) => (
                                                    <tr key={item.id || idx}>
                                                        <td className="px-3 py-2 text-xs text-gray-900 dark:text-white">{item.name}</td>
                                                        <td className="px-3 py-2 text-xs text-right text-gray-500 dark:text-gray-300">{item.quantity}</td>
                                                        <td className="px-3 py-2 text-xs text-right font-medium text-gray-900 dark:text-white">{formatCurrency(item.amount)}</td>
                                                    </tr>
                                                ))}
                                                {procurement.items.length > 3 && (
                                                    <tr>
                                                        <td colSpan={3} className="px-3 py-1.5 text-center text-xs text-gray-500 bg-gray-50 dark:bg-gray-700/30 italic">
                                                            + {procurement.items.length - 3} more items
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Documents Links */}
                                {procurement.documents.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider mb-3">Documents</h3>
                                        <div className="flex flex-wrap gap-2">
                                            {procurement.documents.map((doc) => (
                                                <div key={doc.id} className="inline-flex items-center px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer group">
                                                    <ClipboardDocumentCheckIcon className="w-3.5 h-3.5 text-gray-400 mr-2 group-hover:text-primary-500" />
                                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{doc.referenceNumber}</span>
                                                    <span className="ml-1.5 text-[10px] text-gray-400 uppercase">({doc.type.split(' ').map(s => s[0]).join('')})</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Timeline */}
                                <div>
                                    <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider mb-4">Activity Timeline</h3>
                                    <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-3">
                                        {timeline.length > 0 ? timeline.map((event, index) => (
                                            <TimelineItem
                                                key={index}
                                                event={event}
                                                isActive={index === timeline.length - 1}
                                            />
                                        )) : (
                                            <p className="text-sm text-gray-500 ml-4 italic">No activity recorded.</p>
                                        )}
                                    </ol>
                                </div>
                            </div>
                            
                            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                <Link 
                                    to={`/procurement/${procurement.id}`}
                                    className="flex justify-center items-center w-full px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 shadow-md transition-all transform hover:scale-[1.02]"
                                >
                                    Open Full Details
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- END: Drawer Components ---


const BudgetTabContent: React.FC<{ versions: BudgetVersion[], selectedVersionId: string, onVersionChange: (id: string) => void }> = ({ versions, selectedVersionId, onVersionChange }) => {
    
    const selectedVersion = versions.find(v => v.id === selectedVersionId);
    
    // Filter line items based on selected version
    const items = budgetLineItems.filter(item => item.budgetVersionId === selectedVersionId);
    
    // Calculate totals for the selected version
    const totalBudget = items.reduce((sum, item) => sum + item.budgetedAmount, 0);
    const totalSpent = items.reduce((sum, item) => sum + item.actualAmount, 0);

    const budgetByCategory = Object.values(BudgetCategory).map(category => {
        const total = items
            .filter(item => item.category === category)
            .reduce((sum, item) => sum + item.budgetedAmount, 0);
        return { name: category, value: total };
    }).filter(d => d.value > 0);

    const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f97316', '#ef4444', '#6366f1', '#f59e0b'];

    const getVarianceClass = (variance: number) => {
        if (variance > 0) return 'text-green-500';
        if (variance < 0) return 'text-red-500';
        return 'text-gray-500 dark:text-gray-300';
    }
    
    const budgetProgress = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
                <Card>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Budget Line Items</h3>
                        <div className="mt-2 sm:mt-0 sm:w-72">
                            <select 
                                id="budget-version-select"
                                value={selectedVersionId} 
                                onChange={e => onVersionChange(e.target.value)}
                                className="w-full px-4 py-2 text-gray-700 bg-white dark:bg-gray-900 dark:text-gray-300 border rounded-md focus:border-primary-500 focus:ring-primary-500 focus:outline-none focus:ring focus:ring-opacity-40"
                                aria-label="Select budget version"
                            >
                                {versions.map(v => (
                                    <option key={v.id} value={v.id}>
                                        {`V${v.version}: ${v.name} ${v.status === 'Active' ? '(Active)' : `(${v.status})`}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                     {selectedVersion?.status !== 'Active' && (
                        <div className="mb-4 p-3 text-sm text-yellow-800 bg-yellow-100 rounded-lg dark:bg-yellow-900 dark:text-yellow-300" role="alert">
                            You are viewing an {selectedVersion?.status.toLowerCase()} version of the budget.
                        </div>
                    )}
                     <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Category</th>
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Description</th>
                                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Budgeted</th>
                                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actual</th>
                                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Variance</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {items.map((item) => {
                                    const variance = item.budgetedAmount - item.actualAmount;
                                    return (
                                        <tr key={item.id}>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{item.category}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{item.description}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm text-right text-gray-500 dark:text-gray-300">{formatCurrency(item.budgetedAmount)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm text-right text-gray-500 dark:text-gray-300">{formatCurrency(item.actualAmount)}</td>
                                            <td className={`px-4 py-4 whitespace-nowrap text-sm text-right font-medium ${getVarianceClass(variance)}`}>{formatCurrency(variance)}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>
            <div className="space-y-6">
                 <Card>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Budget Utilization</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{formatCurrency(totalSpent)} spent out of {formatCurrency(totalBudget)}</p>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
                        <div className="bg-primary-600 h-4 rounded-full text-center text-white text-xs" style={{ width: `${budgetProgress}%` }}>
                            {Math.round(budgetProgress)}%
                        </div>
                    </div>
                </Card>
                <Card>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Allocation by Category</h3>
                     <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                            <Pie
                                data={budgetByCategory}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey="value"
                                nameKey="name"
                            >
                                {budgetByCategory.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', border: 'none' }} />
                            <Legend iconSize={10} />
                        </PieChart>
                    </ResponsiveContainer>
                </Card>
            </div>
        </div>
    );
}

const ProcurementTabContent: React.FC<{ projectId: string }> = ({ projectId }) => {
    // Replaced navigation with Drawer state
    const [selectedProcurement, setSelectedProcurement] = useState<Procurement | null>(null);
    const [filterType, setFilterType] = useState<'All' | 'Pending' | 'Completed'>('All');
    
    const projectProcurements = procurements.filter(p => p.projectId === projectId);

    // KPI Calculations
    const totalCommitted = projectProcurements
        .filter(p => [ProcurementStatus.Ordered, ProcurementStatus.Received, ProcurementStatus.VendorInvoiced, ProcurementStatus.Paid].includes(p.status))
        .reduce((acc, p) => acc + p.totalValue, 0);

    const pendingApprovals = projectProcurements.filter(p => p.status === ProcurementStatus.Requested).length;
    
    const activeOrders = projectProcurements.filter(p => 
        [ProcurementStatus.Ordered, ProcurementStatus.VendorInvoiced].includes(p.status)
    ).length;

    const uniqueVendors = new Set(projectProcurements.map(p => p.vendorId).filter(Boolean)).size;

    // Filter Logic
    const filteredProcurements = projectProcurements.filter(p => {
        if (filterType === 'Pending') return [ProcurementStatus.Draft, ProcurementStatus.Requested, ProcurementStatus.Approved, ProcurementStatus.VendorQuoted].includes(p.status);
        if (filterType === 'Completed') return [ProcurementStatus.Received, ProcurementStatus.Paid, ProcurementStatus.Cancelled].includes(p.status);
        return true;
    }).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Chart Data: Spend by Vendor
    const spendByVendor = projectProcurements.reduce((acc, p) => {
        if (p.totalValue > 0 && p.vendorId) {
            const vendorName = companies.find(c => c.id === p.vendorId)?.name || 'Unknown';
            acc[vendorName] = (acc[vendorName] || 0) + p.totalValue;
        }
        return acc;
    }, {} as Record<string, number>);

    const chartData = Object.entries(spendByVendor).map(([name, value]) => ({ name, value }));
    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

    // Visual Helpers
    const getProgressPercentage = (status: ProcurementStatus) => {
        const steps = [
            ProcurementStatus.Draft,
            ProcurementStatus.Requested,
            ProcurementStatus.Approved,
            ProcurementStatus.VendorQuoted,
            ProcurementStatus.QuoteSelected,
            ProcurementStatus.Ordered,
            ProcurementStatus.Received,
            ProcurementStatus.VendorInvoiced,
            ProcurementStatus.Paid,
        ];
        if (status === ProcurementStatus.Rejected || status === ProcurementStatus.Cancelled) return 100;
        const index = steps.indexOf(status);
        if (index === -1) return 0;
        return Math.round(((index + 1) / steps.length) * 100);
    };

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard 
                    title="Total Committed" 
                    value={formatCurrency(totalCommitted)} 
                    icon={CurrencyDollarIcon} 
                    color="green" 
                />
                <MetricCard 
                    title="Pending Approval" 
                    value={pendingApprovals.toString()} 
                    icon={ClipboardDocumentCheckIcon} 
                    color="orange" 
                />
                <MetricCard 
                    title="Active Orders" 
                    value={activeOrders.toString()} 
                    icon={BuildingOfficeIcon} 
                    color="primary" 
                />
                <MetricCard 
                    title="Engaged Vendors" 
                    value={uniqueVendors.toString()} 
                    icon={UserIcon} 
                    color="primary" 
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Main List */}
                <div className="lg:col-span-3 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                            {(['All', 'Pending', 'Completed'] as const).map(type => (
                                <button
                                    key={type}
                                    onClick={() => setFilterType(type)}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                                        filterType === type 
                                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' 
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                                    }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    <Card className="overflow-hidden p-0">
                        {filteredProcurements.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                                        <tr>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Item Details</th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Vendor & Value</th>
                                            <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lifecycle</th>
                                            <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                        {filteredProcurements.map((item) => {
                                            const progress = getProgressPercentage(item.status);
                                            return (
                                                <tr 
                                                    key={item.id} 
                                                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer group"
                                                    onClick={() => setSelectedProcurement(item)}
                                                >
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center">
                                                             <div className="flex-shrink-0 h-8 w-8 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex items-center justify-center text-xs font-bold mr-3">
                                                                 PR
                                                             </div>
                                                             <div>
                                                                <div className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-primary-600 transition-colors">{item.title}</div>
                                                                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{item.id}</div>
                                                             </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="text-sm text-gray-900 dark:text-white font-medium">{formatCurrency(item.totalValue)}</div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]">
                                                            {companies.find(c => c.id === item.vendorId)?.name || 'Vendor Pending'}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                         <div className="w-full max-w-[140px] mx-auto">
                                                            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                                                                <span>{item.status}</span>
                                                                <span>{progress}%</span>
                                                            </div>
                                                            <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                                                                <div 
                                                                    className={`h-1.5 rounded-full ${item.status === ProcurementStatus.Cancelled ? 'bg-red-500' : 'bg-green-500'}`} 
                                                                    style={{ width: `${progress}%` }}
                                                                ></div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                         <button className="text-gray-400 hover:text-primary-600 dark:hover:text-primary-400">
                                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                            </svg>
                                                         </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-center py-12 text-gray-500 dark:text-gray-400 flex flex-col items-center">
                                <ClipboardDocumentCheckIcon className="w-10 h-10 text-gray-300 mb-2" />
                                <p>No procurement records found.</p>
                            </div>
                        )}
                    </Card>
                </div>

                {/* Sidebar Analytics */}
                <div className="space-y-6">
                    <Card>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-4">Spend by Vendor</h3>
                        {chartData.length > 0 ? (
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={chartData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {chartData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            formatter={(value: number) => formatCurrency(value)}
                                            contentStyle={{ backgroundColor: 'rgba(31, 41, 55, 0.9)', border: 'none', color: '#fff', borderRadius: '8px', fontSize: '12px' }}
                                            itemStyle={{ color: '#fff' }}
                                        />
                                        <Legend 
                                            verticalAlign="bottom" 
                                            height={36} 
                                            iconType="circle"
                                            wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="h-40 flex items-center justify-center text-xs text-gray-400 italic">
                                No financial data to visualize
                            </div>
                        )}
                    </Card>
                    
                    <Card className="bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30">
                         <div className="flex items-start">
                             <div className="flex-shrink-0">
                                <CheckCircleIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                             </div>
                             <div className="ml-3">
                                 <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">Procurement Tip</h3>
                                 <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
                                     <p>Ensure all Purchase Requests over $50k have 3 distinct vendor quotes attached before approval.</p>
                                 </div>
                             </div>
                         </div>
                    </Card>
                </div>
            </div>
            
            {/* Slide-in Drawer */}
            <ProcurementDrawer 
                procurement={selectedProcurement} 
                onClose={() => setSelectedProcurement(null)} 
            />
        </div>
    );
}

const TimesheetsTabContent: React.FC<{ projectId: string }> = ({ projectId }) => {
    const projectTimesheetEntries = timesheetEntries
        .filter(entry => entry.projectId === projectId)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return (
        <Card>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Logged Time</h3>
            {projectTimesheetEntries.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Engineer</th>
                                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Hours</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Notes</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {projectTimesheetEntries.map((entry) => {
                                // This is inefficient in a real app, should use a map
                                const timesheet = timesheets.find(ts => ts.id === entry.timesheetId);
                                const user = users.find(u => u.id === timesheet?.userId);
                                return (
                                <tr key={entry.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{new Date(entry.date).toLocaleDateString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{user?.name || 'Unknown'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500 dark:text-gray-300">{entry.hours.toFixed(2)}</td>
                                    <td className="px-6 py-4 whitespace-normal text-sm text-gray-500 dark:text-gray-300">{entry.notes}</td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No time has been logged for this project yet.
                </div>
            )}
        </Card>
    );
};

// --- START: Schedule/Gantt Chart Components ---

const TaskStatusBadge: React.FC<{ status: TaskStatus }> = ({ status }) => {
    const statusClasses: Record<TaskStatus, string> = {
        [TaskStatus.ToDo]: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
        [TaskStatus.InProgress]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        [TaskStatus.Done]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        [TaskStatus.Blocked]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    };
    return <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusClasses[status]}`}>{status}</span>;
};

// New Split Gantt Component

const ROW_HEIGHT = 44;

type ViewMode = 'Day' | 'Week' | 'Month';

const ScheduleTabContent: React.FC<{ projectId: string }> = ({ projectId }) => {
    const [tasks, setTasks] = useState<Task[]>(allTasks.filter(t => t.projectId === projectId));
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('Day');
    
    const containerRef = useRef<HTMLDivElement>(null);
    const [lines, setLines] = useState<React.ReactNode[]>([]);

    const dayWidth = useMemo(() => {
        switch (viewMode) {
            case 'Day': return 40;
            case 'Week': return 15;
            case 'Month': return 5;
            default: return 40;
        }
    }, [viewMode]);

    const sortedTasks = useMemo(() => {
        return [...tasks].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    }, [tasks]);

    const { minDate, maxDate: _maxDate, totalDays } = useMemo(() => {
        if (tasks.length === 0) {
            const today = new Date();
            const end = new Date();
            end.setDate(today.getDate() + 30);
            return { minDate: today, maxDate: end, totalDays: 31 };
        }
        const starts = tasks.map(t => new Date(t.startDate));
        const ends = tasks.map(t => new Date(t.endDate));
        // Add padding
        const min = new Date(Math.min(...starts.map(d => d.getTime())));
        min.setDate(min.getDate() - 7); // extra padding for weeks
        const max = new Date(Math.max(...ends.map(d => d.getTime())));
        max.setDate(max.getDate() + 30);
        
        const diff = Math.ceil((max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24));
        return { minDate: min, maxDate: max, totalDays: diff };
    }, [tasks]);

    const days = useMemo(() => Array.from({ length: totalDays }, (_, i) => {
        const d = new Date(minDate);
        d.setDate(d.getDate() + i);
        return d;
    }), [minDate, totalDays]);

    const getDateLeft = useCallback((dateStr: string) => {
        const date = new Date(dateStr);
        const diff = Math.ceil((date.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
        return diff * dayWidth;
    }, [minDate, dayWidth]);

    useLayoutEffect(() => {
        // Calculate dependencies lines
        const newLines: React.ReactNode[] = [];
        const taskMap = new Map<string, { task: Task; index: number }>(
            sortedTasks.map((t, i) => [t.id, { task: t, index: i }])
        );

        sortedTasks.forEach((task, index) => {
            task.dependencies.forEach(depId => {
                const dep = taskMap.get(depId);
                if (!dep) return;

                const startX = getDateLeft(dep.task.endDate) + dayWidth; // End of dependency
                const startY = dep.index * ROW_HEIGHT + ROW_HEIGHT / 2;
                
                const endX = getDateLeft(task.startDate); // Start of current task
                const endY = index * ROW_HEIGHT + ROW_HEIGHT / 2;

                // Simple path logic
                const midX = (startX + endX) / 2;
                const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;

                newLines.push(
                    <path
                        key={`${depId}-${task.id}`}
                        d={path}
                        fill="none"
                        stroke="#9ca3af"
                        strokeWidth="1.5"
                        markerEnd="url(#arrowhead)"
                        className="opacity-50"
                    />
                );
            });
        });
        setLines(newLines);
    }, [sortedTasks, getDateLeft, dayWidth]);


    const handleSaveTask = (task: Task) => {
        if (editingTask && editingTask.id !== 'new') {
            setTasks(prev => prev.map(t => t.id === task.id ? task : t));
        } else {
            const newTask = { ...task, id: `T-${Date.now()}` };
            setTasks(prev => [...prev, newTask]);
        }
        setIsModalOpen(false);
        setEditingTask(null);
    };

    const handleDeleteTask = (taskId: string) => {
        if (window.confirm("Are you sure you want to delete this task?")) {
            setTasks(prev => prev.filter(t => t.id !== taskId));
        }
    };

    const handleAddTask = () => {
        const newTask: Task = {
            id: 'new',
            projectId: projectId,
            name: '',
            startDate: new Date().toISOString().split('T')[0],
            endDate: new Date().toISOString().split('T')[0],
            assigneeId: 0,
            status: TaskStatus.ToDo,
            dependencies: []
        };
        setEditingTask(newTask);
        setIsModalOpen(true);
    };

    const renderHeaderCell = (d: Date, i: number) => {
        if (viewMode === 'Day') {
            return (
                <div key={i} style={{ width: dayWidth }} className={`flex-shrink-0 flex flex-col justify-center items-center border-r border-gray-100 dark:border-gray-700 text-[10px] ${d.getDay() === 0 || d.getDay() === 6 ? 'bg-gray-50 dark:bg-gray-800/50 text-gray-400' : 'text-gray-600 dark:text-gray-300'}`}>
                    <span className="font-bold">{d.getDate()}</span>
                    <span>{d.toLocaleDateString(undefined, {weekday: 'narrow'})}</span>
                </div>
            );
        } else if (viewMode === 'Week') {
             // Only show label on Mondays
             const isMonday = d.getDay() === 1;
             return (
                 <div key={i} style={{ width: dayWidth }} className={`flex-shrink-0 flex flex-col justify-center items-start pl-1 border-gray-100 dark:border-gray-700 text-[10px] ${d.getDay() === 0 ? 'border-r' : ''}`}>
                    {isMonday && (
                        <div className="absolute whitespace-nowrap z-10 font-bold text-gray-600 dark:text-gray-300">
                           Wk {Math.ceil(d.getDate() / 7)} ({d.getDate()})
                        </div>
                    )}
                 </div>
             );
        } else { // Month
             const isFirst = d.getDate() === 1;
             // Approximate check for last day
             const nextD = new Date(d);
             nextD.setDate(d.getDate() + 1);
             const isLast = nextD.getDate() === 1;

             return (
                 <div key={i} style={{ width: dayWidth }} className={`flex-shrink-0 flex flex-col justify-center items-start pl-1 border-gray-100 dark:border-gray-700 text-[10px] ${isLast ? 'border-r' : ''}`}>
                     {isFirst && (
                        <div className="absolute whitespace-nowrap z-10 font-bold text-gray-600 dark:text-gray-300">
                           {d.toLocaleDateString(undefined, { month: 'short', year: '2-digit'})}
                        </div>
                    )}
                 </div>
             );
        }
    };

    return (
        <Card className="flex flex-col h-[calc(100vh-250px)] overflow-hidden p-0">
             <div className="flex flex-col sm:flex-row justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3 sm:space-y-0">
                <div className="flex items-center space-x-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Project Schedule</h3>
                    <div className="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                        {(['Day', 'Week', 'Month'] as ViewMode[]).map(mode => (
                             <button 
                                key={mode}
                                onClick={() => setViewMode(mode)}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === mode ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                             >
                                 {mode}
                             </button>
                        ))}
                    </div>
                </div>
                <button onClick={handleAddTask} className="flex items-center px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 transition-colors">
                    <PlusIcon className="w-4 h-4 mr-2" />
                    Add Task
                </button>
            </div>
            
            <div className="flex flex-1 overflow-hidden">
                {/* Left Panel: Task List */}
                <div className="w-[550px] flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-800 z-10 shadow-lg">
                    {/* Header */}
                    <div className="h-10 bg-gray-100 dark:bg-gray-700 flex items-center px-4 border-b border-gray-200 dark:border-gray-600 font-semibold text-xs text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                         <div className="flex-1">Task Name</div>
                         <div className="w-24 text-center">Status</div>
                         <div className="w-24 text-center">Start</div>
                         <div className="w-24 text-center">End</div>
                         <div className="w-16 text-center">Actions</div>
                    </div>
                    {/* Rows */}
                    <div className="overflow-y-auto overflow-x-hidden">
                         {sortedTasks.map(task => (
                            <div key={task.id} style={{ height: ROW_HEIGHT }} className="flex items-center px-4 border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700 group transition-colors">
                                <div className="flex-1 truncate text-sm font-medium text-gray-900 dark:text-white cursor-pointer hover:underline" title={task.name} onClick={() => { setEditingTask(task); setIsModalOpen(true); }}>
                                    {task.name}
                                </div>
                                <div className="w-24 text-center">
                                    <TaskStatusBadge status={task.status} />
                                </div>
                                <div className="w-24 text-center text-xs text-gray-500 dark:text-gray-400">
                                    {new Date(task.startDate).toLocaleDateString()}
                                </div>
                                 <div className="w-24 text-center text-xs text-gray-500 dark:text-gray-400">
                                    {new Date(task.endDate).toLocaleDateString()}
                                </div>
                                <div className="w-16 flex justify-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => { setEditingTask(task); setIsModalOpen(true); }} className="text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400">
                                        <PencilSquareIcon className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDeleteTask(task.id)} className="text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400">
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Panel: Gantt Chart */}
                <div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 relative" ref={containerRef}>
                     <div style={{ width: totalDays * dayWidth, minHeight: '100%' }} className="relative">
                        {/* Timeline Header */}
                        <div className="sticky top-0 z-20 flex h-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
                            {days.map((d, i) => renderHeaderCell(d, i))}
                        </div>

                        {/* Grid Background */}
                        <div className="absolute inset-0 top-10 pointer-events-none flex">
                            {days.map((d, i) => {
                                let borderClass = 'border-r border-gray-200 dark:border-gray-700/30';
                                if (viewMode === 'Week' && d.getDay() !== 0) borderClass = '';
                                if (viewMode === 'Month') borderClass = ''; // Simplified for month

                                return (
                                <div key={i} style={{ width: dayWidth }} className={`h-full ${borderClass} ${d.getDay() === 0 || d.getDay() === 6 ? 'bg-gray-100/30 dark:bg-gray-800/30' : ''}`}></div>
                            )})}
                        </div>

                         {/* SVG Lines Layer */}
                         <svg className="absolute top-10 left-0 w-full h-full pointer-events-none z-0">
                            <defs>
                                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                    <polygon points="0 0, 10 3.5, 0 7" fill="#9ca3af" />
                                </marker>
                            </defs>
                            {lines}
                        </svg>


                        {/* Bars Container */}
                        <div className="relative z-10 pt-0">
                             {sortedTasks.map((task, _index) => {
                                 const startOffset = getDateLeft(task.startDate);
                                 const endOffset = getDateLeft(task.endDate) + dayWidth;
                                 const width = Math.max(endOffset - startOffset - 4, 4); // ensure min width
                                 
                                 let barColor = 'bg-gray-400';
                                 if (task.status === TaskStatus.Done) barColor = 'bg-green-500';
                                 if (task.status === TaskStatus.InProgress) barColor = 'bg-blue-500';
                                 if (task.status === TaskStatus.Blocked) barColor = 'bg-red-500';

                                 return (
                                     <div key={task.id} style={{ height: ROW_HEIGHT }} className="relative w-full border-b border-gray-100 dark:border-gray-700/50 group">
                                         <div 
                                            onClick={() => { setEditingTask(task); setIsModalOpen(true); }}
                                            style={{ left: startOffset + 2, width: width }}
                                            className={`absolute top-2 bottom-2 rounded-md ${barColor} shadow-sm hover:brightness-110 cursor-pointer flex items-center px-2 transition-all`}
                                         >
                                             {width > 30 && <span className="text-xs text-white font-medium truncate sticky left-0">{task.name}</span>}
                                         </div>
                                     </div>
                                 )
                             })}
                        </div>
                     </div>
                </div>
            </div>
             {isModalOpen && editingTask && (
                <TaskModal task={editingTask} allTasks={tasks} onSave={handleSaveTask} onClose={() => setIsModalOpen(false)} />
            )}
        </Card>
    );
};


interface TaskModalProps {
    task: Task;
    allTasks: Task[];
    onSave: (task: Task) => void;
    onClose: () => void;
}

const TaskModal: React.FC<TaskModalProps> = ({ task, allTasks, onSave, onClose }) => {
    const [formData, setFormData] = useState<Task>(task);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleDependencyChange = (depId: string) => {
        setFormData(prev => {
            const newDeps = prev.dependencies.includes(depId) 
                ? prev.dependencies.filter(id => id !== depId) 
                : [...prev.dependencies, depId];
            return { ...prev, dependencies: newDeps };
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    };

    const availableTasks = allTasks.filter(t => t.id !== task.id);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white">
                        {task.id === 'new' ? 'Create New Task' : 'Edit Task'}
                    </h3>
                </div>
                
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Task Name</label>
                        <input type="text" name="name" id="name" required value={formData.name} onChange={handleChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm text-gray-900 dark:text-white" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Start Date</label>
                            <input type="date" name="startDate" id="startDate" required value={formData.startDate} onChange={handleChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm text-gray-900 dark:text-white" />
                        </div>
                        <div>
                            <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">End Date</label>
                            <input type="date" name="endDate" id="endDate" required value={formData.endDate} onChange={handleChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm text-gray-900 dark:text-white" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                         <div>
                            <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
                            <select name="status" id="status" value={formData.status} onChange={handleChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm text-gray-900 dark:text-white">
                                {Object.values(TaskStatus).map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="assigneeId" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Assignee</label>
                             <select name="assigneeId" id="assigneeId" value={formData.assigneeId} onChange={handleChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm text-gray-900 dark:text-white">
                                <option value={0}>Unassigned</option>
                                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                         <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Dependencies (Predecessors)</label>
                         <div className="border border-gray-300 dark:border-gray-600 rounded-md max-h-40 overflow-y-auto p-2 space-y-1">
                            {availableTasks.length > 0 ? availableTasks.map(t => (
                                <label key={t.id} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1 rounded">
                                    <input 
                                        type="checkbox" 
                                        checked={formData.dependencies.includes(t.id)} 
                                        onChange={() => handleDependencyChange(t.id)}
                                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" 
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">{t.name}</span>
                                </label>
                            )) : <p className="text-sm text-gray-500 italic">No other tasks available.</p>}
                         </div>
                    </div>
                </form>

                <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-end space-x-3 rounded-b-lg">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700">Cancel</button>
                    <button onClick={handleSubmit} type="button" className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">Save Task</button>
                </div>
            </div>
        </div>
    );
};
// --- END: Schedule/Gantt Chart Components ---

// --- START: Document Components ---

const DocumentStatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const colors: Record<string, string> = {
        'Draft': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
        'Issued': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        'Approved': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        'Rejected': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
        'Closed': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    };
    return (
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors['Draft']}`}>
            {status}
        </span>
    );
};

const DocumentsTabContent: React.FC<{ projectId: string }> = ({ projectId }) => {
    // Local state for documents to allow adding new ones
    const [docs, setDocs] = useState<ProjectDocument[]>(() => 
        projectDocuments.filter(d => d.projectId === projectId)
    );
    const [filterCategory, setFilterCategory] = useState('All');
    const [searchTerm, setSearchTerm] = useState('');

    const filteredDocs = docs.filter(doc => {
        const matchesCategory = filterCategory === 'All' || doc.category === filterCategory;
        const matchesSearch = doc.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                              doc.code.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    const handleUpload = () => {
        // Mock upload
        const newDoc: ProjectDocument = {
            id: `DOC-${Date.now()}`,
            projectId,
            code: `NEW-${Math.floor(Math.random() * 1000)}`,
            category: 'Drawing',
            title: 'New Uploaded Document',
            revision: 'A',
            status: 'Draft',
            date: new Date().toISOString().split('T')[0],
            author: 'Current User'
        };
        setDocs([newDoc, ...docs]);
    };

    const categories = ['All', 'RFI', 'Transmittal', 'Submittal', 'Drawing', 'Specification'];

    return (
        <Card className="min-h-[500px]">
            {/* Header controls: Search, Filter, Upload */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                 <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                    <div className="relative">
                        <input 
                            type="text" 
                            placeholder="Search documents..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent w-full sm:w-64"
                        />
                         <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    <select 
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
                    >
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                 </div>
                 <button 
                    onClick={handleUpload}
                    className="flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                >
                    <CloudArrowUpIcon className="w-5 h-5 mr-2" />
                    Upload Document
                 </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Document Code</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Title</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Rev</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {filteredDocs.length > 0 ? filteredDocs.map((doc) => (
                            <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-primary-600 dark:text-primary-400 font-mono">
                                    {doc.code}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                    <div className="flex items-center">
                                        <DocumentIcon className="w-4 h-4 text-gray-400 mr-2" />
                                        {doc.title}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300`}>
                                        {doc.category}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300 text-center">
                                    {doc.revision}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <DocumentStatusBadge status={doc.status} />
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                    {new Date(doc.date).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button className="text-gray-400 hover:text-primary-600 dark:hover:text-primary-400">
                                        <EyeIcon className="w-5 h-5" />
                                    </button>
                                </td>
                            </tr>
                        )) : (
                             <tr>
                                <td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                    <div className="flex flex-col items-center">
                                        <DocumentIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-2" />
                                        <p>No documents found matching your filters.</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </Card>
    );
};

// --- END: Document Components ---

const ProjectDetails: React.FC = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const [activeTab, setActiveTab] = useState('Overview');

    const project = projects.find(p => p.id === projectId);
    const projectVersions = budgetVersions.filter(v => v.projectId === projectId);
    const activeVersion = projectVersions.find(v => v.status === 'Active');
    const [selectedVersionId, setSelectedVersionId] = useState(activeVersion?.id || projectVersions[0]?.id);

    if (!project) {
        return <Navigate to="/projects" replace />;
    }

    const projectManager = users.find(u => u.id === project.projectManagerId);
    const client = companies.find(c => c.id === project.clientId);

    const grossMargin = project.contractValue - project.spent;
    const grossMarginPercent = project.contractValue > 0 ? (grossMargin / project.contractValue) * 100 : 0;
    
    // Task Progress Calculation
    const projectTasks = allTasks.filter(t => t.projectId === project.id);
    const completedTasks = projectTasks.filter(t => t.status === TaskStatus.Done).length;
    const totalTasks = projectTasks.length;
    const projectProgress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    const tabs = ['Overview', 'Budget', 'Schedule', 'Timesheets', 'Procurement', 'Documents'];

    const renderTabContent = () => {
        switch(activeTab) {
            case 'Overview':
                return (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 space-y-6">
                            <Card>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Project Information</h3>
                                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-6 text-sm">
                                     <div className="flex items-start">
                                        <UserIcon className="w-5 h-5 mr-3 text-gray-400 mt-0.5"/>
                                        <div>
                                            <dt className="text-gray-500 dark:text-gray-400">Project Manager</dt>
                                            <dd className="font-medium text-gray-900 dark:text-white">{projectManager?.name || 'N/A'}</dd>
                                        </div>
                                     </div>
                                      <div className="flex items-start">
                                        <BuildingOfficeIcon className="w-5 h-5 mr-3 text-gray-400 mt-0.5"/>
                                        <div>
                                            <dt className="text-gray-500 dark:text-gray-400">Client</dt>
                                            <dd className="font-medium text-gray-900 dark:text-white">{client?.name || 'N/A'}</dd>
                                        </div>
                                     </div>
                                     <div className="flex items-start">
                                        <CalendarDaysIcon className="w-5 h-5 mr-3 text-gray-400 mt-0.5"/>
                                        <div>
                                            <dt className="text-gray-500 dark:text-gray-400">Start Date</dt>
                                            <dd className="font-medium text-gray-900 dark:text-white">{new Date(project.startDate).toLocaleDateString()}</dd>
                                        </div>
                                     </div>
                                     <div className="flex items-start">
                                        <CalendarDaysIcon className="w-5 h-5 mr-3 text-gray-400 mt-0.5"/>
                                        <div>
                                            <dt className="text-gray-500 dark:text-gray-400">End Date</dt>
                                            <dd className="font-medium text-gray-900 dark:text-white">{new Date(project.endDate).toLocaleDateString()}</dd>
                                        </div>
                                     </div>
                                </dl>
                            </Card>
                            <Card>
                                 <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Project Progress</h3>
                                 <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                     {totalTasks > 0 ? `${completedTasks} of ${totalTasks} tasks completed` : "No tasks defined"}
                                 </p>
                                 <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
                                    <div className="bg-primary-600 h-4 rounded-full text-center text-white text-xs" style={{ width: `${projectProgress}%` }}>
                                        {Math.round(projectProgress)}%
                                    </div>
                                </div>
                            </Card>
                        </div>
                        <div className="space-y-6">
                            <Card>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Team Members</h3>
                                <ul className="space-y-3">
                                    {[...users].slice(0,4).map(user => (
                                        <li key={user.id} className="flex items-center">
                                            <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full mr-3"/>
                                            <div>
                                                <p className="text-sm font-medium text-gray-900 dark:text-white">{user.name}</p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">{user.id === project.projectManagerId ? 'Project Manager' : 'Engineer'}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        </div>
                    </div>
                );
             case 'Budget':
                return projectVersions.length > 0 ? (
                    <BudgetTabContent 
                        versions={projectVersions} 
                        selectedVersionId={selectedVersionId}
                        onVersionChange={setSelectedVersionId}
                    />
                ) : (
                     <Card className="h-64 flex items-center justify-center">
                        <div className="text-center">
                            <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300">No Budget Data</h3>
                            <p className="text-gray-500 dark:text-gray-400">Detailed budget information is not available for this project.</p>
                        </div>
                    </Card>
                );
            case 'Schedule':
                return <ScheduleTabContent projectId={project.id} />;
             case 'Procurement':
                return <ProcurementTabContent projectId={project.id} />;
            case 'Timesheets':
                return <TimesheetsTabContent projectId={project.id} />;
            case 'Documents':
                return <DocumentsTabContent projectId={project.id} />;
            default:
                return (
                    <Card className="h-64 flex items-center justify-center">
                        <div className="text-center">
                            <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300">{activeTab}</h3>
                            <p className="text-gray-500 dark:text-gray-400">Content for this section is not yet available.</p>
                        </div>
                    </Card>
                );
        }
    }


    return (
        <div className="space-y-6 h-full flex flex-col">
            <Card className="flex-shrink-0">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div className="mb-4 sm:mb-0">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{project.name}</h2>
                        <div className="flex items-center space-x-2 mt-1">
                            <ProjectStatusBadge status={project.status} />
                            <span className="text-sm text-gray-500 dark:text-gray-400">Last updated: {new Date(project.lastUpdate).toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div className="flex space-x-2">
                        <button className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">Edit Project</button>
                        <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600">Actions</button>
                    </div>
                </div>
                {activeTab === 'Overview' && (
                    <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <MetricCard title="Contract Value" value={formatCurrency(project.contractValue)} icon={CurrencyDollarIcon} color="primary" />
                        <MetricCard title="Budget" value={formatCurrency(project.budget)} icon={CurrencyDollarIcon} color="primary" />
                        <MetricCard title="Spent" value={formatCurrency(project.spent)} icon={CurrencyDollarIcon} color="primary" />
                        <MetricCard title="Gross Margin" value={`${grossMarginPercent.toFixed(1)}%`} icon={CurrencyDollarIcon} color="green" />
                    </div>
                )}
            </Card>

            <div className="flex-1 flex flex-col min-h-0">
                <div className="border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                    <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Tabs">
                        {tabs.map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`${
                                    activeTab === tab
                                        ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:border-gray-600'
                                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
                            >
                                {tab}
                            </button>
                        ))}
                    </nav>
                </div>
                <div className="mt-6 flex-1 flex flex-col min-h-0">
                    {renderTabContent()}
                </div>
            </div>
        </div>
    );
};

export default ProjectDetails;
