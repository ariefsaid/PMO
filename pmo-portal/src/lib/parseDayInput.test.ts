import { describe, expect, it } from 'vitest';
import { parseDayInput } from './parseDayInput';

describe('parseDayInput', () => {
  it.each([
    ['16 Nov 2026', '2026-11-16'],
    ['16 November 2026', '2026-11-16'],
    ['16 nov 2026', '2026-11-16'],
    ['6 Nov 2026', '2026-11-06'],
    ['16/11/2026', '2026-11-16'],
    ['16-11-2026', '2026-11-16'],
    ['6/1/2026', '2026-01-06'],
    ['2026-11-16', '2026-11-16'],
    ['  16 Nov 2026 ', '2026-11-16'],
  ])('reads %s as %s', (typed, iso) => {
    expect(parseDayInput(typed)).toBe(iso);
  });

  it.each([
    ['17 Agu 2026', '2026-08-17'],
    ['17 Agustus 2026', '2026-08-17'],
    ['3 Mei 2026', '2026-05-03'],
    ['25 Des 2026', '2026-12-25'],
    ['9 Okt 2026', '2026-10-09'],
  ])('reads the Bahasa Indonesia form %s as %s', (typed, iso) => {
    expect(parseDayInput(typed)).toBe(iso);
  });

  it.each(['', 'tomorrow', '31/02/2026', '2026-02-30', '16 Foo 2026', '16 Nov 26', '16 Nov', '16/11', '2026-13-01', '0/1/2026'])(
    'refuses %j',
    (typed) => {
      expect(parseDayInput(typed)).toBeNull();
    },
  );
});
