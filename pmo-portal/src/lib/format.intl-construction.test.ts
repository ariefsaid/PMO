import { describe, expect, it, vi } from 'vitest';
import type { ResolvedLocale } from '@/src/lib/locale/resolveLocale';
import type * as FormatModule from './format';

/**
 * Construction-count contract for the formatter cache (perf slice 2, docs/perf-baseline.md
 * "Next slices (2026-11-08)"). The first Intl.DateTimeFormat on a page load costs ~50 ms at 4x
 * CPU (ICU date/timezone-data init), later ones are sub-millisecond — so the COUNT of distinct
 * constructions is the slice's regression metric: it must DROP when shapes that differ only
 * trivially share one formatter, and it must never creep back up.
 *
 * Each test resets the module registry, so the module-level cache starts empty exactly like a
 * fresh page load. The spy counts REAL formatter constructions only: `src/lib/locale/timezones.ts`
 * validates a timezone with a throwaway `Intl.DateTimeFormat(locale, { timeZone })` whose options
 * bag has exactly one key — that validation construction is fixed overhead, not a display shape.
 */

const PROCESS_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const FOREIGN_ZONE = PROCESS_ZONE === 'Asia/Jakarta' ? 'UTC' : 'Asia/Jakarta';

const SUN_NOON_Z = '2026-06-14T12:00:00Z';

async function countFormatterConstructions(
  run: (fmt: typeof FormatModule, setActiveLocale: (resolved: ResolvedLocale) => void) => void,
): Promise<number> {
  vi.resetModules();
  let count = 0;
  const Original = Intl.DateTimeFormat;
  const Spy = new Proxy(Original, {
    construct(target, args, newTarget) {
      const result = Reflect.construct(target, args, newTarget);
      const opts = (args[1] ?? {}) as Record<string, unknown>;
      const isTimezoneValidator = Object.keys(opts).length === 1 && 'timeZone' in opts;
      if (!isTimezoneValidator) count += 1;
      return result;
    },
  });
  (Intl as unknown as { DateTimeFormat: Intl.DateTimeFormatConstructor }).DateTimeFormat = Spy;
  try {
    const fmt = await import('./format');
    const { setActiveLocale } = await import('@/src/lib/locale/activeLocale');
    run(fmt, setActiveLocale);
  } finally {
    (Intl as unknown as { DateTimeFormat: Intl.DateTimeFormatConstructor }).DateTimeFormat = Original;
  }
  return count;
}

describe('first-render Intl.DateTimeFormat construction count (the slice-2 regression metric)', () => {
  it('a profile timezone equal to the runtime default shares the local twins: the 4-shape date quartet costs 2 constructions, not 4', async () => {
    const count = await countFormatterConstructions((fmt, setActiveLocale) => {
      setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: PROCESS_ZONE });
      fmt.formatDate('2026-06-14');
      fmt.formatInstantDate(SUN_NOON_Z);
      fmt.formatDateOnlyNumeric('2026-06-14');
      fmt.formatInstantDateNumeric(SUN_NOON_Z);
    });
    expect(count).toBe(2); // one 'date' + one 'dateOnlyNumeric' — the zoned twins merge into them
  });

  it('the zoned wall-parts trio (isoDay + wallTime + wallTimeSec) costs 1 construction, not 3', async () => {
    const count = await countFormatterConstructions((fmt, setActiveLocale) => {
      setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: PROCESS_ZONE });
      fmt.formatCalendarDayInTimeZone(new Date(SUN_NOON_Z), PROCESS_ZONE);
      fmt.instantToZonedDatetimeLocal(new Date(SUN_NOON_Z), PROCESS_ZONE);
      expect(fmt.zonedDatetimeLocalToInstant('2026-06-14T19:00', PROCESS_ZONE)?.toISOString()).toBe('2026-06-14T12:00:00.000Z');
    });
    expect(count).toBe(1); // all three consume formatToParts fields of the same union formatter
  });

  it('a zoned call that ran BEFORE the runtime default was learned is reused, not rebuilt, by later zone-equal calls', async () => {
    // The real page order (captured on /projects/:id): the union wall-parts formatter is built
    // with an explicit zone first (default still unknown), a local date cell teaches the default
    // later, then another org-day stamp arrives with a zone that now EQUALS the default. That
    // last call must share the already-built formatter instead of constructing a second one.
    const count = await countFormatterConstructions((fmt, setActiveLocale) => {
      setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: PROCESS_ZONE });
      fmt.formatCalendarDayInTimeZone(new Date(SUN_NOON_Z), PROCESS_ZONE); // default unknown: builds with explicit zone
      fmt.formatDate('2026-06-14'); // local twin teaches the runtime default
      expect(fmt.formatCalendarDayInTimeZone(new Date(SUN_NOON_Z), PROCESS_ZONE)).toBe('2026-06-14');
    });
    expect(count).toBe(2); // the union + the local date — the repeated stamp aliases the union
  });

  it('GUARD: a profile timezone that is NOT the runtime default still builds its own zoned formatter', async () => {
    const count = await countFormatterConstructions((fmt, setActiveLocale) => {
      setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: FOREIGN_ZONE });
      fmt.formatDate('2026-06-14');
      fmt.formatInstantDate(SUN_NOON_Z);
    });
    expect(count).toBe(2); // over-merging here would render a foreign zone's calendar day
  });

  it('GUARD: the cache stays keyed by locale — en then id construct separately (poisoning guard)', async () => {
    const count = await countFormatterConstructions((fmt, setActiveLocale) => {
      setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: PROCESS_ZONE });
      fmt.formatFullDate(new Date(2026, 5, 14));
      setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: PROCESS_ZONE });
      expect(fmt.formatFullDate(new Date(2026, 5, 14))).toBe('14 Jun 2026');
    });
    expect(count).toBe(2);
  });
});
