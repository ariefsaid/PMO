
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { projects, companies, users } from '../data/mockData';
import { Project, ProjectStatus, Company, User } from '../types';
import ProjectStatusBadge from '../components/ProjectStatusBadge';
import ProjectKanbanBoard from '../components/ProjectKanbanBoard';
import { useUser } from '../context/UserContext';
import { 
    Squares2X2Icon, 
    TableCellsIcon, 
    PlusIcon, 
    BuildingOfficeIcon, 
    UserIcon, 
    CalendarDaysIcon, 
    ClipboardDocumentCheckIcon,
    ChartBarIcon
} from '../components/icons';

type ViewMode = 'Grid' | 'List' | 'Board';
type TabType = 'All' | 'My Projects' | 'Ongoing' | 'Leads' | 'Completed';

type SortConfig = {
    key: keyof Project;
    direction: 'ascending' | 'descending';
} | null;

const Projects: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser } = useUser();
    
    // UI States
    const [viewMode, setViewMode] = useState<ViewMode>('Grid');
    const [activeTab, setActiveTab] = useState<TabType>('All');
    
    // Filters
    const [filterClient, setFilterClient] = useState<string>('All');
    const [filterPM, setFilterPM] = useState<string>('All');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [sortConfig, setSortConfig] = useState<SortConfig>(null);

    // Filter Logic
    const filteredProjects = useMemo(() => {
        let filtered = [...projects];

        // 1. Tab Logic
        switch (activeTab) {
            case 'My Projects':
                filtered = filtered.filter(p => p.projectManagerId === currentUser.id);
                break;
            case 'Ongoing':
                filtered = filtered.filter(p => [ProjectStatus.Ongoing, ProjectStatus.WonPendingKoM, ProjectStatus.OnHold].includes(p.status));
                break;
            case 'Leads':
                filtered = filtered.filter(p => 
                    [ProjectStatus.Leads, ProjectStatus.PQSubmitted, ProjectStatus.QuotationSubmitted, ProjectStatus.TenderSubmitted, ProjectStatus.Negotiation].includes(p.status)
                );
                break;
            case 'Completed':
                filtered = filtered.filter(p => 
                    [ProjectStatus.CloseOut, ProjectStatus.Loss].includes(p.status)
                );
                break;
            case 'All':
            default:
                break;
        }

        // 2. Dropdown Filters
        if (filterClient !== 'All') {
            filtered = filtered.filter(p => p.clientId === parseInt(filterClient, 10));
        }
        if (filterPM !== 'All') {
            filtered = filtered.filter(p => p.projectManagerId === parseInt(filterPM, 10));
        }
        
        // 3. Search
        if (searchTerm) {
            filtered = filtered.filter(p => 
                p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.id.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        return filtered;
    }, [activeTab, filterClient, filterPM, searchTerm, currentUser.id]);

    const sortedProjects = useMemo(() => {
        let sortableItems = [...filteredProjects];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredProjects, sortConfig]);

    const requestSort = (key: keyof Project) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const getSortIndicator = (key: keyof Project) => {
        if (!sortConfig || sortConfig.key !== key) return null;
        return sortConfig.direction === 'ascending' ? '▲' : '▼';
    };

    const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

    // Visual Helpers - Updated for new statuses
    const getStatusColorBorder = (status: ProjectStatus) => {
        switch(status) {
            case ProjectStatus.Ongoing: return 'bg-green-500';
            case ProjectStatus.WonPendingKoM: return 'bg-teal-500';
            case ProjectStatus.Leads: return 'bg-gray-400';
            case ProjectStatus.Negotiation: return 'bg-orange-500';
            case ProjectStatus.TenderSubmitted: 
            case ProjectStatus.QuotationSubmitted: return 'bg-yellow-500';
            case ProjectStatus.Loss: return 'bg-red-500';
            case ProjectStatus.CloseOut: return 'bg-purple-500';
            case ProjectStatus.Internal: return 'bg-slate-500';
            default: return 'bg-primary-500';
        }
    };

    // Tab Counts
    const counts = useMemo(() => ({
        'All': projects.length,
        'My Projects': projects.filter(p => p.projectManagerId === currentUser.id).length,
        'Ongoing': projects.filter(p => [ProjectStatus.Ongoing, ProjectStatus.WonPendingKoM, ProjectStatus.OnHold].includes(p.status)).length,
        'Leads': projects.filter(p => [ProjectStatus.Leads, ProjectStatus.PQSubmitted, ProjectStatus.QuotationSubmitted, ProjectStatus.TenderSubmitted, ProjectStatus.Negotiation].includes(p.status)).length,
        'Completed': projects.filter(p => [ProjectStatus.CloseOut, ProjectStatus.Loss].includes(p.status)).length,
    }), [currentUser.id]);

    const renderContent = () => {
        if (viewMode === 'Board') {
            return <ProjectKanbanBoard projects={filteredProjects} />;
        }

        if (viewMode === 'Grid') {
            return (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sortedProjects.map((project) => {
                         const client = companies.find(c => c.id === project.clientId);
                         const pm = users.find(u => u.id === project.projectManagerId);
                         const progress = project.budget > 0 ? (project.spent / project.budget) * 100 : 0;
                         const margin = project.contractValue - project.spent;
                         
                         return (
                            <div 
                                key={project.id} 
                                onClick={() => navigate(`/projects/${project.id}`)}
                                className="group bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col h-full"
                            >
                                {/* Top colored border indicator */}
                                <div className={`h-1 w-full ${getStatusColorBorder(project.status)}`}></div>

                                <div className="p-5 flex-1 flex flex-col">
                                    {/* Header: Status & ID */}
                                    <div className="flex justify-between items-start mb-3">
                                        <ProjectStatusBadge status={project.status} />
                                        <span className="text-[10px] font-mono font-medium text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                                            {project.id}
                                        </span>
                                    </div>

                                    {/* Body: Title */}
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white line-clamp-2 mb-4 group-hover:text-primary-600 transition-colors">
                                        {project.name}
                                    </h3>

                                    {/* Metadata */}
                                    <div className="space-y-2 mt-auto">
                                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                                            <BuildingOfficeIcon className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                                            <span className="truncate">{client?.name || 'Unknown Client'}</span>
                                        </div>
                                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                                            <UserIcon className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                                            <span className="truncate">{pm?.name || 'Unassigned'}</span>
                                        </div>
                                         <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                                            <CalendarDaysIcon className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                                            <span>Ends: {new Date(project.endDate).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer: Value & Mini Progress */}
                                <div className="bg-gray-50 dark:bg-gray-700/30 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                                    <div className="flex flex-col">
                                        <span className="text-xs text-gray-500 font-medium uppercase">Contract Value</span>
                                        <span className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(project.contractValue)}</span>
                                    </div>
                                    <div className="w-24 text-right">
                                         <div className="flex justify-end text-[10px] text-gray-400 mb-1 space-x-2">
                                            <span>Spent</span>
                                            <span className={progress > 100 ? 'text-red-500 font-bold' : ''}>{Math.round(progress)}%</span>
                                         </div>
                                         <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                                            <div 
                                                className={`h-1.5 rounded-full ${progress > 100 ? 'bg-red-500' : 'bg-primary-600'}`} 
                                                style={{ width: `${Math.min(progress, 100)}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                         );
                    })}
                </div>
            )
        }
        
        // List View
        return (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                {[
                                    { key: 'name', label: 'Project Name' },
                                    { key: 'clientId', label: 'Client' },
                                    { key: 'projectManagerId', label: 'Manager' },
                                    { key: 'status', label: 'Status' },
                                    { key: 'contractValue', label: 'Value' },
                                    { key: 'endDate', label: 'End Date' }
                                ].map(({ key, label }) => (
                                    <th key={key} scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200" onClick={() => requestSort(key as keyof Project)}>
                                        <div className="flex items-center">
                                            {label} 
                                            <span className="ml-1 text-gray-400">{getSortIndicator(key as keyof Project)}</span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {sortedProjects.map((project) => (
                                <tr key={project.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors" onClick={() => navigate(`/projects/${project.id}`)}>
                                    <td className="px-6 py-4">
                                        <div className="text-sm font-medium text-gray-900 dark:text-white">{project.name}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{project.id}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{companies.find(c => c.id === project.clientId)?.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{users.find(u => u.id === project.projectManagerId)?.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm"><ProjectStatusBadge status={project.status} /></td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(project.contractValue)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{new Date(project.endDate).toLocaleDateString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Projects Overview</h2>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Manage ongoing projects, track leads, and review project history.</p>
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
                        <button 
                            onClick={() => setViewMode('Board')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'Board' ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                            title="Board View (CRM)"
                        >
                            <ChartBarIcon className="w-5 h-5 transform rotate-90" />
                        </button>
                    </div>
                    <button className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 shadow-sm transition-colors">
                        <PlusIcon className="w-5 h-5 mr-2" />
                        New Project
                    </button>
                </div>
            </div>

            {/* Smart Tabs & Filters */}
            <div className="flex flex-col space-y-4">
                 {/* Tabs */}
                 <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-1 flex overflow-x-auto space-x-1 w-full no-scrollbar">
                    {(['All', 'My Projects', 'Ongoing', 'Leads', 'Completed'] as TabType[]).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 min-w-[100px] px-4 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
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

                {/* Secondary Filters - Hide in board view if desired, but good to have */}
                <div className="flex flex-col md:flex-row gap-4">
                     <div className="relative flex-1">
                        <input 
                            type="text" 
                            placeholder="Search projects by name or ID..." 
                            value={searchTerm} 
                            onChange={e => setSearchTerm(e.target.value)} 
                            className="w-full px-4 py-2 pl-10 text-sm text-gray-700 bg-white dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg focus:border-primary-500 focus:ring-primary-500 focus:outline-none transition-shadow shadow-sm" 
                        />
                        <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>
                    <select value={filterClient} onChange={e => setFilterClient(e.target.value)} className="w-full md:w-48 px-4 py-2 text-sm text-gray-700 bg-white dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg focus:border-primary-500 focus:ring-primary-500 focus:outline-none shadow-sm">
                        <option value="All">All Clients</option>
                        {companies.filter(c => c.type === 'Client').map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
                    </select>
                    <select value={filterPM} onChange={e => setFilterPM(e.target.value)} className="w-full md:w-48 px-4 py-2 text-sm text-gray-700 bg-white dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg focus:border-primary-500 focus:ring-primary-500 focus:outline-none shadow-sm">
                        <option value="All">All Managers</option>
                        {users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
                    </select>
                </div>
            </div>

            {/* Content Area */}
            {renderContent()}
            
            {sortedProjects.length === 0 && (
                <div className="text-center py-16 px-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                        <ClipboardDocumentCheckIcon className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">No projects found</h3>
                    <p className="mt-1 text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                        We couldn't find any projects matching your current filters.
                    </p>
                    <button onClick={() => { setActiveTab('All'); setFilterClient('All'); setFilterPM('All'); setSearchTerm(''); }} className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm">
                        Clear all filters
                    </button>
                </div>
            )}
        </div>
    );
};

export default Projects;
