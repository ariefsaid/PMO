/**
 * Daily safety records — pure derivations (#2596, docs/specs/daily-safety-records.spec.md).
 * The database is the authority (it reports the same missing parts per day); these functions render the same rules
 * for the form and the summary without a round trip. Hours are integer minutes; nothing here uses floats.
 */
export type SafetyPart = 'toolbox_talk_photo' | 'checklist' | 'fitness_check';

export interface SafetyDayParts {
  status: 'draft' | 'locked';
  /** Workers with a `present` attendance row on the day. */
  presentWorkerIds: string[];
  fitness: { workerId: string | null; result: 'fit' | 'not_fit' | 'not_checked' }[];
  talks: { photoCount: number }[];
  checklist: { answer: 'yes' | 'no' | 'not_applicable' | null }[];
}

export interface SafetyDayStatus {
  complete: boolean;
  missing: SafetyPart[];
}

/** A day is complete when locked, with a photographed talk, no unanswered checklist item and a fitness check for everyone present. */
export function deriveSafetyDayStatus(day: SafetyDayParts): SafetyDayStatus {
  const missing: SafetyPart[] = [];
  if (!day.talks.some((t) => t.photoCount > 0)) missing.push('toolbox_talk_photo');
  if (day.checklist.some((c) => c.answer === null)) missing.push('checklist');
  const checked = new Set(day.fitness.filter((f) => f.workerId && f.result !== 'not_checked').map((f) => f.workerId as string));
  if (day.presentWorkerIds.some((id) => !checked.has(id))) missing.push('fitness_check');
  return { complete: day.status === 'locked' && missing.length === 0, missing };
}

export interface SafetySummary {
  month: string;
  timezone: string;
  projectId: string | null;
  workedMinutes: number | null;
  safeMinutes: number | null;
  lostTimeIncidents: number;
  recordableIncidents: number;
  nearMisses: number;
  toolboxTalks: number;
  completeDays: number;
  daysWithoutRecord: number;
  /** figure key -> the one-line reason it is not shown */
  hidden: Partial<Record<'workedMinutes' | 'safeMinutes', string>>;
}

export type SafetyFigureKey =
  | 'workedMinutes' | 'safeMinutes' | 'lostTimeIncidents' | 'recordableIncidents'
  | 'nearMisses' | 'toolboxTalks' | 'completeDays' | 'daysWithoutRecord';

export interface SafetyFigure {
  key: SafetyFigureKey;
  value: number | null;
  hidden: boolean;
  reason: string | null;
  /** the unit of the value: whole minutes or a plain count */
  unit: 'minutes' | 'count';
}

const ORDER: { key: SafetyFigureKey; unit: SafetyFigure['unit'] }[] = [
  { key: 'workedMinutes', unit: 'minutes' },
  { key: 'safeMinutes', unit: 'minutes' },
  { key: 'lostTimeIncidents', unit: 'count' },
  { key: 'recordableIncidents', unit: 'count' },
  { key: 'nearMisses', unit: 'count' },
  { key: 'toolboxTalks', unit: 'count' },
  { key: 'completeDays', unit: 'count' },
  { key: 'daysWithoutRecord', unit: 'count' },
];

/** Every figure with its value, or hidden with a reason. A null is never turned into 0. */
export function deriveSafetySummaryView(s: SafetySummary): SafetyFigure[] {
  return ORDER.map(({ key, unit }) => {
    const raw = s[key];
    if (raw === null || raw === undefined) {
      const reason = (s.hidden as Record<string, string | undefined>)[key] ?? null;
      return { key, unit, value: null, hidden: true, reason };
    }
    return { key, unit, value: raw, hidden: false, reason: null };
  });
}

export function formatSafetyMinutes(minutes: number): string {
  const m = Math.max(0, Math.trunc(minutes));
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export type SafetyClientExport = Omit<SafetySummary, 'timezone' | 'projectId' | 'hidden'>;

/** The read-only client page: figures and the month only. No photo, name, project or reference. */
export function toClientExport(s: SafetySummary): SafetyClientExport {
  return {
    month: s.month,
    workedMinutes: s.workedMinutes,
    safeMinutes: s.safeMinutes,
    lostTimeIncidents: s.lostTimeIncidents,
    recordableIncidents: s.recordableIncidents,
    nearMisses: s.nearMisses,
    toolboxTalks: s.toolboxTalks,
    completeDays: s.completeDays,
    daysWithoutRecord: s.daysWithoutRecord,
  };
}
