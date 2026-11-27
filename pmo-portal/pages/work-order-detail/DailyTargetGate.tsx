import React, { useContext } from 'react';
import { AuthContext } from '@/src/auth/AuthContext';
import { usePermission } from '@/src/auth/usePermission';
import { useRevenuePlanSettings } from '@/src/hooks/useWorkOrderRevenuePlan';
import type { SourceGroup } from '@/src/lib/workOrderCostView';
import { DailyTargetView } from './DailyTargetView';

interface Props { workOrderId: string; woLabel: string; frozen: boolean; costGroups?: SourceGroup[] | null }

/**
 * Shows the daily target view only while the organisation has switched the revenue plan on (#2671 FR-WRP-001, #2672
 * FR-WDT-001) and the role may view it. Off, or outside the app's providers (a bare render), it shows nothing, so an
 * existing screen is unchanged.
 */
export const DailyTargetGate: React.FC<Props> = (props) => {
  const auth = useContext(AuthContext);
  if (!auth) return null;
  return <Inner {...props} />;
};

const Inner: React.FC<Props> = ({ workOrderId, woLabel, frozen, costGroups }) => {
  const may = usePermission();
  const canView = may('view', 'workOrderRevenuePlan');
  const settings = useRevenuePlanSettings();
  if (!canView || settings.data?.enabled !== true) return null;
  return <DailyTargetView workOrderId={workOrderId} costGroups={costGroups} monthOnly plan={may('manage', 'workOrderRevenuePlan') && !frozen ? { woLabel } : null} />;
};
