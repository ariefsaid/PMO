import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { repositories } from '@/src/lib/repositories';

export const DAILY_REPORT_VALIDATE_ROLES_KEY = 'daily-report-validate-roles';

/** 2290: built-in job role keys whose active holders may validate daily site reports in this organisation. */
export function useDailyReportValidateRoles() {
  return useOrgQuery(
    [DAILY_REPORT_VALIDATE_ROLES_KEY],
    () => repositories.dailySiteReport.validateRoles(),
    { staleness: 'session' },
  );
}

export function useSaveDailyReportValidateRoles() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (roles: string[]) => repositories.dailySiteReport.setValidateRoles(roles),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [DAILY_REPORT_VALIDATE_ROLES_KEY, orgId] });
      void qc.invalidateQueries({ queryKey: ['daily-site-reports'] });
      void qc.invalidateQueries({ queryKey: ['dsr-validation-route', orgId] });
    },
  });
}
