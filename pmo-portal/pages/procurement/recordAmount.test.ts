import { afterEach, describe, expect, it } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { parseRecordAmount } from './recordAmount';

afterEach(() => resetActiveLocale());

describe('parseRecordAmount', () => {
  it('AC-PLC-009: blank stays unset; the viewer convention decides 1.234; excess scale is refused', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    expect(parseRecordAmount('  ')).toEqual({ ok: true, amount: null });
    expect(parseRecordAmount('1,234.50')).toEqual({ ok: true, amount: 1234.5 });
    expect(parseRecordAmount('1.234')).toEqual({ ok: false });
    expect(parseRecordAmount('12abc')).toEqual({ ok: false });

    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    expect(parseRecordAmount('1.234')).toEqual({ ok: true, amount: 1234 });
    expect(parseRecordAmount('1.234,567')).toEqual({ ok: false });
  });
});
