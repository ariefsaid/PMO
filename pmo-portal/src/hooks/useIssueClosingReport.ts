import React from 'react';
import {
  QueryClient,
  QueryClientContext,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type {
  IssueClosingTimeReportFilter,
  IssueDepartmentGroupInput,
} from '@/src/lib/db/issueClosingReport';

export const ISSUE_CLOSING_SETTINGS_KEY = ['issue-closing-report-settings'] as const;
export const ISSUE_DEPARTMENT_GROUPS_KEY = ['issue-department-groups'] as const;
export const ISSUE_CLOSING_REPORT_KEY = ['issue-closing-time-report'] as const;

const fallbackClient = new QueryClient({
  defaultOptions: { queries: { enabled: false, retry: false } },
});

export function useIssueClosingReportSettings() {
  const client = React.useContext(QueryClientContext);
  return useQuery(
    {
      queryKey: ISSUE_CLOSING_SETTINGS_KEY,
      queryFn: () => repositories.issueClosingReport.getSettings(),
      enabled: Boolean(client),
    },
    client ?? fallbackClient,
  );
}

export function useUpdateIssueClosingReportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { enabled?: boolean; grouping_mode?: 'type' | 'department_groups' }) =>
      repositories.issueClosingReport.updateSettings(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ISSUE_CLOSING_SETTINGS_KEY });
      qc.invalidateQueries({ queryKey: ISSUE_CLOSING_REPORT_KEY });
    },
  });
}

export function useIssueDepartmentGroups() {
  const client = React.useContext(QueryClientContext);
  return useQuery(
    {
      queryKey: ISSUE_DEPARTMENT_GROUPS_KEY,
      queryFn: () => repositories.issueClosingReport.listDepartmentGroups(),
      enabled: Boolean(client),
    },
    client ?? fallbackClient,
  );
}

export function useIssueDepartmentGroupMutations() {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (input: IssueDepartmentGroupInput) =>
      repositories.issueClosingReport.saveDepartmentGroup(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ISSUE_DEPARTMENT_GROUPS_KEY });
      qc.invalidateQueries({ queryKey: ISSUE_CLOSING_REPORT_KEY });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => repositories.issueClosingReport.deleteDepartmentGroup(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ISSUE_DEPARTMENT_GROUPS_KEY });
      qc.invalidateQueries({ queryKey: ISSUE_CLOSING_REPORT_KEY });
    },
  });

  return { save, remove };
}

export function useIssueClosingReport(filter?: IssueClosingTimeReportFilter, options?: { enabled?: boolean }) {
  const client = React.useContext(QueryClientContext);
  return useQuery(
    {
      queryKey: [...ISSUE_CLOSING_REPORT_KEY, filter?.dateFrom, filter?.dateTo, filter?.groupingMode],
      queryFn: () => repositories.issueClosingReport.getReport(filter),
      enabled: Boolean(client) && (options?.enabled ?? true),
    },
    client ?? fallbackClient,
  );
}
