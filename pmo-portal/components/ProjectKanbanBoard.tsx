
import React from 'react';
import { Project, ProjectStatus } from '../types';
import { useNavigate } from 'react-router-dom';
import { BuildingOfficeIcon, UserIcon } from './icons';

interface ProjectKanbanBoardProps {
  projects: Project[];
}

const ProjectKanbanBoard: React.FC<ProjectKanbanBoardProps> = ({ projects }) => {
  const navigate = useNavigate();

  // Define columns grouping various statuses
  const columns = [
    {
      title: 'Leads & PQ',
      statuses: [ProjectStatus.Leads, ProjectStatus.PQSubmitted],
      color: 'border-t-4 border-gray-400'
    },
    {
      title: 'Tendering',
      statuses: [ProjectStatus.QuotationSubmitted, ProjectStatus.TenderSubmitted],
      color: 'border-t-4 border-yellow-400'
    },
    {
      title: 'Closing',
      statuses: [ProjectStatus.Negotiation, ProjectStatus.WonPendingKoM],
      color: 'border-t-4 border-teal-400'
    },
    {
      title: 'Execution',
      statuses: [ProjectStatus.Ongoing, ProjectStatus.OnHold],
      color: 'border-t-4 border-green-500'
    },
    {
      title: 'Closed / Analysis',
      statuses: [ProjectStatus.CloseOut, ProjectStatus.Loss],
      color: 'border-t-4 border-purple-500'
    }
  ];

  const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

  return (
    <div className="flex h-[calc(100vh-280px)] overflow-x-auto pb-4 space-x-4">
      {columns.map((col, index) => {
        const colProjects = projects.filter(p => col.statuses.includes(p.status));
        const totalValue = colProjects.reduce((sum, p) => sum + p.contractValue, 0);

        return (
          <div key={index} className="flex-shrink-0 w-80 flex flex-col bg-gray-100 dark:bg-gray-800 rounded-lg">
            {/* Column Header */}
            <div className={`p-3 bg-white dark:bg-gray-700 rounded-t-lg shadow-sm ${col.color}`}>
              <div className="flex justify-between items-center mb-1">
                <h3 className="font-semibold text-gray-900 dark:text-white">{col.title}</h3>
                <span className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs px-2 py-0.5 rounded-full">{colProjects.length}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Value: {formatCurrency(totalValue)}</p>
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
                     <span className="text-[10px] text-gray-400 font-mono">{project.id}</span>
                     {/* Show specific status badge if column has multiple statuses */}
                     {col.statuses.length > 1 && (
                         <span className={`text-[10px] px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-600`}>
                             {project.status === ProjectStatus.WonPendingKoM ? 'Won' : project.status}
                         </span>
                     )}
                  </div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2 line-clamp-2" title={project.name}>{project.name}</h4>
                  
                  <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mb-2">
                    <BuildingOfficeIcon className="w-3 h-3 mr-1" />
                    <span className="truncate">Client ID: {project.clientId}</span>
                  </div>

                  <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-600 flex justify-between items-center">
                    <span className="font-bold text-gray-700 dark:text-gray-200 text-sm">{formatCurrency(project.contractValue)}</span>
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

export default ProjectKanbanBoard;
