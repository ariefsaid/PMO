import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';

/**
 * Medical release (migrations 1750-1752). The people team opens a release for a person and a date; the person's direct
 * manager approves or defers it; until then the database refuses to roster the person. Every write is an RPC and the
 * database owns the rules. A release carries a decision and a short note, never medical content. org_id is never sent.
 */
const fail = (error: { message: string; code?: string } | null): void => {
  if (error) throw new AppError(error.message, error.code);
};

export type ReleaseStatus = 'Pending' | 'Approved' | 'Deferred';
export type ReleaseState = 'pending' | 'deferred';

export interface MedicalReleaseRow {
  id: string;
  person_id: string;
  person_name: string;
  release_date: string;
  status: ReleaseStatus;
  note: string | null;
  decided_at: string | null;
  decision_note: string | null;
  can_decide: boolean;
  /** The release is the viewer's own (never withdrawn by them). */
  own: boolean;
  /** The decider fixed at opening is still an active member (an Admin reassigns only one who has left). */
  decider_active: boolean;
}
export interface ReleasePerson { id: string; name: string }

export async function listMedicalReleases(): Promise<MedicalReleaseRow[]> {
  const { data, error } = await supabase.rpc('medical_releases_visible');
  fail(error);
  // `returns table` states no nullability: the note and the decision are genuinely absent until given.
  return (data ?? []).map((r) => ({
    ...r,
    status: r.status as ReleaseStatus,
    note: r.note ?? null,
    decided_at: r.decided_at ?? null,
    decision_note: r.decision_note ?? null,
  }));
}

export async function canEnterMedicalRelease(): Promise<boolean> {
  const { data, error } = await supabase.rpc('medical_release_can_enter');
  fail(error);
  return data === true;
}

export async function listReleasePeople(): Promise<ReleasePerson[]> {
  const { data, error } = await supabase.from('people').select('id, name').is('archived_at', null).order('name').limit(500);
  fail(error);
  return data ?? [];
}

export async function createMedicalRelease(personId: string, date: string, note: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('medical_release_create', { p_person_id: personId, p_date: date, p_note: nullableArg(note) });
  fail(error);
  // The function returns the new release's id or raises; it never resolves null.
  return data as string;
}

/** An Admin or the people team withdraws a release that is not approved, with a reason (1934); the roster block lifts. */
export async function withdrawMedicalRelease(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('medical_release_withdraw', { p_id: id, p_reason: reason });
  fail(error);
}

/** An Admin moves a release to the person's current direct manager once the fixed decider has left (1934). */
export async function reassignMedicalRelease(id: string): Promise<void> {
  const { error } = await supabase.rpc('medical_release_reassign', { p_id: id });
  fail(error);
}

export async function decideMedicalRelease(id: string, decision: 'Approved' | 'Deferred', note: string | null): Promise<void> {
  const { error } = await supabase.rpc('medical_release_decide', { p_id: id, p_decision: decision, p_note: nullableArg(note) });
  fail(error);
}

/** People held from rostering on a date, with the state word only (pending or deferred). */
export async function listReleaseHolds(date: string): Promise<Map<string, ReleaseState>> {
  const { data, error } = await supabase.rpc('medical_release_holds', { p_date: date });
  fail(error);
  return new Map((data ?? []).map((h) => [h.person_id, h.state === 'deferred' ? 'deferred' : 'pending'] as const));
}
