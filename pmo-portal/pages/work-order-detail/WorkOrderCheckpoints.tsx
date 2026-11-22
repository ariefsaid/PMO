import React, { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { SiteCheckpoints } from '../siteReports/SiteCheckpoints';
import { checkpointToday } from '../siteReports/checkpointTime';

/**
 * Today's timed checkpoints, recorded from the work order itself (walk finding: the 07:30 check could not be logged at
 * 07:30 because the section lived only on the sent daily report). The checkpoints exist from the day's start whatever
 * the report's state; the server stamps the real time and person. Renders nothing while the organisation has none.
 */
export const WorkOrderCheckpoints: React.FC<{ workOrderId: string; projectManagerId: string | null; status: string }> = ({ workOrderId, projectManagerId, status }) => {
  const auth = useContext(AuthContext);
  const queries = useContext(QueryClientContext);
  if (!auth || !queries) return null;
  return <SiteCheckpoints workOrderId={workOrderId} workDate={checkpointToday()} projectManagerId={projectManagerId} canRecordDay={status === 'Issued'} />;
};
