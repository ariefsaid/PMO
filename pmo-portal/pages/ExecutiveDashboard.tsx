import React from 'react';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { CompanyDashboard } from '@/src/components/dashboard/hub/company/CompanyDashboard';
import { EngineerDashboard } from '@/src/components/dashboard/EngineerDashboard';
import { PMDashboard } from '@/src/components/dashboard/PMDashboard';
import { MyDeliveries } from '@/src/components/my/MyDeliveries';

const RoleDashboard: React.FC = () => {
  const { effectiveRole } = useEffectiveRole();
  if (effectiveRole === 'Engineer') return <EngineerDashboard />;
  if (effectiveRole === 'Project Manager') return <PMDashboard />;
  return <CompanyDashboard role={effectiveRole === 'Finance' ? 'Finance' : effectiveRole === 'Admin' ? 'Admin' : 'Executive'} />;
};

/** The home of every full account; a transfer sent to the person leads it ("a delivery for you") for any role. */
const ExecutiveDashboard: React.FC = () => (
  <>
    <MyDeliveries />
    <RoleDashboard />
  </>
);

export default ExecutiveDashboard;
