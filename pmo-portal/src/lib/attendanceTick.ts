import type { AttendanceRowInput, AttendanceStatus } from '@/src/lib/db/attendance';

/**
 * The roster tick screen's model (#2528, FR-CRW-009/010): one crew-wide default hours value, a per-person status
 * and an optional per-person override. Pure, so the rules are unit-proven (AC-CRW-005/006); the database re-checks
 * every one of them on save.
 */

export interface TickPerson {
  status: AttendanceStatus;
  /** Override hours as typed; blank = the crew default. */
  hours: string;
  overtime: string;
  reason: string;
}

export interface TickState {
  defaultHours: string;
  order: string[];
  offRotation: Record<string, boolean>;
  people: Record<string, TickPerson>;
  /** People added from another crew for the day (#crew-followed): saved as following this crew. */
  followers: string[];
}

export type TickError = 'hoursRequired' | 'hoursRange' | 'overtimeRange' | 'reasonRequired';

export interface TickMember {
  worker_id: string;
  off_rotation: boolean;
  /** Told the crew leader they are not coming in: the day starts as absent, not present. */
  reported_absent?: boolean;
}

export interface TickExisting {
  worker_id: string;
  status: AttendanceStatus;
  hours: number | null;
  overtime_hours: number | null;
  reason: string | null;
}

const asText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(Number(n)));

/** Start from the crew's members for the day, pre-filled from any records already held. */
export function initialTickState(members: TickMember[], existing: TickExisting[]): TickState {
  const held = new Map(existing.map((e) => [e.worker_id, e]));
  const people: Record<string, TickPerson> = {};
  const offRotation: Record<string, boolean> = {};
  for (const m of members) {
    offRotation[m.worker_id] = m.off_rotation;
    const e = held.get(m.worker_id);
    people[m.worker_id] = e
      ? { status: e.status, hours: asText(e.hours), overtime: asText(e.overtime_hours), reason: e.reason ?? '' }
      : { status: m.off_rotation ? 'off_rotation' : m.reported_absent ? 'absent' : 'present', hours: '', overtime: '', reason: '' };
  }
  return { defaultHours: '8', order: members.map((m) => m.worker_id), offRotation, people, followers: [] };
}

/** Add a person from another crew to today's tick. A person already listed leaves the state as it was. */
export function addFollower(state: TickState, workerId: string): TickState {
  if (state.people[workerId]) return state;
  return {
    ...state,
    order: [...state.order, workerId],
    offRotation: { ...state.offRotation, [workerId]: false },
    people: { ...state.people, [workerId]: { status: 'present', hours: '', overtime: '', reason: '' } },
    followers: [...state.followers, workerId],
  };
}

function parseHours(text: string): number | null | 'bad' {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 24) return 'bad';
  return Math.round(n * 100) / 100;
}

/** The rows to send, or per-person errors. Any error means nothing is sent. */
export function buildTickRows(state: TickState, followedCrewId?: string): { rows: AttendanceRowInput[]; errors: Record<string, TickError> } {
  const errors: Record<string, TickError> = {};
  const rows: AttendanceRowInput[] = [];
  const crewDefault = parseHours(state.defaultHours);
  for (const id of state.order) {
    const p = state.people[id];
    if (!p) continue;
    const reason = p.reason.trim() || null;
    if (p.status !== 'present') {
      rows.push({ worker_id: id, status: p.status, hours: null, overtime_hours: null, reason,
        ...(followedCrewId && state.followers.includes(id) ? { followed_crew_id: followedCrewId } : {}) });
      continue;
    }
    const own = parseHours(p.hours);
    const overtime = parseHours(p.overtime);
    if (own === 'bad') { errors[id] = 'hoursRange'; continue; }
    const hours = own ?? (crewDefault === 'bad' ? null : crewDefault);
    if (hours === null) { errors[id] = crewDefault === 'bad' ? 'hoursRange' : 'hoursRequired'; continue; }
    if (overtime === 'bad') { errors[id] = 'overtimeRange'; continue; }
    if (state.offRotation[id] && !reason) { errors[id] = 'reasonRequired'; continue; }
    rows.push({ worker_id: id, status: 'present', hours, overtime_hours: overtime, reason,
      ...(followedCrewId && state.followers.includes(id) ? { followed_crew_id: followedCrewId } : {}) });
  }
  return Object.keys(errors).length > 0 ? { rows: [], errors } : { rows, errors };
}

/** The Monday of an ISO date (YYYY-MM-DD), computed in UTC so the result never depends on the browser's zone. */
export function isoWeekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
