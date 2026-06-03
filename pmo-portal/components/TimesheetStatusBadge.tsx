import React from 'react';
import { TimesheetStatus } from '../types';

interface TimesheetStatusBadgeProps {
    status: TimesheetStatus;
}

const TimesheetStatusBadge: React.FC<TimesheetStatusBadgeProps> = ({ status }) => {
    const statusClasses: Record<TimesheetStatus, string> = {
        [TimesheetStatus.Draft]: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
        [TimesheetStatus.Submitted]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
        [TimesheetStatus.Approved]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        [TimesheetStatus.Rejected]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    };
    return (
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusClasses[status]}`}>
            {status}
        </span>
    );
};

export default TimesheetStatusBadge;
