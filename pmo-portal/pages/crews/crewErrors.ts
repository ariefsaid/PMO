import type { TFunction } from 'i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { STALE_VERSION_CODE } from '@/src/lib/repositories/crews';
import { formatDay } from '@/src/lib/format';

/**
 * One sentence for a refused crew, roster or attendance write (#2528). The database names the rule in a stable prefix
 * (`ATT_LOCKED: …`, `CRW_ARCHIVE_IN_USE: …`) or a Postgres code; this maps each to the field-level message the spec's
 * Errors table asks for, and falls back to the shared classifier.
 */
export function crewErrorMessage(t: TFunction, err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code ?? '';
  const message = e?.message ?? '';
  const prefix = /^([A-Z_]+):/.exec(message)?.[1] ?? '';
  const after = message.replace(/^[A-Z_]+:\s*/, '');
  if (code === STALE_VERSION_CODE) return t('crews:errors.stale', 'Someone changed this since you opened it. Reload and try again.');
  if (code === '23505') {
    if (message.includes('people_profile_live')) return t('crews:errors.linkedUser', 'That user is already linked to a person. Select that person instead.');
    if (message.includes('crew_standard_roles_name')) return t('crews:errors.duplicateRole', 'That standard role is already listed for this crew.');
    return t('crews:errors.duplicateCode', 'That code is already used by a live crew.');
  }
  if (code === '23P01' && message.includes('crew_loans_no_overlap')) return t('crews:errors.loanOverlap', 'This person is already on loan on some of these days.');
  if (code === '23P01') return t('crews:errors.overlap', 'These dates overlap another placement. End that one first.');
  switch (prefix) {
    case 'CRW_ARCHIVE_IN_USE': return t('crews:errors.archiveInUse', 'End this crew\'s current and future members and roster placements first.');
    case 'LOAN_CREW': return t('crews:errors.loanCrew', 'Choose two different live crews of this organisation.');
    case 'LOAN_HOME': return t('crews:errors.loanHome', 'The person must be placed in the home crew for the whole loan.');
    case 'LOAN_HOURS_LOCKED':
      return t('crews:errors.loanLocked', 'Hours on {{date}} are already sent for approval or approved, so the crew for that day cannot change.',
        { date: formatDay(/\d{4}-\d{2}-\d{2}/.exec(after)?.[0] ?? '') });
    case 'ATT_LOCKED': return t('crews:errors.locked', 'This day is approved. Re-open the timesheet to correct it.');
    case 'ATT_SUBMITTED': return t('crews:errors.submitted', 'This week is sent for approval. Return it to change a day.');
    case 'ATT_NOT_ROSTERED': return t('crews:errors.notRostered', 'This person is not in a crew rostered on this work order that day.');
    case 'ATT_OFF_ROTATION': return t('crews:errors.offRotation', 'This person is off rotation that day. Give a reason to mark them present.');
    case 'ATT_DAY_CEILING': {
      const m = /already has ([\d.]+) hours on (.+) that day/.exec(after);
      return t('crews:errors.ceiling', 'This person already has {{hours}} hours on {{workOrder}} that day. A day holds at most 24.',
        { hours: m?.[1] ?? '', workOrder: m?.[2] ?? '' });
    }
    case 'ATT_DATE_WINDOW':
      return t('crews:errors.window', 'The earliest date open for attendance is {{date}}.', { date: formatDay(/\d{4}-\d{2}-\d{2}/.exec(after)?.[0] ?? '') });
    case 'ATT_TS_MANUAL_ENTRY':
      return t('crews:errors.manualEntry', 'The timesheet already has a typed line for {{date}} on that project.',
        { date: formatDay(/\d{4}-\d{2}-\d{2}/.exec(after)?.[0] ?? '') });
    case 'ATT_DATE_FUTURE': return t('crews:errors.future', 'Attendance cannot be recorded for a future date.');
    case 'ATT_NEEDS_REVIEW': return t('crews:errors.needsReview', 'Settle the days where check-in and roster disagree first.');
    case 'ATT_TS_NOT_DRAFT': return t('crews:errors.notDraft', 'This week\'s timesheet is already sent. Change it through the timesheet correction path.');
    case 'ATT_WEEK_EMPTY': return t('crews:errors.weekEmpty', 'This person has no present days that week.');
    case 'ATT_TS_SPLIT_DAY': return t('crews:errors.splitDay', 'A day is split across two work orders of one project. Correct the attendance first.');
    default: break;
  }
  if (message.startsWith('separation of duties')) return t('crews:errors.sod', 'You recorded these hours, so someone else approves them.');
  const c = classifyMutationError(err);
  return `${c.headline}. ${c.detail}`;
}
