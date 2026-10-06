import { describe, expect, it } from 'vitest';
import {
  daysBetween, escapeMarkdownText, formatMoney, formatShortDate, isMoney, isoDateInZone, resolveNumberLocale,
} from '../../../../supabase/functions/agent-chat/agentFormat';

describe('agentFormat (#787)', () => {
  it('AC-AIN-012 a link-shaped name is escaped to plain text', () => {
    expect(escapeMarkdownText('[x](https://evil.example)')).toBe('\\[x\\]\\(https:\u200B//evil.example\\)');
    expect(escapeMarkdownText('www.evil.example a@b.example')).toBe('www\u200B.evil.example a@\u200Bb.example');
    expect(escapeMarkdownText('a*b_c<script>')).toBe('a\\*b\\_c\\<script\\>');
    expect(escapeMarkdownText('line1\nline2')).toBe('line1 line2');
    expect(escapeMarkdownText('x'.repeat(300))).toHaveLength(200);
  });
  it('FR-AIN-002 today is the calendar date in the given zone', () => {
    const now = new Date('2026-10-05T18:00:00Z');
    expect(isoDateInZone(now, 'Asia/Jakarta')).toBe('2026-10-06');
    expect(isoDateInZone(now, 'UTC')).toBe('2026-10-05');
    expect(isoDateInZone(now, 'Not/AZone')).toBe('2026-10-05');
  });
  it('days, short dates, money, locale, money predicate', () => {
    expect(daysBetween('2026-10-01', '2026-10-06')).toBe(5);
    expect(formatShortDate('2026-10-02')).toBe('2 Oct');
    expect(formatMoney(1500.5, 'USD', 'en-US')).toBe('$1,500.50');
    expect(formatMoney(1, 'N', 'en-US')).toBe('N 1.00');
    expect(resolveNumberLocale({ default_number_locale: null, default_locale: 'id-ID' })).toBe('id-ID');
    expect(resolveNumberLocale(null)).toBe('en-US');
    expect(isMoney(1000000)).toBe(true);
    expect(isMoney(10.005)).toBe(false);
    expect(isMoney(0)).toBe(false);
    expect(isMoney(1e12)).toBe(false);
  });
});
