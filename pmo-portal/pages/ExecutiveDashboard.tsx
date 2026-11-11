import React from 'react';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { CompanyDashboard } from '@/src/components/dashboard/hub/company/CompanyDashboard';
import { EngineerDashboard } from '@/src/components/dashboard/EngineerDashboard';
import { PMDashboard } from '@/src/components/dashboard/PMDashboard';

const ExecutiveDashboard: React.FC = () => {
  const { effectiveRole } = useEffectiveRole();
  if (effectiveRole === 'Engineer') return <EngineerDashboard />;
  if (effectiveRole === 'Project Manager') return <PMDashboard />;
  return <CompanyDashboard role={effectiveRole === 'Finance' ? 'Finance' : effectiveRole === 'Admin' ? 'Admin' : 'Executive'} />;
};

export default ExecutiveDashboard;
