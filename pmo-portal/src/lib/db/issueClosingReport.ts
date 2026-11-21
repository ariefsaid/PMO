import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';

export interface IssueClosingReportSettings {
  id?: string;
  org_id: string;
  enabled: boolean;
  grouping_mode: 'type' | 'department_groups';
  created_at?: string | null;
  updated_at?: string;
}

export interface IssueDepartmentGroup {
  id: string;
  org_id: string;
  name: string;
  issue_types: string[];
  created_at?: string;
  updated_at?: string;
}

export interface IssueDepartmentGroupInput {
  id?: string;
  name: string;
  issue_types: string[];
}

export interface IssueClosingTimeReportRow {
  department: string;
  total_issues: number;
  closed_issues: number;
  open_issues: number;
  avg_closing_hours: number | null;
  median_closing_hours: number | null;
  overdue_issues: number;
}

export interface IssueClosingTimeReportFilter {
  dateFrom?: string;
  dateTo?: string;
  groupingMode?: 'type' | 'department_groups';
}

interface PostgrestErrorLike {
  message: string;
  code?: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * Fetch the organisation's closing-time report settings.
 * Returns null if not configured yet (which defaults to enabled=false).
 */
export async function getIssueClosingReportSettings(): Promise<IssueClosingReportSettings | null> {
  const { data, error } = await supabase
    .from('issue_closing_report_settings')
    .select('*')
    .maybeSingle();
  if (error) throwWrite(error);
  return data ?? null;
}

/**
 * Update or initialize the organisation's closing-time report settings.
 */
export async function updateIssueClosingReportSettings(
  input: { enabled?: boolean; grouping_mode?: 'type' | 'department_groups' },
): Promise<IssueClosingReportSettings> {
  const { data: current } = await supabase
    .from('issue_closing_report_settings')
    .select('org_id')
    .maybeSingle();

  if (current?.org_id) {
    const patch: Partial<IssueClosingReportSettings> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof input.enabled === 'boolean') patch.enabled = input.enabled;
    if (input.grouping_mode) patch.grouping_mode = input.grouping_mode;

    const { data, error } = await supabase
      .from('issue_closing_report_settings')
      .update(patch)
      .eq('org_id', current.org_id)
      .select('*')
      .single();
    if (error) throwWrite(error);
    return data;
  }

  // Insert default/initial row
  const insert = {
    enabled: input.enabled ?? false,
    grouping_mode: input.grouping_mode ?? 'type',
  };
  const { data, error } = await supabase
    .from('issue_closing_report_settings')
    .insert(insert)
    .select('*')
    .single();
  if (error) throwWrite(error);
  return data;
}

/**
 * List all custom department groups for the caller's organisation.
 */
export async function listIssueDepartmentGroups(): Promise<IssueDepartmentGroup[]> {
  const { data, error } = await supabase
    .from('issue_department_groups')
    .select('*')
    .order('name', { ascending: true })
    .limit(200);
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Create or update a department group.
 */
export async function saveIssueDepartmentGroup(input: IssueDepartmentGroupInput): Promise<IssueDepartmentGroup> {
  if (input.id) {
    const { data, error } = await supabase
      .from('issue_department_groups')
      .update({
        name: input.name.trim(),
        issue_types: input.issue_types,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throwWrite(error);
    assertWriteLanded(data ? [data] : [], 'Department group not found or you do not have permission.');
    return data;
  }

  const { data, error } = await supabase
    .from('issue_department_groups')
    .insert({
      name: input.name.trim(),
      issue_types: input.issue_types,
    })
    .select('*')
    .single();
  if (error) throwWrite(error);
  return data;
}

/**
 * Delete a department group by id.
 */
export async function deleteIssueDepartmentGroup(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('issue_department_groups')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Department group not found or you do not have permission to delete it.');
}

/**
 * Fetch the aggregated closing-time report by department from the database RPC.
 */
export async function getIssueClosingTimeReport(
  filter?: IssueClosingTimeReportFilter,
): Promise<IssueClosingTimeReportRow[]> {
  const { data, error } = await supabase.rpc('get_issue_closing_time_report', {
    p_date_from: filter?.dateFrom || null,
    p_date_to: filter?.dateTo || null,
    p_grouping_mode: filter?.groupingMode || null,
  });
  if (error) throwWrite(error);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    department: String(row.department ?? 'Unassigned'),
    total_issues: Number(row.total_issues ?? 0),
    closed_issues: Number(row.closed_issues ?? 0),
    open_issues: Number(row.open_issues ?? 0),
    avg_closing_hours: row.avg_closing_hours !== null && row.avg_closing_hours !== undefined ? Number(row.avg_closing_hours) : null,
    median_closing_hours: row.median_closing_hours !== null && row.median_closing_hours !== undefined ? Number(row.median_closing_hours) : null,
    overdue_issues: Number(row.overdue_issues ?? 0),
  }));
}
