
import React from 'react';
import { ProjectStatus } from '../types';
import { useNavigate } from 'react-router-dom';
import { BuildingOfficeIcon, UserIcon } from './icons';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

interface SalesKanbanBoardProps {
  projects: ProjectWithRefs[];
}

const SalesKanbanBoard: React.FC<SalesKanbanBoardProps> = ({ projects }) => {
  const navigate = useNavigate();

  // Sales-centric column definition with Probabilities
  const columns = [
    {
      title: 'Leads',
      status: ProjectStatus.Leads,
      probability: 0.1, // 10%
      color: 'border-t-4 border-gray-400'
    },
    {
      title: 'PQ Submitted',
      status: ProjectStatus.PQSubmitted,
      probability: 0.2, // 20%
      color: 'border-t-4 border-indigo-400'
    },
    {
      title: 'Quotation',
      status: ProjectStatus.QuotationSubmitted,
      probability: 0.4, // 40%
      color: 'border-t-4 border-blue-400'
    },
    {
      title: 'Tender',
      status: ProjectStatus.TenderSubmitted,
      probability: 0.6, // 60%
      color: 'border-t-4 border-yellow-500'
    },
    {
      title: 'Negotiation',
      status: ProjectStatus.Negotiation,
      probability: 0.8, // 80%
      color: 'border-t-4 border-orange-500'
    },
     {
      title: 'Won',
      status: ProjectStatus.WonPendingKoM,
      probability: 1.0, // 100%
      color: 'border-t-4 border-green-500'
    }
  ];

  return (
    <div className="flex h-[calc(100vh-280px)] overflow-x-auto pb-4 space-x-4">
      {columns.map((col, index) => {
        const colProjects = projects.filter(p => (p.status as ProjectStatus) === col.status);
        const totalValue = colProjects.reduce((sum, p) => sum + p.contract_value, 0);
        const weightedValue = totalValue * col.probability;

        return (
          <div key={index} className="flex-shrink-0 w-80 flex flex-col bg-gray-100 dark:bg-gray-800 rounded-lg">
            {/* Column Header */}
            <div className={`p-3 bg-white dark:bg-gray-700 rounded-t-lg shadow-sm ${col.color}`}>
              <div className="flex justify-between items-center mb-1">
                <h3 className="font-semibold text-gray-900 dark:text-white">{col.title}</h3>
                <span className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs px-2 py-0.5 rounded-full">{colProjects.length}</span>
              </div>
              <div className="flex flex-col text-xs text-gray-500 dark:text-gray-400 font-medium">
                  <div className="flex justify-between">
                     <span>Total:</span>
                     <span className="text-gray-900 dark:text-gray-200">{formatCurrency(totalValue)}</span>
                  </div>
                   <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                     <span>Weighted ({col.probability * 100}%):</span>
                     <span>{formatCurrency(weightedValue)}</span>
                  </div>
              </div>
            </div>

            {/* Cards Container */}
            <div className="flex-1 overflow-y-auto p-2 space-y-3 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
              {colProjects.map(project => (
                <div 
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="bg-white dark:bg-gray-700 p-3 rounded shadow-sm border border-gray-200 dark:border-gray-600 hover:shadow-md cursor-pointer transition-shadow"
                >
                  <div className="flex justify-between items-start mb-2">
                     <span className="text-[10px] text-gray-400 font-mono bg-gray-50 dark:bg-gray-800 px-1 rounded">{project.code ?? project.id.slice(0, 8)}</span>
                     <span className="text-[10px] text-green-600 dark:text-green-400 font-bold">
                         {(col.probability * 100)}%
                     </span>
                  </div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2 line-clamp-2" title={project.name}>{project.name}</h4>
                  
                  <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mb-2">
                    <BuildingOfficeIcon className="w-3 h-3 mr-1" />
                    <span className="truncate" title={project.client?.name ?? undefined}>{project.client?.name ?? 'Unknown Client'}</span>
                  </div>

                  <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-600 flex justify-between items-center">
                    <div>
                        <span className="font-bold text-gray-700 dark:text-gray-200 text-sm block">{formatCurrency(project.contract_value)}</span>
                    </div>
                    <div className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center text-xs text-primary-700 dark:text-primary-300">
                        <UserIcon className="w-3 h-3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SalesKanbanBoard;
