import { describe, expect, it } from 'vitest';
import type { OdooErrorClass } from './client.ts';
import { displayedConnection, INITIAL_CONNECTION, nextConnection, type ConnectionRecord, type ProbeOutcome } from './connectionState.ts';

const NOW = new Date('2026-11-01T00:00:00Z');
const ctx = (o: Partial<Parameters<typeof nextConnection>[2]> = {}) => ({ now: NOW, keyExpiresOn: null, activated: true, disconnected: false, ...o });
const ok = (missing: string[] = []): ProbeOutcome => ({ ok: true, missing });
const fail = (errorClass: OdooErrorClass): ProbeOutcome => ({ ok: false, errorClass });
const run = (outcomes: ProbeOutcome[], start: ConnectionRecord = INITIAL_CONNECTION) => outcomes.reduce((s, o) => nextConnection(s, o, ctx()), start);
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString().slice(0, 10);

describe('odoo/connectionState — AC-ODC-013', () => {
  it('AC-ODC-013 two network failures keep the previous state; the third makes it unreachable', () => {
    const healthy = run([ok()]);
    const two = run([fail('unreachable'), fail('timeout')], healthy);
    expect([two.state, two.failures, two.error_class]).toEqual(['healthy', 2, 'timeout']);
    const three = nextConnection(two, fail('server-error'), ctx());
    expect([three.state, three.failures]).toEqual(['unreachable', 3]);
  });

  it.each(['unreachable', 'timeout', 'tls', 'server-error', 'destination-refused'] as const)('AC-ODC-013 %s counts as a network failure', (c) =>
    expect(run([ok(), fail(c), fail(c), fail(c)]).state).toBe('unreachable'));

  it.each(['key-rejected', 'access-denied', 'no-json2', 'not-odoo', 'database-not-found', 'missing-model', 'validation'] as const)(
    'AC-ODC-013 %s after a success is credential-rejected in one step', (c) => {
      const s = run([ok(), fail(c)]);
      expect([s.state, s.error_class, s.failures]).toEqual(['credential-rejected', c, 0]);
    });

  it('AC-ODC-013 a success after failures clears the counter and is healthy with last_ok_at now', () => {
    const s = run([ok(), fail('unreachable'), fail('unreachable'), ok()]);
    expect(s).toEqual({ state: 'healthy', failures: 0, last_ok_at: NOW.toISOString(), last_checked_at: NOW.toISOString(), error_class: null, missing: [] });
  });

  it('AC-ODC-013 a success recovers an unreachable connection', () => {
    expect(run([fail('unreachable'), fail('unreachable'), fail('unreachable'), ok()]).state).toBe('healthy');
  });

  it('AC-ODC-013 a failure keeps last_ok_at from the last success', () => {
    const s = nextConnection({ ...INITIAL_CONNECTION, state: 'healthy', last_ok_at: '2026-10-31T00:00:00.000Z' }, fail('timeout'), ctx());
    expect([s.last_ok_at, s.last_checked_at]).toEqual(['2026-10-31T00:00:00.000Z', NOW.toISOString()]);
  });

  it.each([[10, 'credential-expiring'], [14, 'credential-expiring'], [20, 'healthy']] as const)('AC-ODC-013 declared expiry in %i days → %s while the key works', (d, state) =>
    expect(nextConnection(INITIAL_CONNECTION, ok(), ctx({ keyExpiresOn: inDays(d) })).state).toBe(state));

  it('FR-ODC-021 a success with missing items is degraded and names them', () => {
    const s = nextConnection(INITIAL_CONNECTION, ok(['stock.location']), ctx({ keyExpiresOn: inDays(3) }));
    expect([s.state, s.missing, s.failures]).toEqual(['degraded', ['stock.location'], 0]);
  });

  it('AC-ODC-013 a disconnected binding is disconnected whatever the probe said', () => {
    expect(nextConnection(run([ok()]), ok(), ctx({ disconnected: true })).state).toBe('disconnected');
  });

  it('AC-ODC-013 a binding that is not activated is not-activated', () => {
    expect(nextConnection(INITIAL_CONNECTION, ok(), ctx({ activated: false })).state).toBe('not-activated');
  });
});

describe('odoo/connectionState — AC-ODC-015 displayed state (FR-ODC-034)', () => {
  const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  const rec = (state: ConnectionRecord['state'], minutesAgo: number | null): ConnectionRecord =>
    ({ ...INITIAL_CONNECTION, state, last_checked_at: minutesAgo === null ? null : at(minutesAgo) });

  it.each(['healthy', 'credential-expiring', 'degraded'] as const)('AC-ODC-015 an 11-minute-old %s shows unverified', (s) =>
    expect(displayedConnection(rec(s, 11), NOW)).toBe('unverified'));

  it('AC-ODC-015 a 9-minute-old healthy still shows healthy', () => expect(displayedConnection(rec('healthy', 9), NOW)).toBe('healthy'));
  it('AC-ODC-015 a healthy never checked shows unverified', () => expect(displayedConnection(rec('healthy', null), NOW)).toBe('unverified'));
  it('AC-ODC-015 a stale problem state is still shown as that problem', () => expect(displayedConnection(rec('unreachable', 60), NOW)).toBe('unreachable'));
  it('AC-ODC-015 no record shows not-activated', () => expect(displayedConnection(null, NOW)).toBe('not-activated'));
});
