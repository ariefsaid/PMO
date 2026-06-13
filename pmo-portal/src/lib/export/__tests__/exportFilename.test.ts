import { describe, it, expect } from 'vitest';
import { exportFilename } from '../exportFilename';

describe('exportFilename', () => {
  it('AC-EXP-004: builds <Entity>_<YYYY-MM-DD>.xlsx from an injected date', () => {
    expect(exportFilename('Companies', new Date('2026-06-14T09:00:00'))).toBe(
      'Companies_2026-06-14.xlsx',
    );
    expect(exportFilename('Projects', new Date('2026-06-13T23:59:59'))).toBe(
      'Projects_2026-06-13.xlsx',
    );
  });

  it('AC-EXP-004: zero-pads single-digit months and days', () => {
    expect(exportFilename('Procurement', new Date('2026-01-05T12:00:00'))).toBe(
      'Procurement_2026-01-05.xlsx',
    );
  });

  it('AC-EXP-004: defaults to today when no date is supplied', () => {
    const name = exportFilename('Incidents');
    expect(name).toMatch(/^Incidents_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
