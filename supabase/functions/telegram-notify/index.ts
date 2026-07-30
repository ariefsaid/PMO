/**
 * telegram-notify — Deno Edge Function entry point (observability floor, DC-OF-001).
 * Invoked every 2 minutes by the pg_cron job (migration 0071) via net.http_post.
 * Thin wiring ONLY — all drain logic lives in logic.ts (pure, unit-tested).
 * Integration-only: this file is NOT unit-tested (ADR-0039 decision-7,
 * NFR-OF-TEST-005) — verified by `deno check` + the live-verify runbook
 * (docs/environments.md "Observability & alerting", AC-OF-007).
 *
 * Auth (NFR-OF-SEC-002): the pg_cron tick presents a DEDICATED `TELEGRAM_NOTIFY_SECRET` (Vault-
 * stored, read by the tick) — least-privilege, so the master SUPABASE_SERVICE_ROLE_KEY no longer
 * lives in the DB (it stays in this function's env, used only for the error_events drain). Falls
 * back to the service-role bearer when the dedicated secret is unset (legacy). Constant-time compare
 * (the sole gate, verify_jwt=false). An anonymous direct POST is rejected 401.
 */
import { createClient } from '@supabase/supabase-js';
import { runDrain, pingHeartbeat } from './logic.ts';
import type { ErrorEventRow, SendLogEntry } from './logic.ts';
import { logStructuredError } from '../_shared/errorLog.ts';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

// M4 (perf, 2026-07-28 review): caps the unnotified-rows query so one error storm cannot load the
// whole error_events table into the worker every 2-minute tick. Served by error_events_unnotified_idx
// (migration 0167); the oldest rows are pulled first (ORDER BY created_at asc) so a persistent storm
// still drains in FIFO order rather than starving old, still-unnotified rows.
const UNNOTIFIED_BATCH_LIMIT = 500;

serveWithErrorReporting('telegram-notify', async (req: Request): Promise<Response> => {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const dispatchSecret = Deno.env.get('TELEGRAM_NOTIFY_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  // service_role is required for the error_events drain below; its absence is a deploy-config gap.
  if (!serviceRoleKey) {
    logStructuredError({ fn: 'telegram-notify', errorCode: 'MISSING_SERVICE_ROLE_KEY' });
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const expectedBearer = dispatchSecret ? `Bearer ${dispatchSecret}` : `Bearer ${serviceRoleKey}`;
  if (!(await constantTimeBearerEquals(authHeader, expectedBearer))) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const cooldownSec = Number(Deno.env.get('TELEGRAM_COOLDOWN_SECONDS') ?? '900');
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  const heartbeatUrl = Deno.env.get('HEARTBEAT_URL') ?? undefined;

  try {
    const drain = await runDrain({
      now: () => new Date(),
      cooldownSec,
      livenessIntervalHours: Number(Deno.env.get('LIVENESS_INTERVAL_HOURS') ?? '24'),
      // C1 (2026-07-28 review): checked ONCE, up front — runDrain stops before any write-ahead or
      // select at all when this is false, so a missing/misconfigured secret can never burn a
      // write-ahead per group only to find out every send fails.
      secretsConfigured: Boolean(botToken) && Boolean(chatId),
      selectUnnotified: async () => {
        // M4 (perf, 2026-07-28 review): bounded by UNNOTIFIED_BATCH_LIMIT and served by the
        // error_events_unnotified_idx partial index (migration 0167) — a storm can no longer load
        // the whole table into the worker every 2 minutes.
        const { data } = await serviceClient
          .from('error_events')
          .select('id, error_code, fn, context_id, org_id, created_at')
          .is('notified_at', null)
          .order('created_at', { ascending: true })
          .limit(UNNOTIFIED_BATCH_LIMIT);
        return (data ?? []) as ErrorEventRow[];
      },
      selectLastSentByCode: async () => {
        const { data } = await serviceClient
          .from('alert_send_log')
          .select('error_code, last_sent_at, delivered_at');
        const out: Record<string, SendLogEntry> = {};
        for (const r of (data ?? []) as { error_code: string; last_sent_at: string; delivered_at: string | null }[]) {
          out[r.error_code] = { lastSentAt: r.last_sent_at, deliveredAt: r.delivered_at };
        }
        return out;
      },
      // Wrapped in an explicit async function (not a bare arrow returning the builder): the
      // supabase-js query builder is PromiseLike, not a real Promise (missing catch/finally/
      // Symbol.toStringTag), which deno check correctly rejects against DrainDeps's
      // Promise<{ error }> signature.
      recordSendAhead: async (errorCode, atIso) =>
        await serviceClient.from('alert_send_log').upsert(
          { error_code: errorCode, last_sent_at: atIso, delivered_at: null },
          { onConflict: 'error_code' },
        ),
      // C1: written ONLY after sendTelegram resolves ok — never before, never on a failed send.
      markDelivered: async (errorCode, atIso) =>
        await serviceClient.from('alert_send_log').update({ delivered_at: atIso }).eq('error_code', errorCode),
      sendTelegram: async (payload) => {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, chat_id: chatId }),
        });
        return { ok: res.ok };
      },
      stampNotified: async (ids, atIso) =>
        await serviceClient.from('error_events').update({ notified_at: atIso }).in('id', ids),
      readHeartbeat: async (job) => {
        const { data } = await serviceClient
          .from('ops_job_heartbeats')
          .select('last_run_at, last_outbound_at')
          .eq('job_name', job)
          .maybeSingle();
        const beat = data as { last_run_at: string; last_outbound_at: string | null } | null;
        return beat ? { lastRunAt: beat.last_run_at, lastOutboundAt: beat.last_outbound_at } : null;
      },
      // I2: write-ahead the OUTBOUND intent before the liveness ping is sent.
      recordLivenessAhead: async (job, atIso) =>
        await serviceClient.from('ops_job_heartbeats').upsert(
          { job_name: job, last_run_at: atIso, last_outbound_at: atIso },
          { onConflict: 'job_name' },
        ),
      // I4: the unconditional run signal — called once at the end of every completed tick.
      writeHeartbeat: async (job, runAtIso, outboundAtIso, detail) => {
        const patch: Record<string, unknown> = { job_name: job, last_run_at: runAtIso, last_detail: detail };
        if (outboundAtIso) patch.last_outbound_at = outboundAtIso;
        return await serviceClient.from('ops_job_heartbeats').upsert(patch, { onConflict: 'job_name' });
      },
    });

    await pingHeartbeat(heartbeatUrl);
    return new Response(JSON.stringify({ ok: true, ...drain }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logStructuredError({
      fn: 'telegram-notify',
      errorCode: 'TELEGRAM_DRAIN_FAILED',
      contextId: err instanceof Error ? err.name : 'unknown',
    });
    return new Response(JSON.stringify({ error: 'DRAIN_FAILED' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
