import { describe, it, expect } from 'vitest';
import { cellType } from '../cellType';

describe('cellType', () => {
  it('AC-EXP-003: classifies number, ISO date, and text values', () => {
    expect(cellType(1500)).toBe('number');
    expect(cellType(0)).toBe('number');
    expect(cellType(-42.5)).toBe('number');
    expect(cellType('2026-06-13')).toBe('date');
    expect(cellType('In Progress')).toBe('text');
    expect(cellType('2026-13-99')).toBe('text'); // shaped like ISO but not a real date → text
    expect(cellType('2026-02-30')).toBe('text'); // invalid calendar day → text
    expect(cellType('2026-6-1')).toBe('text'); // not zero-padded → text
    expect(cellType(true)).toBe('text');
  });

  it('LIB02-003: respects declared column cell type and validates calendar dates', () => {
    // Declared date column with valid date
    expect(cellType('2026-06-13', 'date')).toBe('date');
    // Declared date column with invalid calendar date leaves text unchanged
    expect(cellType('2026-02-30', 'date')).toBe('text');
    expect(cellType('2026-04-31', 'date')).toBe('text');
    // Declared text column keeps valid date-shaped string as text
    expect(cellType('2026-06-13', 'text')).toBe('text');
    expect(cellType('2026-02-30', 'text')).toBe('text');
    // Declared number column or numeric input
    expect(cellType(1500, 'number')).toBe('number');
  });

  it('AC-EXP-003: non-finite numbers fall back to text', () => {
    expect(cellType(NaN)).toBe('text');
    expect(cellType(Infinity)).toBe('text');
  });
});
