import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';

/**
 * Scheduled reports DAL (#2714; migrations 1225-1228). Reads are RLS-scoped (Admin only). Every write is a SECURITY DEFINER
 * RPC that re-checks the Admin role and the caller's organisation; org_id is never sent.
 */
export const REPORT_KINDS = ['daily_progress', 'overdue_tasks'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportFrequency = 'daily' | 'weekly';

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
}
export type ScheduledReportInput = Omit<ScheduledReport, 'id'> & { id: string | null };
export interface ReportRecipientOption { id: string; name: string }

function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }

export async function listScheduledReports(): Promise<ScheduledReport[]> {
  // The list has no provable ceiling (an Admin adds reports), so it is paged rather than silently truncated.
  const data = await fetchAllPages((f, t) => supabase.from('scheduled_reports')
    .select('id, name, kind, frequency, weekday, send_time, recipient_user_ids, recipient_roles, enabled')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(f, t));
  // `kind` and `frequency` are `text` with a CHECK of the values below, which the generated row states as `string`.
  return data.map((r) => ({
    id: r.id, name: r.name, kind: r.kind as ReportKind, frequency: r.frequency as ReportFrequency, weekday: r.weekday,
    sendTime: r.send_time.slice(0, 5), recipientUserIds: r.recipient_user_ids ?? [], recipientRoles: r.recipient_roles ?? [], enabled: r.enabled,
  }));
}

/** Active members the Admin can pick as recipients. */
export async function listReportRecipientOptions(): Promise<ReportRecipientOption[]> {
  const { data, error } = await supabase.from('profiles').select('id, full_name').eq('status', 'active').order('full_name', { ascending: true }).order('id', { ascending: true });
  if (error) fail(error);
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name ?? '' }));
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
