import type {
  IssueClosingReportSettings,
  IssueDepartmentGroup,
  IssueDepartmentGroupInput,
  IssueClosingTimeReportRow,
  IssueClosingTimeReportFilter,
  WorkOrderEffectiveHoursRow,
} from '@/src/lib/db/issueClosingReport';

export interface IssueClosingReportRepository {
  getSettings(): Promise<IssueClosingReportSettings | null>;
  updateSettings(input: { enabled?: boolean; grouping_mode?: 'type' | 'department_groups' }): Promise<IssueClosingReportSettings>;
  listDepartmentGroups(): Promise<IssueDepartmentGroup[]>;
  saveDepartmentGroup(input: IssueDepartmentGroupInput): Promise<IssueDepartmentGroup>;
  deleteDepartmentGroup(id: string): Promise<void>;
  getReport(filter?: IssueClosingTimeReportFilter): Promise<IssueClosingTimeReportRow[]>;
  getEffectiveHours(workOrderId: string, from: string, to: string): Promise<WorkOrderEffectiveHoursRow[]>;
}
