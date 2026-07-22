/**
 * AC-TSP-033 — deterministic time-log packing (FR-TSP-062/063/055).
 *
 * PMO stores `entry_date` + `hours` and NO clock times; ERP's `time_logs[]` needs real datetimes
 * (spike §1). These tests pin the three properties the live bench proved are load-bearing:
 *  - the emitted datetimes are NAIVE site-local `'YYYY-MM-DD HH:MM:SS'` — a `Z`/offset-suffixed
 *    string is an unguarded raw ERP 500 (spike §4), so it must be impossible by construction;
 *  - rows never overlap (spike §3: ERPNext's overlap validator rejects the whole document) and the
 *    output is byte-identical across calls (a recovery re-push must rebuild the same body);
 *  - a day summing over 24h THROWS before any ERP call (spike §7: ERP accepts the spill silently and
 *    quietly mis-dates the tail into the next ERP day).
 */
import { describe, expect, it } from 'vitest';
import { packTimeLogs } from './timeLogPacking.ts';

const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('erpnext/timeLogPacking', () => {
  it('AC-TSP-033 packs one day sequentially from the day start, in stable (entry_date, project_id) order', () => {
    const logs = packTimeLogs(
      [
        { project_id: 'p-c', entry_date: '2026-07-20', hours: '1.5' },
        { project_id: 'p-a', entry_date: '2026-07-20', hours: '2.5' },
        { project_id: 'p-b', entry_date: '2026-07-20', hours: '3' },
      ],
      '09:00:00',
    );

    expect(logs).toEqual([
      { entry_date: '2026-07-20', project_id: 'p-a', from_time: '2026-07-20 09:00:00', to_time: '2026-07-20 11:30:00', hours: '2.5' },
      { entry_date: '2026-07-20', project_id: 'p-b', from_time: '2026-07-20 11:30:00', to_time: '2026-07-20 14:30:00', hours: '3' },
      { entry_date: '2026-07-20', project_id: 'p-c', from_time: '2026-07-20 14:30:00', to_time: '2026-07-20 16:00:00', hours: '1.5' },
    ]);
  });

  it('AC-TSP-033 emits BOTH from_time and to_time as naive site-local strings (never Z/offset — spike §4 raw 500)', () => {
    const logs = packTimeLogs([{ project_id: 'p-a', entry_date: '2026-07-20', hours: '0.05' }], '09:00:00');
    for (const log of logs) {
      expect(log.from_time).toMatch(NAIVE_DATETIME);
      expect(log.to_time).toMatch(NAIVE_DATETIME);
      expect(log.from_time).not.toMatch(/[TZ+]/);
      expect(log.to_time).not.toMatch(/[TZ+]/);
    }
    // 0.05h = 3 minutes — decimal-string hours, integer-minute arithmetic, no float drift.
    expect(logs[0].to_time).toBe('2026-07-20 09:03:00');
  });

  it('AC-TSP-033 produces byte-identical output across two calls (a re-push must rebuild the same body)', () => {
    const entries = [
      { project_id: 'p-b', entry_date: '2026-07-21', hours: '4' },
      { project_id: 'p-a', entry_date: '2026-07-20', hours: '4' },
    ];
    expect(JSON.stringify(packTimeLogs(entries, '09:00:00'))).toBe(JSON.stringify(packTimeLogs([...entries].reverse(), '09:00:00')));
  });

  it('AC-TSP-033 never emits overlapping intervals within a date, and packs each date independently', () => {
    const logs = packTimeLogs(
      [
        { project_id: 'p-a', entry_date: '2026-07-20', hours: '4' },
        { project_id: 'p-b', entry_date: '2026-07-20', hours: '4' },
        { project_id: 'p-a', entry_date: '2026-07-21', hours: '2' },
      ],
      '08:00:00',
    );
    expect(logs.map((l) => `${l.from_time}->${l.to_time}`)).toEqual([
      '2026-07-20 08:00:00->2026-07-20 12:00:00',
      '2026-07-20 12:00:00->2026-07-20 16:00:00',
      '2026-07-21 08:00:00->2026-07-21 10:00:00',
    ]);
  });

  it('AC-TSP-033 drops zero-hour rows (FR-TSP-056) rather than sending a zero-length ERP log', () => {
    const logs = packTimeLogs(
      [
        { project_id: 'p-a', entry_date: '2026-07-20', hours: '0' },
        { project_id: 'p-b', entry_date: '2026-07-20', hours: '2' },
      ],
      '09:00:00',
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].project_id).toBe('p-b');
  });

  it('AC-TSP-033 throws daily-hours-exceed-24 for a date summing over 24h (spike §7: ERP has NO cap)', () => {
    expect(() =>
      packTimeLogs(
        [
          { project_id: 'p-a', entry_date: '2026-07-20', hours: '10' },
          { project_id: 'p-b', entry_date: '2026-07-20', hours: '10' },
          { project_id: 'p-c', entry_date: '2026-07-20', hours: '10' },
        ],
        '09:00:00',
      ),
    ).toThrow('daily-hours-exceed-24');
  });

  it('AC-TSP-033 rejects an unparseable hours value rather than silently packing NaN minutes', () => {
    expect(() => packTimeLogs([{ project_id: 'p-a', entry_date: '2026-07-20', hours: 'abc' }], '09:00:00')).toThrow(
      /unparseable hours/,
    );
  });
});
