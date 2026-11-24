import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useBuiltInRoleKey, usePermission } from '@/src/auth/usePermission';
import { orgSwitchKey } from '@/src/hooks/useOrgSwitch';
import { orgSwitchRepository } from '@/src/lib/repositories/orgSwitches';
import { SERVER_SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

const IDLE_CLIENT = new QueryClient();

/**
 * Who may open and manage scheduled reports (TC-PC-19): Admin always; an active Project Control Manager when the
 * organisation setting `pcm_scheduled_reports_enabled` is on. Safe when rendered without `AuthContext` in unit tests.
 */
export function useScheduledReportsAccess(): { canManage: boolean; isAdmin: boolean } {
  const auth = useContext(AuthContext);
  const orgId = auth?.currentUser?.org_id;
  const qc = useContext(QueryClientContext);
  const { realRole, effectiveRole } = useEffectiveRole();
  const builtInRoleKey = useBuiltInRoleKey();
  const may = usePermission();
  const viewOnly = realRole !== effectiveRole;

  const isPcm = builtInRoleKey === 'project_control_manager';
  const pcmSetting = useQuery(
    {
      queryKey: orgSwitchKey(orgId, 'pcmScheduledReports'),
      queryFn: () => orgSwitchRepository.read('pcmScheduledReports'),
      enabled: Boolean(qc && orgId && isPcm && !viewOnly),
      ...SERVER_SESSION_QUERY_OPTIONS,
    },
    qc ?? IDLE_CLIENT,
  );

  const isAdmin = may('manage', 'orgEmailNotifications') && !viewOnly;
  const canManage = may('manage', 'scheduledReport', {
    record: {
      viewOnly,
      pcm_scheduled_reports_enabled: pcmSetting.data === true,
    },
  });
  return { canManage, isAdmin };
}
