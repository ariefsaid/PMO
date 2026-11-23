import { wrap } from './repositoryErrors';
import {
  getIssueClosingReportSettings,
  updateIssueClosingReportSettings,
  listIssueDepartmentGroups,
  saveIssueDepartmentGroup,
  deleteIssueDepartmentGroup,
  getIssueClosingTimeReport,
  getWorkOrderEffectiveHours,
} from '@/src/lib/db/issueClosingReport';
import type { IssueClosingReportRepository } from './contracts/issueClosingReport';

export const issueClosingReportRepository: IssueClosingReportRepository = {
  getSettings: () => wrap(() => getIssueClosingReportSettings()),
  updateSettings: (input) => wrap(() => updateIssueClosingReportSettings(input)),
  listDepartmentGroups: () => wrap(() => listIssueDepartmentGroups()),
  saveDepartmentGroup: (input) => wrap(() => saveIssueDepartmentGroup(input)),
  deleteDepartmentGroup: (id) => wrap(() => deleteIssueDepartmentGroup(id)),
  getReport: (filter) => wrap(() => getIssueClosingTimeReport(filter)),
  getEffectiveHours: (workOrderId, from, to) => wrap(() => getWorkOrderEffectiveHours(workOrderId, from, to)),
};
