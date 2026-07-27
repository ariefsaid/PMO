/**
 * Tests for the Telegram alert drain loop (`telegram-notify/logic.ts` runDrain).
 *
 * Test-location convention (ADR-0039 decision-7): edge-fn logic tests live under pmo-portal/
 * (Vitest's root); the implementation stays in supabase/functions/, imported by relative path.
 */
import { describe, it, expect, vi } from 'vitest';
import { runDrain, shouldSendLiveness } from '../../../../supabase/functions/telegram-notify/logic';

const row = (id: string, code: string, at: string) => ({
  id, error_code: code, fn: 'erpnext-sweep', context_id: null, org_id: null, created_at: at,
});

function deps(overrides: Partial<Parameters<typeof runDrain>[0]> = {}) {
  return {
    now: () => new Date('2026-07-25T12:00:00.000Z'),
    cooldownSec: 900,
    livenessIntervalHours: 24,
    selectUnnotified: async () => [row('r1', 'ERP_PUSH_FAILED', '2026-07-25T11:59:00.000Z')],
    selectLastSentByCode: async () => ({}),
    recordSendAhead: vi.fn(async () => ({ error: null })),
    sendTelegram: vi.fn(async () => ({ ok: true })),
    stampNotified: vi.fn(async () => ({ error: null })),
    readHeartbeat: async () => null,
    writeHeartbeat: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('runDrain', () => {
  it('AC-HRD-001: a failing notified_at stamp is DETECTED and logged with NOTIFY_STAMP_FAILED', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ stampNotified: vi.fn(async () => ({ error: { code: '42501' } })) });

    const result = await runDrain(d);

    expect(result.stampFailures).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      '[telegram-notify] NOTIFY_STAMP_FAILED',
      expect.objectContaining({ errorCode: 'NOTIFY_STAMP_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-HRD-001: after a failed stamp the SAME group is not re-sent on the next tick', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Tick 1: send succeeds, write-ahead lands, stamp FAILS -> the row stays unnotified.
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const sent: Record<string, string> = {};
    const recordSendAhead = vi.fn(async (code: string, atIso: string) => {
      sent[code] = atIso;
      return { error: null };
    });
    // Heartbeat state must PERSIST across ticks here, exactly as ops_job_heartbeats persists
    // across real drain invocations — otherwise deps()'s fresh-per-call default readHeartbeat/
    // writeHeartbeat would make tick 2's (unrelated) liveness path fire its own Telegram send,
    // which would falsely inflate the call count this assertion is actually about.
    let heartbeat: { last_success_at: string } | null = null;
    const shared = {
      selectUnnotified: async () => [row('r1', 'ERP_PUSH_FAILED', '2026-07-25T11:59:00.000Z')],
      selectLastSentByCode: async () => ({ ...sent }),
      recordSendAhead,
      sendTelegram,
      stampNotified: vi.fn(async () => ({ error: { code: '42501' } })),
      readHeartbeat: async () => heartbeat,
      writeHeartbeat: vi.fn(async (_job: string, atIso: string) => {
        heartbeat = { last_success_at: atIso };
        return { error: null };
      }),
    };

    await runDrain(deps(shared));
    await runDrain(deps(shared)); // next tick, same unnotified row

    expect(sendTelegram).toHaveBeenCalledTimes(1); // NOT 2 — the cooldown held
  });

  it('AC-HRD-001: the write-ahead record is written BEFORE the Telegram send', async () => {
    const order: string[] = [];
    const d = deps({
      recordSendAhead: vi.fn(async () => { order.push('record'); return { error: null }; }),
      sendTelegram: vi.fn(async () => { order.push('send'); return { ok: true }; }),
    });
    await runDrain(d);
    expect(order).toEqual(['record', 'send']);
  });
});

describe('shouldSendLiveness (FR-HRD-010)', () => {
  it('AC-HRD-010: never pinged before -> ping (the alert path has never proven itself alive)', () => {
    expect(shouldSendLiveness('2026-07-25T12:00:00.000Z', undefined, 24)).toBe(true);
  });

  it('AC-HRD-010: last outbound 25h ago -> ping', () => {
    expect(shouldSendLiveness('2026-07-25T12:00:00.000Z', '2026-07-24T11:00:00.000Z', 24)).toBe(true);
  });

  it('AC-HRD-010: last outbound 2h ago -> no ping (silence is still informative)', () => {
    expect(shouldSendLiveness('2026-07-25T12:00:00.000Z', '2026-07-25T10:00:00.000Z', 24)).toBe(false);
  });
});

describe('runDrain liveness (FR-HRD-010)', () => {
  it('AC-HRD-010: a quiet tick with a stale heartbeat sends an all-clear and stamps the heartbeat', async () => {
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const writeHeartbeat = vi.fn(async () => ({ error: null }));
    const r = await runDrain(deps({
      selectUnnotified: async () => [],
      readHeartbeat: async () => ({ last_success_at: '2026-07-23T12:00:00.000Z' }),
      sendTelegram,
      writeHeartbeat,
    }));
    expect(r.livenessPinged).toBe(true);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(writeHeartbeat).toHaveBeenCalledWith('telegram-notify', expect.any(String), expect.anything());
  });

  it('AC-HRD-010: a quiet tick with a FRESH heartbeat stays silent', async () => {
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const r = await runDrain(deps({
      selectUnnotified: async () => [],
      readHeartbeat: async () => ({ last_success_at: '2026-07-25T11:00:00.000Z' }),
      sendTelegram,
    }));
    expect(r.livenessPinged).toBe(false);
    expect(sendTelegram).not.toHaveBeenCalled();
  });
});
