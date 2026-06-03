
import React from 'react';
import { ProcurementStatus } from '../types';

interface ProcurementStatusBadgeProps {
    status: ProcurementStatus;
}

const ProcurementStatusBadge: React.FC<ProcurementStatusBadgeProps> = ({ status }) => {
    const statusClasses: Record<ProcurementStatus, string> = {
        [ProcurementStatus.Draft]: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
        [ProcurementStatus.Requested]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        [ProcurementStatus.Approved]: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
        [ProcurementStatus.Rejected]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
        [ProcurementStatus.VendorQuoted]: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
        [ProcurementStatus.QuoteSelected]: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-300',
        [ProcurementStatus.Ordered]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
        [ProcurementStatus.Received]: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
        [ProcurementStatus.VendorInvoiced]: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
        [ProcurementStatus.Paid]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        [ProcurementStatus.Cancelled]: 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400 line-through',
    };
    return (
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusClasses[status]}`}>
            {status}
        </span>
    );
};

export default ProcurementStatusBadge;
