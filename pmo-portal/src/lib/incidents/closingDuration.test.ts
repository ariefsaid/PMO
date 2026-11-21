import { describe, it, expect } from 'vitest';
import { formatClosingDuration } from './closingDuration';

describe('formatClosingDuration', () => {
  it('returns em-dash for null, undefined or NaN', () => {
    expect(formatClosingDuration(null)).toBe('—');
    expect(formatClosingDuration(undefined)).toBe('—');
    expect(formatClosingDuration(Number.NaN)).toBe('—');
  });

  it('formats hours >= 48 as days with one decimal', () => {
    expect(formatClosingDuration(48)).toBe('2.0 days');
    expect(formatClosingDuration(60)).toBe('2.5 days');
    expect(formatClosingDuration(72.4)).toBe('3.0 days');
  });

  it('formats hours between 1 and 47 as rounded hours', () => {
    expect(formatClosingDuration(1)).toBe('1 hrs');
    expect(formatClosingDuration(10.2)).toBe('10 hrs');
    expect(formatClosingDuration(42.4)).toBe('42 hrs');
  });

  it('formats hours < 1 as minutes', () => {
    expect(formatClosingDuration(0.5)).toBe('30 mins');
    expect(formatClosingDuration(0.1)).toBe('6 mins');
    expect(formatClosingDuration(0)).toBe('1 mins');
  });

  it('uses translation callback when provided', () => {
    const mockT = (key: string, _fb: string, opts?: Record<string, unknown>) => {
      if (key === 'closingReport.durationDays') return `${String(opts?.days)} hari`;
      if (key === 'closingReport.durationHours') return `${String(opts?.count)} jam`;
      if (key === 'closingReport.durationMinutes') return `${String(opts?.count)} menit`;
      return _fb;
    };
    expect(formatClosingDuration(60, mockT)).toBe('2.5 hari');
    expect(formatClosingDuration(10, mockT)).toBe('10 jam');
    expect(formatClosingDuration(0.5, mockT)).toBe('30 menit');
  });
});
