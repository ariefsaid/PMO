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
    secretsConfigured: true,
    selectUnnotified: async () => [row('r1', 'ERP_PUSH_FAILED', '2026-07-25T11:59:00.000Z')],
    selectLastSentByCode: async () => ({}),
    recordSendAhead: vi.fn(async () => ({ error: null })),
    markDelivered: vi.fn(async () => ({ error: null })),
    sendTelegram: vi.fn(async () => ({ ok: true })),
    stampNotified: vi.fn(async () => ({ error: null })),
    readHeartbeat: async () => null,
    recordLivenessAhead: vi.fn(async () => ({ error: null })),
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

  it('AC-HRD-001: after a DELIVERED send whose stamp then fails, the SAME group is not re-sent on the next tick', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Tick 1: send succeeds, write-ahead + delivery both land, but the notified_at STAMP fails ->
    // the row stays unnotified. Tick 2 must recognise the group as already-delivered (not merely
    // suppressed) and therefore still eligible to stamp — this is the "not re-sent" claim, not the
    // C1 "never stamp an undelivered suppression" claim (see the C1 describe block below).
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const store: Record<string, { lastSentAt: string; deliveredAt: string | null }> = {};
    const recordSendAhead = vi.fn(async (code: string, atIso: string) => {
      store[code] = { lastSentAt: atIso, deliveredAt: store[code]?.deliveredAt ?? null };
      return { error: null };
    });
    const markDelivered = vi.fn(async (code: string, atIso: string) => {
      if (store[code]) store[code].deliveredAt = atIso;
      return { error: null };
    });
    // Heartbeat state must PERSIST across ticks here, exactly as ops_job_heartbeats persists
    // across real drain invocations — otherwise deps()'s fresh-per-call default readHeartbeat/
    // writeHeartbeat would make tick 2's (unrelated) liveness path fire its own Telegram send,
    // which would falsely inflate the call count this assertion is actually about.
    let heartbeat: { lastRunAt: string; lastOutboundAt: string | null } | null = null;
    const shared = {
      selectUnnotified: async () => [row('r1', 'ERP_PUSH_FAILED', '2026-07-25T11:59:00.000Z')],
      selectLastSentByCode: async () => ({ ...store }),
      recordSendAhead,
      markDelivered,
      sendTelegram,
      stampNotified: vi.fn(async () => ({ error: { code: '42501' } })),
      readHeartbeat: async () => heartbeat,
      writeHeartbeat: vi.fn(async (_job: string, runAtIso: string, outboundAtIso: string | undefined) => {
        heartbeat = { lastRunAt: runAtIso, lastOutboundAt: outboundAtIso ?? heartbeat?.lastOutboundAt ?? null };
        return { error: null };
      }),
    };

    await runDrain(deps(shared));
    await runDrain(deps(shared)); // next tick, same unnotified (but now DELIVERED) row

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

  it('AC-HRD-001: delivery is marked ONLY after a confirmed successful send', async () => {
    const order: string[] = [];
    const d = deps({
      sendTelegram: vi.fn(async () => { order.push('send'); return { ok: true }; }),
      markDelivered: vi.fn(async () => { order.push('deliver'); return { error: null }; }),
    });
    await runDrain(d);
    expect(order).toEqual(['send', 'deliver']);
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
  it('AC-HRD-010: a quiet tick with a stale heartbeat sends an all-clear and write-aheads the outbound timestamp', async () => {
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const recordLivenessAhead = vi.fn(async () => ({ error: null }));
    const writeHeartbeat = vi.fn(async () => ({ error: null }));
    const r = await runDrain(deps({
      selectUnnotified: async () => [],
      readHeartbeat: async () => ({ lastRunAt: '2026-07-23T12:00:00.000Z', lastOutboundAt: '2026-07-23T12:00:00.000Z' }),
      sendTelegram,
      recordLivenessAhead,
      writeHeartbeat,
    }));
    expect(r.livenessPinged).toBe(true);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(recordLivenessAhead).toHaveBeenCalledWith('telegram-notify', expect.any(String));
    expect(writeHeartbeat).toHaveBeenCalledWith('telegram-notify', expect.any(String), undefined, expect.anything());
  });

  it('AC-HRD-010: a quiet tick with a FRESH heartbeat stays silent (no ping), but the run signal still writes (I4)', async () => {
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const writeHeartbeat = vi.fn(async () => ({ error: null }));
    const r = await runDrain(deps({
      selectUnnotified: async () => [],
      readHeartbeat: async () => ({ lastRunAt: '2026-07-25T10:00:00.000Z', lastOutboundAt: '2026-07-25T11:00:00.000Z' }),
      sendTelegram,
      writeHeartbeat,
    }));
    expect(r.livenessPinged).toBe(false);
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(writeHeartbeat).toHaveBeenCalledTimes(1); // I4: the run signal is unconditional
  });
});

// ── 2026-07-28 review round: C1 (blocking), I2, I3, I4, I7 ────────────────────────────────────

describe('C1 (BLOCKING) — a failed send must not authorise a stamp on a later suppressed tick', () => {
  it('C1: tick 1 send fails (write-ahead already landed); tick 2 is suppressed by that write-ahead ' +
    'and must NOT stamp notified_at — the row was never actually delivered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store: Record<string, { lastSentAt: string; deliveredAt: string | null }> = {};
    const recordSendAhead = vi.fn(async (code: string, atIso: string) => {
      store[code] = { lastSentAt: atIso, deliveredAt: store[code]?.deliveredAt ?? null };
      return { error: null };
    });
    const stampNotified = vi.fn(async () => ({ error: null }));
    const shared = {
      selectUnnotified: async () => [row('r1', 'ERP_PUSH_FAILED', '2026-07-25T11:59:00.000Z')],
      selectLastSentByCode: async () => ({ ...store }),
      recordSendAhead,
      // Telegram down / secrets briefly wrong — every send fails.
      sendTelegram: vi.fn(async () => ({ ok: false })),
      stampNotified,
    };

    const tick1 = await runDrain(deps(shared));
    expect(tick1.sendFailures).toBe(1);
    expect(stampNotified).not.toHaveBeenCalled(); // tick 1 was already correct

    const tick2 = await runDrain(deps(shared)); // same still-unnotified row, now inside the write-ahead cooldown
    expect(tick2.suppressed).toBe(1);
    expect(stampNotified).not.toHaveBeenCalled(); // an UNDELIVERED suppression must not stamp
  });

  it('C1: once the write-ahead cooldown lapses, the never-delivered alert eventually retries and delivers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store: Record<string, { lastSentAt: string; deliveredAt: string | null }> = {
      // Tick 1 (elsewhere) failed to send; the write-ahead landed 20 minutes before "now".
      ERP_PUSH_FAILED: { lastSentAt: '2026-07-25T11:40:00.000Z', deliveredAt: null },
    };
    const sendTelegram = vi.fn(async () => ({ ok: true })); // Telegram has recovered
    const markDelivered = vi.fn(async (code: string, atIso: string) => {
      store[code] = { ...store[code], deliveredAt: atIso };
      return { error: null };
    });
    const stampNotified = vi.fn(async () => ({ error: null }));

    const r = await runDrain(deps({
      // The cooldown clock compares the row's OWN created_at against the write-ahead's
      // lastSentAt (never wall-clock) — 20 minutes apart, past cooldownSec=900s (15 min).
      selectUnnotified: async () => [row('r1', 'ERP_PUSH_FAILED', '2026-07-25T12:00:00.000Z')],
      selectLastSentByCode: async () => ({ ...store }),
      sendTelegram,
      markDelivered,
      stampNotified,
    }));

    expect(r.suppressed).toBe(0);
    expect(r.sent).toBe(1);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledWith('ERP_PUSH_FAILED', expect.any(String));
    expect(stampNotified).toHaveBeenCalledWith(['r1'], expect.any(String)); // eventually delivered
  });
});

describe('I3 — a tick where every send failed must not report a false all-clear', () => {
  it('I3: sendFailures > 0 this tick -> no liveness ping fires even though result.sent === 0', async () => {
    const sendTelegram = vi.fn(async () => ({ ok: false })); // the one real alert attempt fails
    const r = await runDrain(deps({
      selectUnnotified: async () => [row('r1', 'ERP_PUSH_FAILED', '2026-07-25T11:59:00.000Z')],
      recordSendAhead: vi.fn(async () => ({ error: null })),
      sendTelegram,
      readHeartbeat: async () => null, // never pinged before -> shouldSendLiveness would say "ping"
    }));
    expect(r.sendFailures).toBe(1);
    expect(r.sent).toBe(0);
    expect(r.livenessPinged).toBe(false);
    // ONLY the one failed alert attempt — no extra "Alert path OK" call piled on top of a failing tick.
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });

  it('I3: stampFailures > 0 this tick -> no liveness ping fires either', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const r = await runDrain(deps({
      selectUnnotified: async () => [row('r1', 'ERP_PUSH_FAILED', '2026-07-25T11:59:00.000Z')],
      sendTelegram,
      stampNotified: vi.fn(async () => ({ error: { code: '42501' } })),
      readHeartbeat: async () => null,
    }));
    expect(r.stampFailures).toBe(1);
    expect(r.sent).toBe(1); // the alert itself DID send
    expect(r.livenessPinged).toBe(false);
    // The all-clear gate is only reached when result.sent === 0 anyway; this guards the case
    // where a future refactor moves that check — sendTelegram must still be exactly 1 (the alert).
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });
});

describe('I2 — a failing heartbeat WRITE must not cause unbounded liveness pings', () => {
  it('I2: writeHeartbeat always fails (never actually persists) -> a second quiet tick must NOT re-ping', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    // recordLivenessAhead (the write-ahead) SUCCEEDS — it is a separate write from the final
    // unconditional writeHeartbeat, which is the one failing here.
    const writeHeartbeat = vi.fn(async () => ({ error: { code: '42501' } }));
    let outbound: string | null = null;
    const recordLivenessAhead = vi.fn(async (_job: string, atIso: string) => {
      outbound = atIso;
      return { error: null };
    });
    const shared = {
      selectUnnotified: async () => [],
      readHeartbeat: async () => (outbound ? { lastRunAt: outbound, lastOutboundAt: outbound } : null),
      sendTelegram,
      recordLivenessAhead,
      writeHeartbeat,
    };

    await runDrain(deps(shared));
    await runDrain(deps(shared));

    // Bounded — not one ping per tick (~720/day at the real 2-minute cadence if unbounded).
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });

  it('I2: a failing recordLivenessAhead WRITE aborts the ping (never sends without the write-ahead landing)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const r = await runDrain(deps({
      selectUnnotified: async () => [],
      readHeartbeat: async () => null,
      recordLivenessAhead: vi.fn(async () => ({ error: { code: '57014' } })),
      sendTelegram,
    }));
    expect(r.livenessPinged).toBe(false);
    expect(sendTelegram).not.toHaveBeenCalled();
  });
});

describe('I4 — the run signal must be written even when nothing goes out', () => {
  it('I4: a quiet tick within the liveness interval still records that the drain RAN', async () => {
    const writeHeartbeat = vi.fn(async () => ({ error: null }));
    const r = await runDrain(deps({
      selectUnnotified: async () => [],
      readHeartbeat: async () => ({ lastRunAt: '2026-07-25T10:00:00.000Z', lastOutboundAt: '2026-07-25T11:00:00.000Z' }), // fresh -> no ping needed
      writeHeartbeat,
    }));
    expect(r.livenessPinged).toBe(false);
    expect(r.sent).toBe(0);
    // The drain RAN — that must be recorded regardless of whether anything was sent (I4).
    expect(writeHeartbeat).toHaveBeenCalledTimes(1);
    expect(writeHeartbeat).toHaveBeenCalledWith('telegram-notify', expect.any(String), undefined, expect.anything());
  });

  it('I4: a tick that sends a real alert passes the outbound timestamp to the unconditional run-signal write', async () => {
    const writeHeartbeat = vi.fn(async () => ({ error: null }));
    const r = await runDrain(deps({ writeHeartbeat }));
    expect(r.sent).toBe(1);
    expect(writeHeartbeat).toHaveBeenCalledWith('telegram-notify', expect.any(String), expect.any(String), expect.anything());
  });
});

describe('secretsConfigured guard (C1) — a missing Telegram secret must not burn a write-ahead per group', () => {
  it('C1: secretsConfigured=false stops the drain BEFORE any select/write-ahead', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const selectUnnotified = vi.fn(async () => [row('r1', 'X', '2026-07-25T11:59:00.000Z')]);
    const recordSendAhead = vi.fn(async () => ({ error: null }));
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const r = await runDrain(deps({ secretsConfigured: false, selectUnnotified, recordSendAhead, sendTelegram }));
    expect(r.skipped).toBe('secrets-unset');
    expect(selectUnnotified).not.toHaveBeenCalled();
    expect(recordSendAhead).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
  });
});

describe('I7 — explicit coverage for the write-ahead guard branches', () => {
  it('I7(a): a recordSendAhead failure aborts BEFORE sendTelegram is ever called', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const r = await runDrain(deps({
      recordSendAhead: vi.fn(async () => ({ error: { code: '57014' } })),
      sendTelegram,
    }));
    expect(r.sendFailures).toBe(1);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it('I7(b): once the clock has advanced past cooldownSec, a new occurrence of the same code resends', async () => {
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const store: Record<string, { lastSentAt: string; deliveredAt: string | null }> = {
      ERP_PUSH_FAILED: { lastSentAt: '2026-07-25T12:00:00.000Z', deliveredAt: '2026-07-25T12:00:00.000Z' },
    };
    const r = await runDrain(deps({
      now: () => new Date('2026-07-25T12:20:00.000Z'), // 20 min later — cooldownSec=900s (15 min) has lapsed
      selectUnnotified: async () => [row('r2', 'ERP_PUSH_FAILED', '2026-07-25T12:20:00.000Z')],
      selectLastSentByCode: async () => ({ ...store }),
      sendTelegram,
    }));
    expect(r.suppressed).toBe(0);
    expect(r.sent).toBe(1);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });
});
