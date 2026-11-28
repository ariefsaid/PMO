import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';

/**
 * Scheduled reports DAL (#2714; migrations 1225-1228, 2580). Reads are RLS-scoped (Admin, and a Project Control Manager for the kinds
 * that role reads). Every write is a SECURITY DEFINER RPC that re-checks the caller's role, the schedule's managing role and the caller's
 * organisation; org_id is never sent.
 */
export const REPORT_KINDS = ['daily_progress', 'overdue_tasks'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportFrequency = 'daily' | 'weekly';
/** The role that created a schedule and may change it besides an Admin (`scheduled_reports.managed_by`, written once at creation). */
export type ScheduleManager = 'admin' | 'project_control_manager' | 'project_administrator';

export interface ScheduledReport {
  id: string;
  name: string;
  kind: ReportKind;
  frequency: ReportFrequency;
  /** ISO weekday, 1 = Monday; null for a daily report. */
  weekday: number | null;
  /** Local time in the organisation's timezone, "HH:MM". */
  sendTime: string;
  recipientUserIds: string[];
  recipientRoles: string[];
  enabled: boolean;
  /** Server-set: which role created the schedule. Decides whether a Project Control Manager may edit, toggle or archive the row. */
  managedBy?: ScheduleManager | null;
}
export type ScheduledReportInput = Omit<ScheduledReport, 'id' | 'managedBy'> & { id: string | null };
export interface ReportRecipientOption { id: string; name: string; builtInRole?: string | null }

function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }

export async function listScheduledReports(): Promise<ScheduledReport[]> {
  // The list has no provable ceiling (an Admin adds reports), so it is paged rather than silently truncated.
  const data = await fetchAllPages((f, t) => supabase.from('scheduled_reports')
    .select('id, name, kind, frequency, weekday, send_time, recipient_user_ids, recipient_roles, enabled, managed_by')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(f, t));
  // `kind` and `frequency` are `text` with a CHECK of the values below, which the generated row states as `string`;
  // `managed_by` is `text` with a CHECK of its two values.
  return data.map((r) => ({
    id: r.id, name: r.name, kind: r.kind as ReportKind, frequency: r.frequency as ReportFrequency, weekday: r.weekday,
    sendTime: r.send_time.slice(0, 5), recipientUserIds: r.recipient_user_ids ?? [], recipientRoles: r.recipient_roles ?? [], enabled: r.enabled,
    managedBy: r.managed_by === 'project_control_manager' || r.managed_by === 'project_administrator' ? r.managed_by : 'admin',
  }));
}

/** Active members the Admin or Project Control Manager can pick as recipients. */
export async function listReportRecipientOptions(): Promise<ReportRecipientOption[]> {
  const { data, error } = await supabase.from('profiles').select('id, full_name, built_in_role').eq('status', 'active').order('full_name', { ascending: true }).order('id', { ascending: true });
  if (error) fail(error);
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name ?? '', builtInRole: p.built_in_role ?? null }));
}

export async function saveScheduledReport(input: ScheduledReportInput): Promise<string> {
  const { data, error } = await supabase.rpc('save_scheduled_report', {
    p_id: nullableArg(input.id), p_name: input.name, p_kind: input.kind, p_frequency: input.frequency,
    p_weekday: nullableArg(input.weekday),
    p_send_time: input.sendTime, p_user_ids: input.recipientUserIds, p_roles: input.recipientRoles, p_enabled: input.enabled,
  });
  if (error) fail(error);
  return data;
}

export async function setScheduledReportEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_scheduled_report_enabled', { p_id: id, p_enabled: enabled });
  if (error) fail(error);
}

export async function archiveScheduledReport(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_scheduled_report', { p_id: id });
  if (error) fail(error);
}
