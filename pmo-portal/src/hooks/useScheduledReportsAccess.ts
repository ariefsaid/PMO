import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useBuiltInRoleKey, usePermission } from '@/src/auth/usePermission';
import { orgSwitchKey } from '@/src/hooks/useOrgSwitch';
import { orgSwitchRepository } from '@/src/lib/repositories/orgSwitches';
import { SERVER_SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import type { ScheduledReport } from '@/src/lib/db/scheduledReports';

const IDLE_CLIENT = new QueryClient();

/**
 * Who may open and manage scheduled reports (TC-PC-19): Admin always; an active Project Control Manager when the
 * organisation setting `pcm_scheduled_reports_enabled` is on (and for row edits/toggles/archives, only schedules that role created,
 * which the server records on the row as `managedBy`). Safe when rendered without `AuthContext` in unit tests.
 */
export function useScheduledReportsAccess(): {
  canManage: boolean;
  isAdmin: boolean;
  canEditRow: (report: Pick<ScheduledReport, 'managedBy'>) => boolean;
} {
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
  const pcmEnabled = pcmSetting.data === true;
  const canManage = may('manage', 'scheduledReport', {
    record: {
      viewOnly,
      pcm_scheduled_reports_enabled: pcmEnabled,
    },
  });
  const canEditRow = (report: Pick<ScheduledReport, 'managedBy'>) =>
    may('edit', 'scheduledReport', {
      record: {
        viewOnly,
        pcm_scheduled_reports_enabled: pcmEnabled,
        managedBy: report.managedBy,
      },
    });
  return { canManage, isAdmin, canEditRow };
}
