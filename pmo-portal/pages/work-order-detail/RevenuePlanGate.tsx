import React, { useContext } from 'react';
import { AuthContext } from '@/src/auth/AuthContext';
import { usePermission } from '@/src/auth/usePermission';
import { useRevenuePlanSettings } from '@/src/hooks/useWorkOrderRevenuePlan';
import { RevenuePlanSection } from './RevenuePlanSection';

interface Props { workOrderId: string; woLabel: string; frozen: boolean }

/**
 * Shows the revenue plan section only while the organisation has switched the plan on (#2671 FR-WRP-001) and the role may
 * view it. Off, or outside the app's providers (a bare render), it shows nothing, so an existing screen is unchanged.
 */
export const RevenuePlanGate: React.FC<Props> = (props) => {
  const auth = useContext(AuthContext);
  if (!auth) return null;
  return <Inner {...props} />;
};

const Inner: React.FC<Props> = (props) => {
  const canView = usePermission()('view', 'workOrderRevenuePlan');
  const settings = useRevenuePlanSettings();
  if (!canView || settings.data?.enabled !== true) return null;
  return <RevenuePlanSection {...props} />;
};
