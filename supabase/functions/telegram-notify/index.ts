/**
 * telegram-notify — Deno Edge Function entry point (observability floor, DC-OF-001).
 * Invoked every 2 minutes by the pg_cron job (migration 0071) via net.http_post.
 * Thin wiring ONLY — all drain logic lives in logic.ts (pure, unit-tested).
 * Integration-only: this file is NOT unit-tested (ADR-0039 decision-7,
 * NFR-OF-TEST-005) — verified by `deno check` + the live-verify runbook
 * (docs/environments.md "Observability & alerting", AC-OF-007).
 *
 * Auth (NFR-OF-SEC-002): the incoming Authorization bearer MUST equal
 * SUPABASE_SERVICE_ROLE_KEY (the pg_cron job sends it, mirroring agent-dispatch) —
 * an anonymous direct POST is rejected 401.
 */
import { createClient } from '@supabase/supabase-js';
import {
  groupIntoMessages,
  buildTelegramPayload,
  pingHeartbeat,
} from './logic.ts';
import { logStructuredError } from '../_shared/errorLog.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
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
    const { data: unnotified } = await serviceClient
      .from('error_events')
      .select('id, error_code, fn, context_id, org_id, created_at')
      .is('notified_at', null);

    const { data: lastNotifiedRows } = await serviceClient
      .from('error_events')
      .select('error_code, notified_at')
      .not('notified_at', 'is', null);

    const lastNotifiedByCode: Record<string, string | undefined> = {};
    for (const row of (lastNotifiedRows ?? []) as { error_code: string; notified_at: string }[]) {
      const current = lastNotifiedByCode[row.error_code];
      if (!current || row.notified_at > current) lastNotifiedByCode[row.error_code] = row.notified_at;
    }

    const rows = (unnotified ?? []) as {
      id: string; error_code: string; fn: string; context_id: string | null; org_id: string | null; created_at: string;
    }[];
    const groups = groupIntoMessages(rows, lastNotifiedByCode, cooldownSec);

    if (!botToken || !chatId) {
      logStructuredError({ fn: 'telegram-notify', errorCode: 'TELEGRAM_SECRET_MISSING' });
      // Leave notified_at NULL for everything — retried next tick once secrets are wired.
      await pingHeartbeat(heartbeatUrl);
      return new Response(JSON.stringify({ ok: true, skipped: 'secrets unset' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    for (const group of groups) {
      if (!group.suppressed) {
        const payload = buildTelegramPayload(group);
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, chat_id: chatId }),
        });
        if (!res.ok) {
          // Non-2xx: leave notified_at NULL for this group — retried next tick (FR-OF-007).
          continue;
        }
      }
      // Sent OR intentionally suppressed within cooldown: stamp notified_at for exactly
      // this group's ids (Fix 1 — groupIntoMessages is the source of truth, no re-filter).
      if (group.ids.length > 0) {
        await serviceClient.from('error_events').update({ notified_at: new Date().toISOString() }).in('id', group.ids);
      }
    }

    await pingHeartbeat(heartbeatUrl);
    return new Response(JSON.stringify({ ok: true }), {
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
