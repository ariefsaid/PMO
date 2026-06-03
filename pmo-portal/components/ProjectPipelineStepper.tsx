
import React from 'react';
import { ProjectStatus } from '../types';

interface ProjectPipelineStepperProps {
  currentStatus: ProjectStatus;
  className?: string;
}

const ProjectPipelineStepper: React.FC<ProjectPipelineStepperProps> = ({ currentStatus, className = '' }) => {
  const mainFlow = [
    { id: 'leads', label: 'Lead', status: ProjectStatus.Leads },
    { id: 'pq', label: 'PQ', status: ProjectStatus.PQSubmitted },
    { id: 'tender', label: 'Tender', status: ProjectStatus.TenderSubmitted },
    { id: 'negotiation', label: 'Negotiation', status: ProjectStatus.Negotiation },
    { id: 'won', label: 'Won', status: ProjectStatus.WonPendingKoM },
    { id: 'ongoing', label: 'Ongoing', status: ProjectStatus.Ongoing },
    { id: 'close', label: 'Close Out', status: ProjectStatus.CloseOut },
  ];

  const getStepState = (stepStatus: ProjectStatus) => {
      let effectiveStatus = currentStatus;
      
      // Normalization: Map detailed statuses to the main steps
      if (currentStatus === ProjectStatus.QuotationSubmitted) effectiveStatus = ProjectStatus.TenderSubmitted;
      if (currentStatus === ProjectStatus.OnHold) effectiveStatus = ProjectStatus.Ongoing;

      // Handle Terminal States implicitly if not found in flow, but here we handle Loss/Internal explicitly in return
      
      const currentIndex = mainFlow.findIndex(s => s.status === effectiveStatus);
      const stepIndex = mainFlow.findIndex(s => s.status === stepStatus);

      if (currentStatus === ProjectStatus.Loss) {
          // Loss state logic: Can we infer where it was lost? 
          // For simple visualization, show inactive.
          return 'inactive'; 
      }

      if (currentIndex === -1) return 'inactive';

      if (stepIndex < currentIndex) return 'completed';
      if (stepIndex === currentIndex) {
          if (currentStatus === ProjectStatus.OnHold) return 'hold';
          return 'current';
      }
      return 'inactive';
  };

  // Special Banners for Terminal States
  if (currentStatus === ProjectStatus.Internal) {
      return (
          <div className={`w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center ${className}`}>
             <div className="flex items-center justify-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-500"></span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">Internal Project</span>
             </div>
             <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Not tracked in sales pipeline</p>
          </div>
      )
  }
  
  if (currentStatus === ProjectStatus.Loss) {
      return (
          <div className={`w-full bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center ${className}`}>
              <div className="flex items-center justify-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                <span className="font-bold text-red-700 dark:text-red-400">Project / Tender Lost</span>
              </div>
              <p className="text-xs text-red-500 dark:text-red-400 mt-1">This opportunity is closed</p>
          </div>
      )
  }

  return (
    <div className={`w-full ${className}`}>
        {/* Scrollable Container with padding for labels */}
        <div className="w-full overflow-x-auto pb-6 pt-2 scrollbar-hide">
             {/* Stepper Content - Min width ensures items don't squash on small screens */}
            <div className="flex items-center justify-between min-w-[700px] px-4 relative">
                {mainFlow.map((step, index) => {
                    const state = getStepState(step.status);
                    const isLast = index === mainFlow.length - 1;
                    
                    let circleColor = "bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-400";
                    let textColor = "text-gray-500 dark:text-gray-500";
                    let barColor = "bg-gray-200 dark:bg-gray-700";
                    let fontWeight = "font-medium";

                    if (state === 'completed') {
                        circleColor = "bg-primary-600 border-primary-600 text-white shadow-sm";
                        textColor = "text-primary-700 dark:text-primary-400";
                        barColor = "bg-primary-600";
                        fontWeight = "font-bold";
                    } else if (state === 'current') {
                        circleColor = "bg-white dark:bg-gray-800 border-primary-600 text-primary-600 ring-4 ring-primary-50 dark:ring-primary-900/30 shadow-md";
                        textColor = "text-primary-800 dark:text-primary-300";
                        fontWeight = "font-extrabold";
                    } else if (state === 'hold') {
                        circleColor = "bg-amber-50 dark:bg-amber-900/20 border-amber-500 text-amber-600 dark:text-amber-400 shadow-sm";
                        textColor = "text-amber-700 dark:text-amber-400";
                        fontWeight = "font-bold";
                    }

                    return (
                        <div key={step.id} className="flex-1 flex items-center relative">
                            {/* Step Circle & Label */}
                            <div className="relative flex flex-col items-center justify-center w-full group z-10">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs transition-all duration-300 ${circleColor}`}>
                                    {state === 'completed' ? (
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    ) : state === 'hold' ? (
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    ) : (
                                        <span>{index + 1}</span>
                                    )}
                                </div>
                                
                                {/* Absolute positioned Label below */}
                                <div className={`absolute top-10 w-32 text-center text-xs tracking-wide transition-colors duration-300 ${textColor} ${fontWeight}`}>
                                    {step.label}
                                </div>
                            </div>

                            {/* Connecting Bar (not for last item) */}
                            {!isLast && (
                                <div className="absolute left-[50%] w-full top-4 -translate-y-1/2 h-1 z-0 px-2">
                                     <div className={`h-full w-full rounded-full transition-all duration-500 ${barColor}`} />
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    </div>
  );
};

export default ProjectPipelineStepper;
