import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';

/**
 * Crews, the people in them and which crews serve a work order (#2528, migration 0988).
 *
 * The database owns every rule: one live code per crew, one crew per person per day, one work order per crew per
 * day, same-organisation references and archive-only-when-unused. This module only carries the request; a refusal
 * keeps its Postgres code (`23505` duplicate, `23P01` overlap, `23514` rule, `42501` not allowed) so
 * `classifyMutationError` and `crewErrorKey` can name it. org_id is never sent: RLS and triggers stamp it.
 */

export type CrewKind = 'own' | 'vendor';

export interface CrewRow {
  id: string;
  code: string;
  name: string;
  kind: CrewKind;
  discipline_id: string | null;
  field_controller_id: string | null;
  vendor_company_id: string | null;
  archived_at: string | null;
}

export interface CrewStandardRoleRow {
  id: string;
  crew_id: string;
  name: string;
  headcount: number;
  sort_order: number;
}

export interface CrewWorkerRow {
  id: string;
  kind: CrewKind;
  display_name: string;
  id_reference: string | null;
  profile_id: string | null;
  vendor_company_id: string | null;
  archived_at: string | null;
}

export interface CrewMemberRow {
  id: string;
  crew_id: string;
  worker_id: string;
  standard_role_id: string | null;
  valid_from: string;
  valid_to: string | null;
  version: number;
}

export interface WorkOrderCrewRow {
  id: string;
  work_order_id: string;
  crew_id: string;
  valid_from: string;
  valid_to: string | null;
  version: number;
}

export interface RosterMember {
  worker_id: string;
  display_name: string;
  kind: CrewKind;
  has_login: boolean;
  standard_role_id: string | null;
}

export interface RosterRole {
  standard_role_id: string;
  name: string;
  headcount: number;
  placed: number;
  shortfall: number;
}

/** One crew rostered on a work order on a date, as `work_order_roster` returns it (FR-CRW-007). */
export interface RosterCrew {
  crew_id: string;
  crew_code: string;
  crew_name: string;
  field_controller_id: string | null;
  members: RosterMember[];
  roles: RosterRole[];
  shortfall: number;
}

export interface WorkOrderOption {
  id: string;
  wo_number: string | null;
  title: string;
  project_id: string;
  status: string;
}

export interface CrewInput {
  code: string;
  name: string;
  kind: CrewKind;
  discipline_id: string | null;
  field_controller_id: string | null;
  vendor_company_id: string | null;
}

export interface StandardRoleInput {
  name: string;
  headcount: number;
}

export interface CrewWorkerInput {
  kind: CrewKind;
  display_name: string;
  id_reference: string | null;
  profile_id: string | null;
  vendor_company_id: string | null;
}

export interface PlacementInput {
  crew_id: string;
  worker_id: string;
  standard_role_id: string | null;
  valid_from: string;
  valid_to: string | null;
}

export interface RosterInput {
  work_order_id: string;
  crew_id: string;
  valid_from: string;
  valid_to: string | null;
}

/** The Postgres code a stale correction gets: someone changed the row since it was read. */
export const STALE_VERSION_CODE = 'PMO_STALE';

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>;

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw new AppError(error.message, error.code);
}

/** Live crews by code. */
export async function listCrews(): Promise<CrewRow[]> {
  const rows = await fetchAllRowsByKeyset<CrewRow>(async (afterId, limit) => {
    let q = supabase
      .from('crews')
      .select('id, code, name, kind, discipline_id, field_controller_id, vendor_company_id, archived_at')
      .is('archived_at', null)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit) as unknown as Page<CrewRow>;
  });
  return rows.sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
}

/** Create a crew with its standard roles. The roles follow the crew row; a refused role leaves the crew in place. */
export async function createCrew(input: CrewInput, roles: StandardRoleInput[]): Promise<CrewRow> {
  const { data, error } = await supabase.from('crews').insert(input).select().single();
  fail(error);
  const crew = data as CrewRow;
  if (roles.length > 0) {
    const { error: roleError } = await supabase.from('crew_standard_roles')
      .insert(roles.map((r, i) => ({ crew_id: crew.id, name: r.name, headcount: r.headcount, sort_order: i })));
    fail(roleError);
  }
  return crew;
}

export async function updateCrew(id: string, patch: Partial<CrewInput> & { archived_at?: string | null }): Promise<void> {
  const { error } = await supabase.from('crews').update(patch).eq('id', id);
  fail(error);
}

export async function listStandardRoles(crewId: string): Promise<CrewStandardRoleRow[]> {
  const rows = await fetchAllRowsByKeyset<CrewStandardRoleRow>(async (afterId, limit) => {
    let q = supabase
      .from('crew_standard_roles')
      .select('id, crew_id, name, headcount, sort_order')
      .eq('crew_id', crewId)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** Live people by name. */
export async function listCrewWorkers(): Promise<CrewWorkerRow[]> {
  const rows = await fetchAllRowsByKeyset<CrewWorkerRow>(async (afterId, limit) => {
    let q = supabase
      .from('crew_workers')
      .select('id, kind, display_name, id_reference, profile_id, vendor_company_id, archived_at')
      .is('archived_at', null)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit) as unknown as Page<CrewWorkerRow>;
  });
  return rows.sort((a, b) => a.display_name.localeCompare(b.display_name) || a.id.localeCompare(b.id));
}

export async function createCrewWorker(input: CrewWorkerInput): Promise<CrewWorkerRow> {
  const { data, error } = await supabase.from('crew_workers').insert(input).select().single();
  fail(error);
  return data as CrewWorkerRow;
}

/** A crew's placements, newest first. */
export async function listCrewMembers(crewId: string): Promise<CrewMemberRow[]> {
  const rows = await fetchAllRowsByKeyset<CrewMemberRow>(async (afterId, limit) => {
    let q = supabase
      .from('crew_members')
      .select('id, crew_id, worker_id, standard_role_id, valid_from, valid_to, version')
      .eq('crew_id', crewId)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows.sort((a, b) => b.valid_from.localeCompare(a.valid_from) || a.id.localeCompare(b.id));
}

export async function placeCrewMember(input: PlacementInput): Promise<void> {
  const { error } = await supabase.from('crew_members').insert(input);
  fail(error);
}

/**
 * Correct a placement (FR-CRW-005). The write names the version it read; if someone changed the row since, nothing
 * is written and this throws `STALE_VERSION_CODE`.
 */
export async function correctCrewMember(
  id: string, version: number, patch: Pick<PlacementInput, 'valid_from' | 'valid_to' | 'standard_role_id'>,
): Promise<void> {
  const { data, error } = await supabase.from('crew_members').update(patch).eq('id', id).eq('version', version).select('id');
  fail(error);
  if (!data || data.length === 0) throw new AppError('This placement changed since you opened it.', STALE_VERSION_CODE);
}

/** A work order's roster placements, newest first. */
export async function listWorkOrderCrews(workOrderId: string): Promise<WorkOrderCrewRow[]> {
  const rows = await fetchAllRowsByKeyset<WorkOrderCrewRow>(async (afterId, limit) => {
    let q = supabase
      .from('work_order_crews')
      .select('id, work_order_id, crew_id, valid_from, valid_to, version')
      .eq('work_order_id', workOrderId)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows.sort((a, b) => b.valid_from.localeCompare(a.valid_from) || a.id.localeCompare(b.id));
}

export async function rosterCrew(input: RosterInput): Promise<void> {
  const { error } = await supabase.from('work_order_crews').insert(input);
  fail(error);
}

export async function correctRoster(id: string, version: number, patch: Pick<RosterInput, 'valid_from' | 'valid_to'>): Promise<void> {
  const { data, error } = await supabase.from('work_order_crews').update(patch).eq('id', id).eq('version', version).select('id');
  fail(error);
  if (!data || data.length === 0) throw new AppError('This roster placement changed since you opened it.', STALE_VERSION_CODE);
}

/** Who serves a work order on a date, with role shortfall (FR-CRW-007). */
export async function getWorkOrderRoster(workOrderId: string, date: string): Promise<RosterCrew[]> {
  const { data, error } = await supabase.rpc('work_order_roster', { p_work_order_id: workOrderId, p_date: date });
  fail(error);
  return ((data ?? []) as unknown as RosterCrew[]).map((c) => ({
    ...c,
    members: Array.isArray(c.members) ? c.members : [],
    roles: Array.isArray(c.roles) ? c.roles : [],
    shortfall: Number(c.shortfall ?? 0),
  }));
}

/** The organisation's work orders that can take a roster (not cancelled), by number then title. */
export async function listOpenWorkOrders(): Promise<WorkOrderOption[]> {
  const rows = await fetchAllRowsByKeyset<WorkOrderOption>(async (afterId, limit) => {
    let q = supabase
      .from('work_orders')
      .select('id, wo_number, title, project_id, status')
      .neq('status', 'Cancelled')
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows.sort((a, b) => (a.wo_number ?? a.title).localeCompare(b.wo_number ?? b.title) || a.id.localeCompare(b.id));
}
