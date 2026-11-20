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
});
