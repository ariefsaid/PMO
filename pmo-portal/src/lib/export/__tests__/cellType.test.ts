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
    expect(cellType('2026-6-1')).toBe('text'); // not zero-padded → text
    expect(cellType(true)).toBe('text');
  });

  it('AC-EXP-003: non-finite numbers fall back to text', () => {
    expect(cellType(NaN)).toBe('text');
    expect(cellType(Infinity)).toBe('text');
  });
});
