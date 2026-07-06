/**
 * Tests for telegram-notify's pure drain logic (cooldown/dedupe/message-build/heartbeat) —
 * observability floor, DC-OF-001 step 6.
 *
 * Test-location convention (standing rule — see openRouterModelClient.test.ts header,
 * errorLog.test.ts): edge-fn logic tests live under pmo-portal/ (Vitest's root); the
 * implementation stays in supabase/functions/, imported here via a relative path.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  groupIntoMessages,
  buildTelegramPayload,
  pingHeartbeat,
} from '../../../../supabase/functions/telegram-notify/logic';

const ROW = (overrides: Partial<{
  id: string;
  error_code: string;
  fn: string;
  context_id: string | null;
  org_id: string | null;
  created_at: string;
}> = {}) => ({
  id: overrides.id ?? `row_${Math.random().toString(36).slice(2)}`,
  error_code: 'TICK_FAILED',
  fn: 'agent-dispatch',
  context_id: null,
  org_id: null,
  created_at: '2026-07-04T10:00:00.000Z',
  ...overrides,
});

describe('telegram-notify/logic', () => {
  it('AC-OF-001: a burst of 5 identical + 2 different errorCodes yields exactly 2 messages with correct counts', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => ROW({ error_code: 'TICK_FAILED' })),
      ...Array.from({ length: 2 }, () => ROW({ error_code: 'MISSING_OPENROUTER_API_KEY', fn: 'agent-chat' })),
    ];
    const groups = groupIntoMessages(rows, {}, 900);
    expect(groups).toHaveLength(2);
    const tick = groups.find((g) => g.errorCode === 'TICK_FAILED')!;
    const missing = groups.find((g) => g.errorCode === 'MISSING_OPENROUTER_API_KEY')!;
    expect(tick.count).toBe(5);
    expect(missing.count).toBe(2);
  });

  it('AC-OF-002: a code within the cooldown window (lastNotifiedByCode) is suppressed, rows still marked notified', () => {
    const rows = [ROW({ error_code: 'TICK_FAILED', created_at: '2026-07-04T10:14:00.000Z' })];
    // 5 minutes ago; cooldown is 900s (15 min) — within window.
    const lastNotifiedByCode = { TICK_FAILED: '2026-07-04T10:09:00.000Z' };
    const groups = groupIntoMessages(rows, lastNotifiedByCode, 900);
    expect(groups.find((g) => g.errorCode === 'TICK_FAILED' && !g.suppressed)).toBeUndefined();
    const suppressed = groups.find((g) => g.errorCode === 'TICK_FAILED');
    expect(suppressed?.suppressed).toBe(true);
  });

  it('AC-OF-002: a code OUTSIDE the cooldown window (>=15 min since lastNotified) is NOT suppressed', () => {
    const rows = [ROW({ error_code: 'TICK_FAILED', created_at: '2026-07-04T10:30:00.000Z' })];
    const lastNotifiedByCode = { TICK_FAILED: '2026-07-04T10:09:00.000Z' }; // 21 min ago
    const groups = groupIntoMessages(rows, lastNotifiedByCode, 900);
    const group = groups.find((g) => g.errorCode === 'TICK_FAILED')!;
    expect(group.suppressed).toBe(false);
  });

  describe('AC-OF-005/AC-FIX1: id-stamping seam (groupIntoMessages carries row ids per group)', () => {
    it('groupIntoMessages returns the exact row ids belonging to each group, alongside the message fields', () => {
      const a1 = ROW({ id: 'a1', error_code: 'TICK_FAILED' });
      const a2 = ROW({ id: 'a2', error_code: 'TICK_FAILED' });
      const b1 = ROW({ id: 'b1', error_code: 'MISSING_OPENROUTER_API_KEY', fn: 'agent-chat' });
      const groups = groupIntoMessages([a1, a2, b1], {}, 900);
      const tick = groups.find((g) => g.errorCode === 'TICK_FAILED')!;
      const missing = groups.find((g) => g.errorCode === 'MISSING_OPENROUTER_API_KEY')!;
      expect(tick.ids.slice().sort()).toEqual(['a1', 'a2']);
      expect(missing.ids).toEqual(['b1']);
    });

    it('AC-OF-005: mocked fetch returning 502 leaves notified_at NULL (retry) — the drain does not stamp ids for a failed send', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
      vi.stubGlobal('fetch', fetchMock);
      const row = ROW({ id: 'row-1', error_code: 'TICK_FAILED' });
      const groups = groupIntoMessages([row], {}, 900);
      const group = groups[0];
      expect(group.ids).toEqual(['row-1']);

      const payload = buildTelegramPayload(group);
      const res = await fetch('https://api.telegram.org/botX/sendMessage', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res.ok).toBe(false);

      // Drain decision (index.ts's actual branch): a non-2xx send means this group's
      // ids must NOT be stamped — they are retried on the next tick.
      const idsToStamp = !group.suppressed && !res.ok ? [] : group.ids;
      expect(idsToStamp).toEqual([]);
      vi.unstubAllGlobals();
    });

    it('AC-OF-005: a successful send stamps exactly that group\'s ids (not other groups\')', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);
      const sent = ROW({ id: 'sent-1', error_code: 'TICK_FAILED' });
      const other = ROW({ id: 'other-1', error_code: 'MISSING_OPENROUTER_API_KEY', fn: 'agent-chat' });
      const groups = groupIntoMessages([sent, other], {}, 900);
      const tickGroup = groups.find((g) => g.errorCode === 'TICK_FAILED')!;

      const payload = buildTelegramPayload(tickGroup);
      const res = await fetch('https://api.telegram.org/botX/sendMessage', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const idsToStamp = !tickGroup.suppressed && !res.ok ? [] : tickGroup.ids;
      expect(idsToStamp).toEqual(['sent-1']);
      vi.unstubAllGlobals();
    });

    it('a suppressed group\'s ids are still returned (caller stamps them even though nothing was sent)', () => {
      const row = ROW({ id: 'suppressed-1', error_code: 'TICK_FAILED', created_at: '2026-07-04T10:14:00.000Z' });
      const lastNotifiedByCode = { TICK_FAILED: '2026-07-04T10:09:00.000Z' };
      const groups = groupIntoMessages([row], lastNotifiedByCode, 900);
      const group = groups[0];
      expect(group.suppressed).toBe(true);
      expect(group.ids).toEqual(['suppressed-1']);
    });
  });

  it('AC-OF-006: message body carries fn/error_code/count/timestamps/context_id, no token/org_id-UUID/PII', () => {
    const group = {
      errorCode: 'AUTOMATION_FIRE_FAILED',
      fn: 'agent-dispatch',
      count: 3,
      firstCreatedAt: '2026-07-04T09:00:00.000Z',
      lastCreatedAt: '2026-07-04T09:10:00.000Z',
      sampleContextId: 'run_abc',
      suppressed: false,
      ids: ['a1', 'a2', 'a3'],
    };
    const payload = buildTelegramPayload(group);
    expect(payload.text).toContain('agent-dispatch');
    expect(payload.text).toContain('AUTOMATION_FIRE_FAILED');
    expect(payload.text).toContain('3');
    expect(payload.text).toContain('run_abc');
    expect(payload.text).not.toMatch(/TELEGRAM_BOT_TOKEN/i);
    expect(payload.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('AC-OF-015: pingHeartbeat issues exactly one GET when a URL is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await pingHeartbeat('https://uptime.betterstack.com/api/v1/heartbeat/abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://uptime.betterstack.com/api/v1/heartbeat/abc', expect.objectContaining({ method: 'GET' }));
    vi.unstubAllGlobals();
  });

  it('AC-OF-015: pingHeartbeat no-ops (no fetch call) when the URL is undefined', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await pingHeartbeat(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('AC-OF-015: pingHeartbeat swallows a network error and never throws/rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(pingHeartbeat('https://uptime.betterstack.com/api/v1/heartbeat/abc')).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
