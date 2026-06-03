
import React from 'react';
import { ProjectStatus } from '../types';

interface ProjectStatusBadgeProps {
    status: ProjectStatus;
}

const ProjectStatusBadge: React.FC<ProjectStatusBadgeProps> = ({ status }) => {
    const statusClasses: Record<ProjectStatus, string> = {
        [ProjectStatus.Leads]: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
        [ProjectStatus.PQSubmitted]: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
        [ProjectStatus.QuotationSubmitted]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        [ProjectStatus.TenderSubmitted]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
        [ProjectStatus.Negotiation]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
        [ProjectStatus.WonPendingKoM]: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
        [ProjectStatus.Ongoing]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        [ProjectStatus.OnHold]: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
        [ProjectStatus.CloseOut]: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
        [ProjectStatus.Loss]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
        [ProjectStatus.Internal]: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-300',
    };
    return (
        <span className={`px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${statusClasses[status]}`}>
            {status}
        </span>
    );
};

export default ProjectStatusBadge;
