
import React from 'react';
import { ProcurementStatus } from '../types';

interface ProcurementPipelineProps {
  currentStatus: ProcurementStatus;
  className?: string;
  compact?: boolean;
  orientation?: 'horizontal' | 'vertical';
}

const ProcurementPipeline: React.FC<ProcurementPipelineProps> = ({ currentStatus, className = '', compact = false, orientation = 'horizontal' }) => {
  // Define the ordered steps in the lifecycle
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

  // Handle terminal/error states
  const isTerminal = currentStatus === ProcurementStatus.Rejected || currentStatus === ProcurementStatus.Cancelled;
  
  // Find the index of the current status
  const currentIndex = steps.indexOf(currentStatus);
  
  if (isTerminal) {
      return (
        <div className={`w-full ${className}`}>
            <div className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-center">
                 <span className={`font-bold ${currentStatus === ProcurementStatus.Rejected ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
                    Process {currentStatus}
                 </span>
            </div>
        </div>
      );
  }

  if (compact) {
     return (
        <div className={`w-full ${className}`}>
             <div className="flex items-center space-x-1 h-2">
                {steps.map((step, index) => {
                        const isCompleted = index <= currentIndex;
                        const isCurrent = index === currentIndex;
                        
                        let colorClass = 'bg-gray-200 dark:bg-gray-700';
                        if (isCompleted) colorClass = 'bg-primary-500';
                        if (isCurrent) colorClass = 'bg-primary-600';

                        return (
                            <div 
                            key={step} 
                            className={`flex-1 rounded-full h-full ${colorClass}`} 
                            title={step}
                            />
                        )
                })}
            </div>
        </div>
     )
  }

  if (orientation === 'vertical') {
      return (
        <div className={`w-full ${className}`}>
            <nav aria-label="Progress">
                <ol role="list" className="overflow-hidden">
                    {steps.map((step, index) => {
                        const isCompleted = index < currentIndex;
                        const isCurrent = index === currentIndex;

                        return (
                            <li key={step} className={`relative ${index !== steps.length - 1 ? 'pb-10' : ''}`}>
                                {index !== steps.length - 1 ? (
                                    <div className={`absolute top-4 left-4 -ml-px h-full w-0.5 ${isCompleted ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700'}`} aria-hidden="true"></div>
                                ) : null}
                                <div className="group relative flex items-start">
                                    <span className="flex h-9 items-center">
                                        {isCompleted ? (
                                            <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 group-hover:bg-primary-800">
                                                <svg className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                                </svg>
                                            </span>
                                        ) : isCurrent ? (
                                            <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white dark:bg-gray-800 border-2 border-primary-600">
                                                <span className="h-2.5 w-2.5 rounded-full bg-primary-600"></span>
                                            </span>
                                        ) : (
                                            <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 group-hover:border-gray-400">
                                                <span className="h-2.5 w-2.5 rounded-full bg-transparent group-hover:bg-gray-300"></span>
                                            </span>
                                        )}
                                    </span>
                                    <span className="ml-4 flex min-w-0 flex-col">
                                        <span className={`text-sm font-medium ${isCompleted || isCurrent ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}>{step}</span>
                                    </span>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            </nav>
        </div>
      );
  }

  // Horizontal Stepper (Responsive)
  return (
    <div className={`w-full ${className}`}>
        {/* Mobile Status Badge */}
        <div className="lg:hidden mb-4 flex justify-center">
             <span className="inline-flex items-center rounded-full bg-primary-100 px-3 py-1 text-sm font-medium text-primary-800 dark:bg-primary-900 dark:text-primary-300 shadow-sm border border-primary-200 dark:border-primary-800">
                {currentStatus}
             </span>
        </div>

        <div className="flex items-center w-full px-1 lg:px-4 pb-2 lg:pb-12">
            {steps.map((step, index) => {
                const isCompleted = index < currentIndex;
                const isCurrent = index === currentIndex;
                const isLast = index === steps.length - 1;
                
                // Responsive size: smaller on mobile
                let circleSize = "w-6 h-6 text-[10px] lg:w-8 lg:h-8 lg:text-xs";
                let iconSize = "w-3 h-3 lg:w-5 lg:h-5";
                
                let circleClass = `bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-400 ${circleSize}`;
                let textClass = "text-gray-500 dark:text-gray-400 font-medium";

                if (isCompleted) {
                    circleClass = `bg-primary-600 border-primary-600 text-white ${circleSize}`;
                    textClass = "text-primary-700 dark:text-primary-400 font-bold";
                } else if (isCurrent) {
                    circleClass = `bg-white dark:bg-gray-800 border-primary-600 text-primary-600 ring-2 lg:ring-4 ring-primary-50 dark:ring-primary-900/30 ${circleSize}`;
                    textClass = "text-primary-700 dark:text-primary-400 font-bold";
                }

                const label = step.replace('Vendor ', '').replace('Quote', 'Qt.');

                return (
                    <React.Fragment key={step}>
                        <div className="relative flex flex-col items-center flex-shrink-0">
                            <div className={`rounded-full flex items-center justify-center z-10 transition-all duration-200 ${circleClass}`}>
                                {isCompleted ? (
                                    <svg className={iconSize} fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                ) : (
                                    <span>{index + 1}</span>
                                )}
                            </div>
                            <div className={`absolute top-10 w-32 text-center text-xs leading-tight hidden lg:block ${textClass}`}>
                                {label}
                            </div>
                        </div>
                        {!isLast && (
                            <div className={`flex-1 h-0.5 mx-1 lg:mx-2 ${index < currentIndex ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    </div>
  );
};

export default ProcurementPipeline;
