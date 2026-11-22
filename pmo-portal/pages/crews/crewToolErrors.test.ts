import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { crewToolErrorMessage } from './crewToolErrors';

const t = ((_key: string, fallback: string, opts?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts?.[k] ?? ''))) as TFunction;

describe('crew tool errors', () => {
  it('AC-CTR-001 names the usable quantity when a report is larger', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_QTY_EXCEEDS_USABLE: only 3 usable' })).toBe('Only 3 usable. Report that many or fewer.');
  });
  it('AC-CTR-006 asks for the photo of a damaged tool', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_PHOTO_REQUIRED: add a photo of the damaged tool' })).toBe('Add a photo of the damaged tool.');
  });
  it('AC-CTR-002 explains a duplicate serial', () => {
    expect(crewToolErrorMessage(t, { code: '23505', message: 'duplicate key value violates unique constraint "crew_tool_lines_serial_live"' }))
      .toBe('That serial number is already on a live tool line.');
  });
  it('AC-CTR-014 tells the person to choose a resolution when the task was set Done directly', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_RESOLVE_REQUIRED: choose a resolution' })).toMatch(/Choose a resolution/);
  });
  it('falls back to the crew messages for an archive guard', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CRW_ARCHIVE_IN_USE: x' })).toMatch(/tool lines|End this crew/);
  });
  it('AC-CTR-008 asks for the photo again when an upload failed', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_PHOTO: upload lost' })).toBe('A photo did not upload. Add it again.');
  });
  it('AC-CTR-009 names the role restriction', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_NOT_ALLOWED: nope' })).toBe('Your role cannot do this.');
  });
  it('AC-CTR-013 refuses writes to a closed report', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_REPORT_CLOSED: closed' })).toBe('This report is already closed.');
  });
  it('AC-CTR-011 demands a reason for a correction', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_REASON_REQUIRED: reason' })).toBe('Give a reason for the correction.');
  });
  it('only a damaged tool can be repaired', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_RESOLUTION: not damaged' })).toBe('Only a damaged tool can be repaired.');
  });
  it('a tool line with open reports cannot be archived', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_LINE_OPEN_REPORTS: open' })).toBe("Close this tool's open reports first.");
  });
  it('an archived tool line says so', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_LINE_ARCHIVED: archived' })).toBe('This tool line is archived.');
  });
  it('AC-CTR-001 explains the quantity rules of a line', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_QTY: check' })).toContain('a line holds at least 1');
  });
  it('AC-CTR-012 refuses a reference outside the organisation', () => {
    expect(crewToolErrorMessage(t, { code: '23514', message: 'CTR_REF: other org' })).toBe('Choose a crew or user of this organisation.');
  });
  it('AC-CTR-010 says when the report was already sent', () => {
    expect(crewToolErrorMessage(t, { code: '23505', message: 'duplicate key: report id 7' })).toBe('This report was already sent.');
  });
});
