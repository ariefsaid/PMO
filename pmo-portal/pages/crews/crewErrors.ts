import { useTranslation } from 'react-i18next';
import { STALE_VERSION_CODE } from '@/src/lib/repositories/crews';
import { refusalLine, useRefusalText } from '@/src/lib/refusals';

type Err = { code?: string; message?: string } | null;
const read = (err: unknown): { code: string; message: string } => {
  const e = err as Err;
  return { code: e?.code ?? '', message: e?.message ?? '' };
};

/**
 * One sentence for a refused crew, roster or attendance write (#2528). A rule the database names (`ATT_LOCKED: …`) reads
 * from the `refusals` catalogue; this adds only the Postgres constraint cases, which carry no code of ours.
 */
export function useCrewErrorText(): (err: unknown) => string {
  const { t } = useTranslation('crews');
  const refusal = useRefusalText();
  return (err) => {
    const { code, message } = read(err);
    if (code === STALE_VERSION_CODE) return t('crews:errors.stale', 'Someone changed this since you opened it. Reload and try again.');
    if (code === '23505') {
      if (message.includes('people_profile_live')) return t('crews:errors.linkedUser', 'That user is already linked to a person. Select that person instead.');
      if (message.includes('crew_standard_roles_name')) return t('crews:errors.duplicateRole', 'That standard role is already listed for this crew.');
      return t('crews:errors.duplicateCode', 'That code is already used by a live crew.');
    }
    if (code === '23P01' && message.includes('crew_loans_no_overlap')) return t('crews:errors.loanOverlap', 'This person is already on loan on some of these days.');
    if (code === '23P01') return t('crews:errors.overlap', 'These dates overlap another placement. End that one first.');
    if (message.startsWith('separation of duties')) return t('crews:errors.sod', 'You recorded these hours, so someone else approves them.');
    return refusalLine(refusal(err));
  };
}

/** One sentence for a refused tool-register write (#2581): a duplicate serial or report, else a crew or refusal sentence. */
export function useCrewToolErrorText(): (err: unknown) => string {
  const { t } = useTranslation('crewTools');
  const crewText = useCrewErrorText();
  return (err) => {
    const { code, message } = read(err);
    if (code === '23505') {
      if (message.includes('crew_tool_lines_serial_live')) return t('crewTools:errors.duplicateSerial', 'That serial number is already on a live tool line.');
      if (message.includes('report id')) return t('crewTools:errors.alreadySent', 'This report was already sent.');
    }
    return crewText(err);
  };
}

/** One sentence for a refused leave write (#2708): a duplicate leave type, else a refusal sentence. */
export function useLeaveErrorText(): (err: unknown) => string {
  const { t } = useTranslation('crews');
  const refusal = useRefusalText();
  return (err) => (read(err).code === '23505'
    ? t('crews:leave.errors.duplicateType', 'That leave type already exists.')
    : refusalLine(refusal(err)));
}

/** One sentence for a refused medical-release write: a refusal sentence saying what to do next. */
export function useReleaseErrorText(): (err: unknown) => string {
  const refusal = useRefusalText();
  return (err) => refusalLine(refusal(err));
}
