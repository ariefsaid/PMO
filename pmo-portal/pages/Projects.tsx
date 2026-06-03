
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProjectStatus } from '../types';
import ProjectStatusBadge from '../components/ProjectStatusBadge';
import ProjectKanbanBoard from '../components/ProjectKanbanBoard';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProjects, useClientCompanies, useProjectManagers } from '@/src/hooks/useProjects';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
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
    key: keyof ProjectWithRefs;
    direction: 'ascending' | 'descending';
} | null;

const Projects: React.FC = () => {
    const navigate = useNavigate();
    useEffectiveRole(); // still used for ImpersonationProvider wiring in Shell

    const { currentUser } = useAuth();
    const { data: projectsData, isPending, isError, refetch } = useProjects();
    const { data: clientCompanies = [] } = useClientCompanies();
    const { data: projectManagers = [] } = useProjectManagers();
    const allProjects = useMemo<ProjectWithRefs[]>(() => projectsData ?? [], [projectsData]);

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
        let filtered = [...allProjects];

        // 1. Tab Logic
        switch (activeTab) {
            case 'My Projects':
                filtered = filtered.filter(p => p.project_manager_id === currentUser?.id);
                break;
            case 'Ongoing':
                filtered = filtered.filter(p => [ProjectStatus.Ongoing, ProjectStatus.WonPendingKoM, ProjectStatus.OnHold].includes(p.status as ProjectStatus));
                break;
            case 'Leads':
                filtered = filtered.filter(p =>
                    [ProjectStatus.Leads, ProjectStatus.PQSubmitted, ProjectStatus.QuotationSubmitted, ProjectStatus.TenderSubmitted, ProjectStatus.Negotiation].includes(p.status as ProjectStatus)
                );
                break;
            case 'Completed':
                filtered = filtered.filter(p =>
                    [ProjectStatus.CloseOut, ProjectStatus.Loss].includes(p.status as ProjectStatus)
                );
                break;
            case 'All':
            default:
                break;
        }

        // 2. Dropdown Filters
        if (filterClient !== 'All') {
            filtered = filtered.filter(p => p.client_id === filterClient);
        }
        if (filterPM !== 'All') {
            filtered = filtered.filter(p => p.project_manager_id === filterPM);
        }

        // 3. Search (name or code; id is now uuid so use code instead)
        if (searchTerm) {
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (p.code ?? '').toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        return filtered;
    }, [activeTab, filterClient, filterPM, searchTerm, currentUser?.id, allProjects]);

    const sortedProjects = useMemo(() => {
        const sortableItems = [...filteredProjects];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                const aVal = a[sortConfig.key];
                const bVal = b[sortConfig.key];
                if (aVal == null) return 1;
                if (bVal == null) return -1;
                if (aVal < bVal) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [filteredProjects, sortConfig]);

    const requestSort = (key: keyof ProjectWithRefs) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const getSortIndicator = (key: keyof ProjectWithRefs) => {
        if (!sortConfig || sortConfig.key !== key) return null;
        return sortConfig.direction === 'ascending' ? '▲' : '▼';
    };

    // Visual Helpers - Updated for new statuses
    const getStatusColorBorder = (status: string) => {
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
        'All': allProjects.length,
        'My Projects': allProjects.filter(p => p.project_manager_id === currentUser?.id).length,
        'Ongoing': allProjects.filter(p => [ProjectStatus.Ongoing, ProjectStatus.WonPendingKoM, ProjectStatus.OnHold].includes(p.status as ProjectStatus)).length,
        'Leads': allProjects.filter(p => [ProjectStatus.Leads, ProjectStatus.PQSubmitted, ProjectStatus.QuotationSubmitted, ProjectStatus.TenderSubmitted, ProjectStatus.Negotiation].includes(p.status as ProjectStatus)).length,
        'Completed': allProjects.filter(p => [ProjectStatus.CloseOut, ProjectStatus.Loss].includes(p.status as ProjectStatus)).length,
    }), [currentUser?.id, allProjects]);

    // Loading state
    if (isPending) {
        return <div data-testid="projects-loading" className="animate-pulse space-y-4">
            <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[0, 1, 2].map(i => <div key={i} className="h-48 bg-gray-200 dark:bg-gray-700 rounded-xl" />)}
            </div>
        </div>;
    }

    // Error state
    if (isError) {
        return <div className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Couldn't load projects</h3>
            <p className="mt-1 text-gray-500 dark:text-gray-400">Something went wrong fetching your projects.</p>
            <button onClick={() => refetch()} className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm">Retry</button>
        </div>;
    }

    const renderContent = () => {
        if (viewMode === 'Board') {
            return <ProjectKanbanBoard projects={filteredProjects} />;
        }

        if (viewMode === 'Grid') {
            return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sortedProjects.map((project) => {
                        const progress = project.budget > 0 ? (project.spent / project.budget) * 100 : 0;

                        return (
                            <div
                                key={project.id}
                                onClick={() => navigate(`/projects/${project.id}`)}
                                className="group bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col h-full"
                            >
                                {/* Top colored border indicator */}
                                <div className={`h-1 w-full ${getStatusColorBorder(project.status)}`}></div>

                                <div className="p-5 flex-1 flex flex-col">
                                    {/* Header: Status & Code */}
                                    <div className="flex justify-between items-start mb-3">
                                        <ProjectStatusBadge status={project.status as ProjectStatus} />
                                        <span className="text-[10px] font-mono font-medium text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                                            {project.code ?? project.id.slice(0, 8)}
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
                                            <span className="truncate">{project.client?.name ?? 'Unknown Client'}</span>
                                        </div>
                                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                                            <UserIcon className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                                            <span className="truncate">{project.pm?.full_name ?? 'Unassigned'}</span>
                                        </div>
                                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                                            <CalendarDaysIcon className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                                            <span>Ends: {project.end_date ? new Date(project.end_date).toLocaleDateString() : '—'}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer: Value & Mini Progress */}
                                <div className="bg-gray-50 dark:bg-gray-700/30 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                                    <div className="flex flex-col">
                                        <span className="text-xs text-gray-500 font-medium uppercase">Contract Value</span>
                                        <span className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(project.contract_value)}</span>
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
            );
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
                                    { key: 'client_id', label: 'Client' },
                                    { key: 'project_manager_id', label: 'Manager' },
                                    { key: 'status', label: 'Status' },
                                    { key: 'contract_value', label: 'Value' },
                                    { key: 'end_date', label: 'End Date' }
                                ].map(({ key, label }) => (
                                    <th key={key} scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200" onClick={() => requestSort(key as keyof ProjectWithRefs)}>
                                        <div className="flex items-center">
                                            {label}
                                            <span className="ml-1 text-gray-400">{getSortIndicator(key as keyof ProjectWithRefs)}</span>
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
                                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{project.code ?? ''}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{project.client?.name ?? 'Unknown Client'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{project.pm?.full_name ?? 'Unassigned'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm"><ProjectStatusBadge status={project.status as ProjectStatus} /></td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(project.contract_value)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{project.end_date ? new Date(project.end_date).toLocaleDateString() : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

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

                {/* Secondary Filters */}
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="relative flex-1">
                        <input
                            type="text"
                            placeholder="Search projects by name or code..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full px-4 py-2 pl-10 text-sm text-gray-700 bg-white dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg focus:border-primary-500 focus:ring-primary-500 focus:outline-none transition-shadow shadow-sm"
                        />
                        <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>
                    <select value={filterClient} onChange={e => setFilterClient(e.target.value)} className="w-full md:w-48 px-4 py-2 text-sm text-gray-700 bg-white dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg focus:border-primary-500 focus:ring-primary-500 focus:outline-none shadow-sm">
                        <option value="All">All Clients</option>
                        {clientCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select value={filterPM} onChange={e => setFilterPM(e.target.value)} className="w-full md:w-48 px-4 py-2 text-sm text-gray-700 bg-white dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg focus:border-primary-500 focus:ring-primary-500 focus:outline-none shadow-sm">
                        <option value="All">All Managers</option>
                        {projectManagers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </select>
                </div>
            </div>

            {/* Content Area */}
            {renderContent()}

            {viewMode !== 'Board' && sortedProjects.length === 0 && (
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
