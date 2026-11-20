import type { TFunction } from 'i18next';
import { crewErrorMessage } from './crewErrors';

/**
 * One sentence for a refused tool-register write (#2581). The database names the rule in a stable prefix
 * (`CTR_QTY_EXCEEDS_USABLE: only 3 usable`) or a Postgres code; this maps each to the field-level message the
 * spec's Errors table asks for and falls back to the crew messages and the shared classifier.
 */
export function crewToolErrorMessage(t: TFunction, err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code ?? '';
  const message = e?.message ?? '';
  const prefix = /^([A-Z_]+):/.exec(message)?.[1] ?? '';
  if (code === '23505') {
    if (message.includes('crew_tool_lines_serial_live')) return t('crewTools:errors.duplicateSerial', 'That serial number is already on a live tool line.');
    if (message.includes('report id')) return t('crewTools:errors.alreadySent', 'This report was already sent.');
  }
  switch (prefix) {
    case 'CTR_QTY_EXCEEDS_USABLE':
      return t('crewTools:errors.exceedsUsable', 'Only {{usable}} usable. Report that many or fewer.', { usable: /only (\d+) usable/.exec(message)?.[1] ?? '0' });
    case 'CTR_PHOTO_REQUIRED': return t('crewTools:errors.photoRequired', 'Add a photo of the damaged tool.');
    case 'CTR_PHOTO': return t('crewTools:errors.photoMissing', 'A photo did not upload. Add it again.');
    case 'CTR_NOT_ALLOWED': return t('crewTools:errors.notAllowed', 'Your role cannot do this.');
    case 'CTR_REPORT_CLOSED': return t('crewTools:errors.closed', 'This report is already closed.');
    case 'CTR_REASON_REQUIRED': return t('crewTools:errors.reason', 'Give a reason for the correction.');
    case 'CTR_RESOLUTION': return t('crewTools:errors.resolution', 'Only a damaged tool can be repaired.');
    case 'CTR_RESOLVE_REQUIRED': return t('crewTools:errors.resolveRequired', 'Choose a resolution to finish this tool report. Open Crews, Tools.');
    case 'CTR_LINE_OPEN_REPORTS': return t('crewTools:errors.openReports', 'Close this tool\'s open reports first.');
    case 'CTR_LINE_ARCHIVED': return t('crewTools:errors.lineArchived', 'This tool line is archived.');
    case 'CTR_QTY': return t('crewTools:errors.quantity', 'Check the quantity: a line holds at least 1 (exactly 1 with a serial number) and not less than its open reports.');
    case 'CTR_REF': return t('crewTools:errors.reference', 'Choose a crew or user of this organisation.');
    default: return crewErrorMessage(t, err);
  }
}
