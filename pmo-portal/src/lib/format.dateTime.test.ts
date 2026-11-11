import { afterEach, describe, expect, it } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatDecisionDateTime } from './format';

afterEach(() => resetActiveLocale());

describe('shared screen-rule date-time formatting', () => {
  it('uses day-month order, a 24-hour clock, and the viewer timezone', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });

    expect(formatDecisionDateTime(new Date('2026-11-11T10:25:00.000Z'))).toBe('11 Nov 2026, 17:25');
  });
});
