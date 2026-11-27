import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';

/**
 * Labour cost setup (#2670, migration 1250). Data access only. The switch, classes and rates are written by Admin and
 * Finance; RLS and the RPCs are the authority (ADR-0016). `org_id` is never sent (default + stamp trigger, ADR-0017).
 * Money is exact text (scale two) end to end; a rate is never a float on the wire.
 */
export type RateBasis = 'hourly' | 'daily' | 'monthly';
/** `class`: a rate for a labour class; it prices the approved attendance of people holding that class (1720). */
export type RateSubject = 'person' | 'role' | 'class';

export interface LabourClass { id: string; code: string; name: string; archivedAt: string | null }
export interface LabourRate {
  id: string; subjectKind: RateSubject; personId: string | null; personName: string | null; roleKey: string | null;
  classId: string; basis: RateBasis; amount: string; overtimeMultiplier: string; dayHours: string; monthHours: string;
  effectiveFrom: string; effectiveTo: string | null;
}
export interface LabourRateInput {
  subjectKind: RateSubject; personId?: string | null; roleKey?: string | null; classId: string; basis: RateBasis;
  amount: string; overtimeMultiplier: string; dayHours: string; monthHours: string; effectiveFrom: string; effectiveTo?: string | null;
}

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
/** Client-side hints only; the database re-checks every rule. */
export function validateRateInput(i: LabourRateInput): string | null {
  if (!i.classId) return 'class';
  if (i.subjectKind === 'person' ? !i.personId : i.subjectKind === 'role' ? !i.roleKey : false) return 'subject';
  if (!AMOUNT.test(i.amount.trim()) || Number(i.amount) <= 0) return 'amount';
  const mult = Number(i.overtimeMultiplier);
  if (!Number.isFinite(mult) || mult < 1 || mult > 5) return 'multiplier';
  const day = Number(i.dayHours);
  if (!Number.isFinite(day) || day < 1 || day > 24) return 'dayHours';
  const month = Number(i.monthHours);
  if (!Number.isFinite(month) || month < 1 || month > 744) return 'monthHours';
  if (!i.effectiveFrom) return 'from';
  if (i.effectiveTo && i.effectiveTo < i.effectiveFrom) return 'dates';
  return null;
}

export async function getLabourCostEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('labour_cost_settings').select('enabled').maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return data?.enabled === true;
}

export async function setLabourCostEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('save_labour_cost_settings', { p_enabled: enabled });
  if (error) throw new AppError(error.message, error.code);
}

export async function listLabourClasses(): Promise<LabourClass[]> {
  const { data, error } = await supabase.from('labour_cost_classes').select('id, code, name, archived_at').order('created_at', { ascending: true }).limit(200);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => ({ id: r.id, code: r.code, name: r.name, archivedAt: r.archived_at }));
}

export async function renameLabourClass(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) throw new AppError('validation', 'validation');
  const { error } = await supabase.from('labour_cost_classes').update({ name: trimmed }).eq('id', id);
  if (error) throw new AppError(error.message, error.code);
}

export async function addLabourClass(code: string, name: string): Promise<void> {
  const { error } = await supabase.from('labour_cost_classes').insert({ code: code.trim(), name: name.trim() });
  if (error) throw new AppError(error.message, error.code);
}

export async function setLabourClassArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase.from('labour_cost_classes').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id);
  if (error) throw new AppError(error.message, error.code);
}

/** Live (not archived) rates; Admin, Finance and Executive read them (RLS), anyone else gets none. */
export async function listLabourRates(): Promise<LabourRate[]> {
  const rows = await fetchAllPages((from, to) => supabase.from('labour_cost_rates')
    .select('id, subject_kind, person_id, role_key, class_id, basis, amount::text, overtime_multiplier::text, day_hours::text, month_hours::text, effective_from, effective_to, person:profiles!labour_cost_rates_person_id_fkey(full_name)')
    .is('archived_at', null).order('effective_from', { ascending: false }).order('id').range(from, to));
  return rows.map((r) => ({
    // `subject_kind` and `basis` are text columns whose domain the database CHECK owns; the generated type
    // says `string`, so narrow here rather than leave the mapping unchecked.
    id: r.id, subjectKind: r.subject_kind as RateSubject, personId: r.person_id, personName: r.person?.full_name ?? null, roleKey: r.role_key,
    classId: r.class_id, basis: r.basis as RateBasis, amount: String(r.amount), overtimeMultiplier: String(r.overtime_multiplier),
    dayHours: String(r.day_hours), monthHours: String(r.month_hours), effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
  }));
}

export async function saveLabourRate(i: LabourRateInput): Promise<string> {
  const problem = validateRateInput(i);
  if (problem) throw new AppError(problem, 'validation');
  const { data, error } = await supabase.rpc('save_labour_cost_rate', {
    p: {
      subject_kind: i.subjectKind, person_id: i.subjectKind === 'person' ? i.personId : null, role_key: i.subjectKind === 'role' ? i.roleKey : null,
      class_id: i.classId, basis: i.basis, amount: i.amount.trim(), overtime_multiplier: i.overtimeMultiplier, day_hours: i.dayHours,
      month_hours: i.monthHours, effective_from: i.effectiveFrom, effective_to: i.effectiveTo || null,
    },
  });
  if (error) throw new AppError(error.message, error.code);
  return String(data);
}

export async function endLabourRate(id: string, endDate: string): Promise<void> {
  const { error } = await supabase.rpc('end_labour_cost_rate', { p_id: id, p_end: endDate });
  if (error) throw new AppError(error.message, error.code);
}

export async function archiveLabourRate(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_labour_cost_rate', { p_id: id });
  if (error) throw new AppError(error.message, error.code);
}

// ── labour class assignments (1720): the class a person in the people register holds from a date ─────────────
export interface LabourClassAssignment {
  id: string; workerId: string; workerName: string | null; classId: string; effectiveFrom: string; effectiveTo: string | null;
}
export interface LabourClassAssignmentInput { workerId: string; classId: string; effectiveFrom: string; effectiveTo?: string | null }
export interface PersonWithoutLogin { id: string; name: string; code: string }

/** Client-side hints only; `save_labour_class_assignment` re-checks every rule. */
export function validateAssignmentInput(i: LabourClassAssignmentInput): string | null {
  if (!i.workerId) return 'person';
  if (!i.classId) return 'class';
  if (!i.effectiveFrom) return 'from';
  if (i.effectiveTo && i.effectiveTo < i.effectiveFrom) return 'dates';
  return null;
}

/** Live assignments, newest start first; Admin, Finance and Executive read them (RLS), anyone else gets none. */
export async function listLabourClassAssignments(): Promise<LabourClassAssignment[]> {
  const rows = await fetchAllPages((from, to) => supabase.from('labour_class_assignments')
    .select('id, worker_id, class_id, effective_from, effective_to, worker:people!labour_class_assignments_worker_id_fkey(name)')
    .is('archived_at', null).order('effective_from', { ascending: false }).order('id', { ascending: true }).range(from, to));
  return rows.map((r) => ({
    id: r.id, workerId: r.worker_id, workerName: r.worker?.name ?? null, classId: r.class_id,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
  }));
}

/** Live people in the register with no login: the people whose approved attendance is costed by class. */
export async function listPeopleWithoutLogin(): Promise<PersonWithoutLogin[]> {
  const rows = await fetchAllPages((from, to) => supabase.from('people').select('id, name, code')
    .is('profile_id', null).is('archived_at', null).order('name', { ascending: true }).order('id', { ascending: true }).range(from, to));
  return rows.map((r) => ({ id: r.id, name: r.name, code: r.code }));
}

export async function saveLabourClassAssignment(i: LabourClassAssignmentInput): Promise<string> {
  const problem = validateAssignmentInput(i);
  if (problem) throw new AppError(problem, 'validation');
  const { data, error } = await supabase.rpc('save_labour_class_assignment', {
    p: { worker_id: i.workerId, class_id: i.classId, effective_from: i.effectiveFrom, effective_to: i.effectiveTo || null },
  });
  if (error) throw new AppError(error.message, error.code);
  return String(data);
}

export async function endLabourClassAssignment(id: string, endDate: string): Promise<void> {
  const { error } = await supabase.rpc('end_labour_class_assignment', { p_id: id, p_end: endDate });
  if (error) throw new AppError(error.message, error.code);
}

export async function archiveLabourClassAssignment(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_labour_class_assignment', { p_id: id });
  if (error) throw new AppError(error.message, error.code);
}
