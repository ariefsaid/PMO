import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repositories } from './index';
import * as dal from '@/src/lib/db/issueClosingReport';
import { AppError } from '@/src/lib/appError';

vi.mock('@/src/lib/db/issueClosingReport', () => ({
  getIssueClosingReportSettings: vi.fn(),
  updateIssueClosingReportSettings: vi.fn(),
  listIssueDepartmentGroups: vi.fn(),
  saveIssueDepartmentGroup: vi.fn(),
  deleteIssueDepartmentGroup: vi.fn(),
  getIssueClosingTimeReport: vi.fn(),
}));

describe('issueClosingReportRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates getSettings to DAL getIssueClosingReportSettings', async () => {
    const mockSettings = { org_id: 'org-1', enabled: true, grouping_mode: 'type' as const };
    vi.mocked(dal.getIssueClosingReportSettings).mockResolvedValue(mockSettings);

    const result = await repositories.issueClosingReport.getSettings();
    expect(result).toEqual(mockSettings);
    expect(dal.getIssueClosingReportSettings).toHaveBeenCalled();
  });

  it('delegates updateSettings to DAL updateIssueClosingReportSettings', async () => {
    const mockSettings = { org_id: 'org-1', enabled: true, grouping_mode: 'department_groups' as const };
    vi.mocked(dal.updateIssueClosingReportSettings).mockResolvedValue(mockSettings);

    const result = await repositories.issueClosingReport.updateSettings({ enabled: true, grouping_mode: 'department_groups' });
    expect(result).toEqual(mockSettings);
    expect(dal.updateIssueClosingReportSettings).toHaveBeenCalledWith({ enabled: true, grouping_mode: 'department_groups' });
  });

  it('delegates listDepartmentGroups to DAL listIssueDepartmentGroups', async () => {
    const groups = [{ id: 'g1', org_id: 'org-1', name: 'Civil', issue_types: ['Civil', 'Site'] }];
    vi.mocked(dal.listIssueDepartmentGroups).mockResolvedValue(groups);

    const result = await repositories.issueClosingReport.listDepartmentGroups();
    expect(result).toEqual(groups);
    expect(dal.listIssueDepartmentGroups).toHaveBeenCalled();
  });

  it('delegates saveDepartmentGroup to DAL saveIssueDepartmentGroup', async () => {
    const group = { id: 'g1', org_id: 'org-1', name: 'Civil', issue_types: ['Civil'] };
    vi.mocked(dal.saveIssueDepartmentGroup).mockResolvedValue(group);

    const result = await repositories.issueClosingReport.saveDepartmentGroup({ name: 'Civil', issue_types: ['Civil'] });
    expect(result).toEqual(group);
    expect(dal.saveIssueDepartmentGroup).toHaveBeenCalledWith({ name: 'Civil', issue_types: ['Civil'] });
  });

  it('delegates deleteDepartmentGroup to DAL deleteIssueDepartmentGroup', async () => {
    vi.mocked(dal.deleteIssueDepartmentGroup).mockResolvedValue(undefined);

    await repositories.issueClosingReport.deleteDepartmentGroup('g1');
    expect(dal.deleteIssueDepartmentGroup).toHaveBeenCalledWith('g1');
  });

  it('delegates getReport to DAL getIssueClosingTimeReport', async () => {
    const rows = [{
      department: 'Civil',
      total_issues: 5,
      closed_issues: 4,
      open_issues: 1,
      avg_closing_hours: 24.5,
      median_closing_hours: 20.0,
      overdue_issues: 0,
    }];
    vi.mocked(dal.getIssueClosingTimeReport).mockResolvedValue(rows);

    const filter = { dateFrom: '2026-11-01', dateTo: '2026-11-30', groupingMode: 'type' as const };
    const result = await repositories.issueClosingReport.getReport(filter);
    expect(result).toEqual(rows);
    expect(dal.getIssueClosingTimeReport).toHaveBeenCalledWith(filter);
  });

  it('normalizes 42501 RLS denial to AppError preserving the code', async () => {
    const rlsError = Object.assign(new Error('permission denied'), { code: '42501' });
    vi.mocked(dal.updateIssueClosingReportSettings).mockRejectedValue(rlsError);

    await expect(repositories.issueClosingReport.updateSettings({ enabled: true })).rejects.toMatchObject({
      name: 'AppError',
      code: '42501',
    });
    await expect(repositories.issueClosingReport.updateSettings({ enabled: true })).rejects.toBeInstanceOf(AppError);
  });
});
