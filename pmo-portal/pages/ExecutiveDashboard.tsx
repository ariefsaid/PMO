import React, { Suspense, useEffect } from 'react';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { lazyWithPreload } from '@/src/lib/lazyWithPreload';
import { LoadingFallback } from '@/components/LoadingFallback';

const CompanyDashboard = lazyWithPreload(() =>
  import('@/src/components/dashboard/hub/company/CompanyDashboard').then(({ CompanyDashboard: component }) => ({ default: component })),
);
const EngineerDashboard = lazyWithPreload(() =>
  import('@/src/components/dashboard/EngineerDashboard').then(({ EngineerDashboard: component }) => ({ default: component })),
);
const PMDashboard = lazyWithPreload(() =>
  import('@/src/components/dashboard/PMDashboard').then(({ PMDashboard: component }) => ({ default: component })),
);

const ExecutiveDashboard: React.FC = () => {
  const { effectiveRole } = useEffectiveRole();
  const selectedDashboard = effectiveRole === 'Engineer'
    ? EngineerDashboard
    : effectiveRole === 'Project Manager'
      ? PMDashboard
      : CompanyDashboard;

  useEffect(() => {
    // Start only the role-specific import after the real role is known. React.lazy
    // shares this promise with its render path, so this never downloads a second copy.
    void selectedDashboard.preload().catch(() => undefined);
  }, [selectedDashboard]);

  return (
    <Suspense fallback={<LoadingFallback />}>
      {effectiveRole === 'Engineer' ? <EngineerDashboard />
        : effectiveRole === 'Project Manager' ? <PMDashboard />
          : <CompanyDashboard role={effectiveRole === 'Finance' ? 'Finance' : effectiveRole === 'Admin' ? 'Admin' : 'Executive'} />}
    </Suspense>
  );
};

export default ExecutiveDashboard;
