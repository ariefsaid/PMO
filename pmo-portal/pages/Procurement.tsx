
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { procurements, projects, companies } from '../data/mockData';
import { ProcurementStatus } from '../types';
import ProcurementStatusBadge from '../components/ProcurementStatusBadge';
import { PlusIcon, BuildingOfficeIcon, UserIcon, CalendarDaysIcon, ClipboardDocumentCheckIcon, Squares2X2Icon, TableCellsIcon } from '../components/icons';
import { useUser } from '../context/UserContext';

const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

type TabType = 'All' | 'My Requests' | 'To Approve' | 'Active Orders';
type ViewMode = 'Grid' | 'List';

const ProcurementPage: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser } = useUser();
    
    // UI States
    const [activeTab, setActiveTab] = useState<TabType>('My Requests');
    const [viewMode, setViewMode] = useState<ViewMode>('Grid');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Filter Logic
    const getFilteredProcurements = () => {
        let filtered = [...procurements];

        // 1. Apply Tab Logic
        switch(activeTab) {
            case 'My Requests':
                filtered = filtered.filter(p => p.requestedById === currentUser.id);
                break;
            case 'To Approve':
                // In a real app, this would check permissions. For now, assuming Managers/Executives approve.
                // Showing items that are in 'Requested' state (needing approval)
                filtered = filtered.filter(p => p.status === ProcurementStatus.Requested);
                break;
            case 'Active Orders':
                // Orders that are placed but not yet Paid/Closed
                filtered = filtered.filter(p => [
                    ProcurementStatus.Ordered, 
                    ProcurementStatus.Received, 
                    ProcurementStatus.VendorInvoiced
                ].includes(p.status));
                break;
            case 'All':
            default:
                // No pre-filter
                break;
        }

        // 2. Apply Search
        if (searchTerm) {
            filtered = filtered.filter(p => 
                p.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                p.id.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        return filtered.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    };

    const filteredProcurements = getFilteredProcurements();

    // Counts for Tabs
    const counts = useMemo(() => ({
        'My Requests': procurements.filter(p => p.requestedById === currentUser.id).length,
        'To Approve': procurements.filter(p => p.status === ProcurementStatus.Requested).length,
        'Active Orders': procurements.filter(p => [ProcurementStatus.Ordered, ProcurementStatus.Received, ProcurementStatus.VendorInvoiced].includes(p.status)).length,
        'All': procurements.length
    }), [currentUser.id]);

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

    const getStatusColor = (status: ProcurementStatus) => {
        switch(status) {
            case ProcurementStatus.Paid: return 'bg-green-500';
            case ProcurementStatus.Rejected:
            case ProcurementStatus.Cancelled: return 'bg-red-500';
            case ProcurementStatus.Ordered: return 'bg-orange-500';
            case ProcurementStatus.Requested: return 'bg-blue-500';
            default: return 'bg-primary-500';
        }
    };
    
    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Procurement Overview</h2>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Manage purchasing requests, approvals, and orders.</p>
                </div>
                <div className="flex items-center space-x-3 mt-4 md:mt-0">
                     <div className="flex bg-white dark:bg-gray-800 p-1 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                        <button 
                            onClick={() => setViewMode('Grid')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'Grid' ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                            title="Grid View"
                        >
                            <Squares2X2Icon className="w-5 h-5" />
                        </button>
                         <button 
                            onClick={() => setViewMode('List')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'List' ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                            title="List View"
                        >
                            <TableCellsIcon className="w-5 h-5" />
                        </button>
                    </div>
                    <button onClick={() => setIsModalOpen(true)} className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 shadow-sm transition-colors">
                        <PlusIcon className="w-5 h-5 mr-2" />
                        New Request
                    </button>
                </div>
            </div>

            {/* Smart Tabs & Search Row */}
            <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
                 <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-1 flex overflow-x-auto space-x-1 w-full lg:w-auto no-scrollbar">
                    {(['My Requests', 'To Approve', 'Active Orders', 'All'] as TabType[]).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 min-w-[120px] px-4 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                                activeTab === tab
                                    ? 'bg-primary-50 text-primary-700 dark:bg-gray-700 dark:text-primary-400 shadow-sm'
                                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}
                        >
                            {tab}
                            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                                activeTab === tab 
                                ? 'bg-primary-200 text-primary-800 dark:bg-primary-900 dark:text-primary-300' 
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-600 dark:text-gray-300'
                            }`}>
                                {counts[tab]}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="relative w-full lg:w-96">
                    <input 
                        type="text" 
                        placeholder="Search procurements..." 
                        value={searchTerm} 
                        onChange={e => setSearchTerm(e.target.value)} 
                        className="w-full px-4 py-2 pl-10 text-sm text-gray-700 bg-white dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg focus:border-primary-500 focus:ring-primary-500 focus:outline-none transition-shadow shadow-sm" 
                    />
                    <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                </div>
            </div>

            {/* Content Area */}
            {viewMode === 'Grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredProcurements.map((procurement) => {
                         const project = projects.find(p => p.id === procurement.projectId);
                         const vendor = companies.find(c => c.id === procurement.vendorId);
                         const progress = getProgressPercentage(procurement.status);

                         return (
                            <div 
                                key={procurement.id} 
                                onClick={() => navigate(`/procurement/${procurement.id}`)}
                                className="group bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col h-full"
                            >
                                {/* Top colored border indicator */}
                                <div className={`h-1 w-full ${getStatusColor(procurement.status)}`}></div>

                                <div className="p-5 flex-1 flex flex-col">
                                    {/* Header: Status & ID */}
                                    <div className="flex justify-between items-start mb-3">
                                        <ProcurementStatusBadge status={procurement.status} />
                                        <span className="text-[10px] font-mono font-medium text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                                            {procurement.id}
                                        </span>
                                    </div>

                                    {/* Body: Title */}
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white line-clamp-2 mb-4 group-hover:text-primary-600 transition-colors">
                                        {procurement.title}
                                    </h3>

                                    {/* Metadata */}
                                    <div className="space-y-2 mt-auto">
                                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                                            <BuildingOfficeIcon className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                                            <span className="truncate" title={project?.name}>{project?.name || 'Unknown Project'}</span>
                                        </div>
                                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                                            <UserIcon className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                                            <span className="truncate">{vendor?.name || 'Vendor Pending'}</span>
                                        </div>
                                         <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                                            <CalendarDaysIcon className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                                            <span>{new Date(procurement.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer: Value & Mini Progress */}
                                <div className="bg-gray-50 dark:bg-gray-700/30 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                                    <div className="flex flex-col">
                                        <span className="text-xs text-gray-500 font-medium uppercase">Value</span>
                                        <span className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(procurement.totalValue)}</span>
                                    </div>
                                    <div className="w-20">
                                         <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                                            <span>Progress</span>
                                            <span>{progress}%</span>
                                         </div>
                                         <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                                            <div className={`h-1.5 rounded-full ${getStatusColor(procurement.status)}`} style={{ width: `${progress}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                         );
                    })}
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Reference</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Project & Title</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Vendor</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Value</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {filteredProcurements.map((procurement) => {
                                     const project = projects.find(p => p.id === procurement.projectId);
                                     const vendor = companies.find(c => c.id === procurement.vendorId);
                                     return (
                                        <tr 
                                            key={procurement.id} 
                                            onClick={() => navigate(`/procurement/${procurement.id}`)}
                                            className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                                        >
                                            <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-500 dark:text-gray-400">{procurement.id}</td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm font-medium text-gray-900 dark:text-white">{procurement.title}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">{project?.name}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{vendor?.name || '-'}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{new Date(procurement.createdAt).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 whitespace-nowrap"><ProcurementStatusBadge status={procurement.status} /></td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(procurement.totalValue)}</td>
                                        </tr>
                                     )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {filteredProcurements.length === 0 && (
                <div className="text-center py-16 px-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                        <ClipboardDocumentCheckIcon className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">No requests found</h3>
                    <p className="mt-1 text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                        We couldn't find any procurement requests matching the current tab and search filters.
                    </p>
                    {activeTab !== 'All' && (
                        <button onClick={() => setActiveTab('All')} className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm">
                            View all requests
                        </button>
                    )}
                </div>
            )}

            {/* Modal Placeholder */}
            {isModalOpen && (
                 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm" role="dialog" aria-modal="true">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg p-6 transform transition-all scale-100">
                        <div className="text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
                                <PlusIcon className="h-6 w-6 text-primary-600 dark:text-primary-400" aria-hidden="true" />
                            </div>
                            <h3 className="mt-4 text-lg font-semibold leading-6 text-gray-900 dark:text-white">Create Purchase Request</h3>
                            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                                Start a new procurement workflow. This would open a form to select projects, add items, and attach specifications.
                            </p>
                            <div className="mt-6 flex justify-center space-x-3">
                                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600">
                                    Cancel
                                </button>
                                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium shadow-lg shadow-primary-500/30">
                                    Start Request
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProcurementPage;
