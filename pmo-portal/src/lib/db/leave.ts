import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';

/**
 * Leave and sick requests (#2708, migrations 1240-1242). Every write is an RPC; the database owns the rules:
 * overlap, the line-manager or approver-role authority, and that nobody decides their own or an entered request.
 * This module only carries requests. org_id is never sent.
 */
const fail = (error: { message: string; code?: string } | null): void => {
  if (error) throw new AppError(error.message, error.code);
};

export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface LeaveType { id: string; name: string; archived_at: string | null }
export interface LeaveSettings { enabled: boolean; approver_role: string | null }
export interface LeaveRequestRow {
  id: string;
  person_id: string;
  person_name: string;
  leave_type_id: string;
  type_name: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decided_at: string | null;
  decision_note: string | null;
  is_mine: boolean;
  can_decide: boolean;
}
export interface LeaveRequestInput { person_id: string; leave_type_id: string; start_date: string; end_date: string; reason?: string | null }

export async function getLeaveSettings(): Promise<LeaveSettings> {
  const { data, error } = await supabase.from('organizations').select('leave_requests_enabled, leave_approver_role').maybeSingle();
  fail(error);
  return { enabled: data?.leave_requests_enabled === true, approver_role: data?.leave_approver_role ?? null };
}

export async function setLeaveSettings(s: LeaveSettings): Promise<void> {
  const { error } = await supabase.rpc('set_leave_settings', { p_enabled: s.enabled, p_approver_role: nullableArg(s.approver_role) });
  fail(error);
}

export async function listLeaveTypes(): Promise<LeaveType[]> {
  const { data, error } = await supabase.from('leave_types').select('id, name, archived_at').order('name').limit(500);
  fail(error);
  return data ?? [];
}

export async function createLeaveType(name: string): Promise<void> {
  const { error } = await supabase.from('leave_types').insert({ name: name.trim() });
  fail(error);
}

export async function archiveLeaveType(id: string): Promise<void> {
  const { error } = await supabase.from('leave_types').update({ archived_at: new Date().toISOString() }).eq('id', id);
  fail(error);
}

export async function listVisibleLeaveRequests(): Promise<LeaveRequestRow[]> {
  const { data, error } = await supabase.rpc('leave_requests_visible');
  fail(error);
  // `returns table` states no nullability, so the generated row marks every column NOT NULL; the decision, its note and
  // the reason are genuinely absent until a request is decided, and the status is bounded by the database's own CHECK.
  return (data ?? []).map((r) => ({
    ...r,
    days: Number(r.days),
    status: r.status as LeaveStatus,
    reason: r.reason ?? null,
    decided_at: r.decided_at ?? null,
    decision_note: r.decision_note ?? null,
  }));
}

export async function submitLeaveRequest(input: LeaveRequestInput): Promise<string> {
  const { data, error } = await supabase.rpc('leave_request_submit', {
    p_person_id: input.person_id, p_type_id: input.leave_type_id, p_start: input.start_date, p_end: input.end_date,
    p_reason: nullableArg(input.reason ?? null),
  });
  fail(error);
  // The function returns the new request's id or raises; it never resolves null.
  return data as string;
}

export async function decideLeaveRequest(id: string, decision: 'Approved' | 'Rejected', note: string | null): Promise<void> {
  const { error } = await supabase.rpc('leave_request_decide', { p_id: id, p_decision: decision, p_note: nullableArg(note) });
  fail(error);
}

export async function cancelLeaveRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('leave_request_cancel', { p_id: id });
  fail(error);
}

/** Ids of people on approved leave that day: the roster marker. Empty while the feature is off or nobody is on leave. */
export async function listLeaveOnDate(date: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('leave_on_date', { p_date: date });
  fail(error);
  return data ?? [];
}
