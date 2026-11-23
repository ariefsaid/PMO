import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Json } from '@/src/lib/supabase/database.types';

/**
 * Second records of a worker's day, and the organisation's two role settings (pay-time, migrations 1700-1702).
 *
 * The attendance day carries ONE figure (the standing hours). A second record (a surveyor's or timekeeper's) sits beside it
 * until a person the organisation names decides which stands; the other stays as evidence. Every rule (who may enter, who may
 * decide, the separation of the recorder from the decider, the one-figure count) is the database's. This module only carries
 * requests and never sends `org_id` (ADR-0017).
 */
export type SecondRecordStatus = 'present' | 'absent';
export type Standing = 'day' | 'second';

export type SecondRecordInput = {
  worker_id: string;
  status: SecondRecordStatus;
  hours?: number | null;
  overtime_hours?: number | null;
  note?: string | null;
};

export interface DayFigure { status: string; hours: number | null; overtimeHours: number | null }
export interface DayFigureWithSource extends DayFigure { source: string }
export interface SecondFigure extends DayFigure {
  note: string | null;
  standing: Standing | null;
  decidedAt: string | null;
  decisionReason: string | null;
}
export interface ReportDayWorker {
  workerId: string;
  name: string;
  day: DayFigureWithSource | null;
  second: SecondFigure | null;
  /** The two disagree and nobody has decided. */
  undecided: boolean;
  /** The viewer recorded one of the figures (so may not decide). */
  mine: boolean;
  /** The day is the viewer's own (1932): they neither enter a second record for it nor decide it. */
  own: boolean;
}
export interface ReportDayHours { detail: boolean; mayEnter: boolean; mayDecide: boolean; workers: ReportDayWorker[] }
export interface AttendanceTimeRoles { secondRecordRoles: string[]; deciderRoles: string[] }

function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }

const isObject = (v: Json | undefined): v is { [key: string]: Json | undefined } => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: Json | undefined): number | null => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : null);
const str = (v: Json | undefined): string | null => (typeof v === 'string' ? v : null);

const standingOf = (v: Json | undefined): Standing | null => (v === 'day' ? 'day' : v === 'second' ? 'second' : null);

function figure(v: Json | undefined): DayFigure {
  const o = isObject(v) ? v : {};
  return { status: str(o.status) ?? 'absent', hours: num(o.hours), overtimeHours: num(o.overtime_hours) };
}

function parseWorker(v: Json | undefined): ReportDayWorker | null {
  if (!isObject(v)) return null;
  const day = isObject(v.day) ? { ...figure(v.day), source: str(v.day.source) ?? '' } : null;
  const second = isObject(v.second)
    ? {
        ...figure(v.second),
        note: str(v.second.note),
        standing: standingOf(v.second.standing),
        decidedAt: str(v.second.decided_at),
        decisionReason: str(v.second.decision_reason),
      }
    : null;
  return { workerId: str(v.worker_id) ?? '', name: str(v.name) ?? '', day, second, undecided: v.undecided === true, mine: v.mine === true, own: v.own === true };
}

/** Total hours of a figure (hours plus overtime); an absence or no record counts as nothing. */
export function standingTotal(f: Pick<DayFigure, 'status' | 'hours' | 'overtimeHours'> | null): number {
  if (!f || f.status !== 'present') return 0;
  return (f.hours ?? 0) + (f.overtimeHours ?? 0);
}

/** Per-worker hours for a site report's work order and day. Only people who record or decide time get rows. */
export async function getReportDayHours(reportId: string): Promise<ReportDayHours> {
  const { data, error } = await supabase.rpc('attendance_report_day_hours', { p_report: reportId });
  if (error) fail(error);
  const o = isObject(data) ? data : {};
  const rows = Array.isArray(o.workers) ? o.workers : [];
  return {
    detail: o.detail === true,
    mayEnter: o.may_enter === true,
    mayDecide: o.may_decide === true,
    workers: rows.map(parseWorker).filter((w): w is ReportDayWorker => w !== null),
  };
}

export async function enterSecondRecords(workOrderId: string, workDate: string, rows: SecondRecordInput[]): Promise<number> {
  const { data, error } = await supabase.rpc('attendance_second_record', {
    p_work_order_id: workOrderId, p_work_date: workDate, p_rows: rows,
  });
  if (error) fail(error);
  return data ?? 0;
}

export interface DecideInput { workerId: string; workOrderId: string; workDate: string; stand: Standing; reason: string }
export async function decideSecondRecord(input: DecideInput): Promise<void> {
  const { error } = await supabase.rpc('attendance_second_record_decide', {
    p_worker_id: input.workerId, p_work_order_id: input.workOrderId, p_work_date: input.workDate,
    p_stand: input.stand, p_reason: input.reason.trim(),
  });
  if (error) fail(error);
}

/** The two role settings. Everyone reads; only an Admin writes (the RPC is the authority, ADR-0016). */
export async function getAttendanceTimeRoles(): Promise<AttendanceTimeRoles> {
  const { data, error } = await supabase.from('organizations').select('attendance_second_record_roles, attendance_decider_roles').limit(2);
  if (error) fail(error);
  const row = data?.[0];
  return { secondRecordRoles: row?.attendance_second_record_roles ?? [], deciderRoles: row?.attendance_decider_roles ?? [] };
}

export async function saveAttendanceTimeRoles(roles: AttendanceTimeRoles): Promise<void> {
  const { error } = await supabase.rpc('set_attendance_time_roles', {
    p_second_record_roles: roles.secondRecordRoles, p_decider_roles: roles.deciderRoles,
  });
  if (error) fail(error);
}
