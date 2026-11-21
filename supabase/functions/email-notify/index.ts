/**
 * email-notify — Deno Edge Function: delivers the email channel of the notifications (#2711).
 * Invoked every 5 minutes by pg_cron (migration 1222, email_notify_tick) with a dedicated bearer secret.
 * Claims pending outbox rows (lease, skip locked), sends each once through the Resend HTTP API with the outbox id as the
 * Idempotency-Key, and records the outcome. The sender key and from-address are function secrets (never in the repo);
 * with the key absent the function sends nothing, changes no row, logs once and returns 200.
 */
import { createClient } from '@supabase/supabase-js';
import { logStructuredError } from '../_shared/errorLog.ts';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';
import { fetchBounded } from '../_shared/fetchWithDeadline.ts';
import { renderEmail } from './templates.ts';

const BATCH = 20;
const LEASE = '5 minutes';
const RESEND_URL = 'https://api.resend.com/emails';

type Claimed = {
  id: string; to_email: string; event_key: string; locale: string;
  title: string; body: string | null; attempts: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleEmailNotifyRequest(req: Request): Promise<Response> {
  const secret = Deno.env.get('EMAIL_NOTIFY_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  // Fail closed: no dedicated secret configured means nobody can call this.
  if (!secret || !(await constantTimeBearerEquals(authHeader, `Bearer ${secret}`))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const from = Deno.env.get('EMAIL_FROM') ?? '';
  if (!apiKey || !from) {
    logStructuredError({ fn: 'email-notify', errorCode: 'EMAIL_SENDER_NOT_CONFIGURED' });
    return json({ ok: true, skipped: 'sender-not-configured', sent: 0 });
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const serviceClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    const { data, error } = await serviceClient.rpc('claim_email_outbox', { p_limit: BATCH, p_lease: LEASE });
    if (error) throw new Error('claim failed');
    let sent = 0;
    let failed = 0;
    for (const row of (data ?? []) as Claimed[]) {
      const mail = renderEmail(row.event_key, row.locale, row.title, row.body);
      let ok = false;
      let permanent = false;
      let err: string | undefined;
      try {
        const res = await fetchBounded(undefined, RESEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': row.id,
          },
          body: JSON.stringify({ from, to: [row.to_email], subject: mail.subject, text: mail.text, html: mail.html }),
        });
        ok = res.ok;
        if (!ok) {
          err = `resend ${res.status}`;
          // A 4xx other than rate-limit / timeout will not succeed on retry.
          permanent = res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408;
        }
      } catch {
        err = 'resend unreachable';
      }
      const done = await serviceClient.rpc('complete_email_outbox', {
        p_id: row.id, p_ok: ok, p_error: err ?? null, p_permanent: permanent,
      });
      if (done.error) logStructuredError({ fn: 'email-notify', errorCode: 'COMPLETE_FAILED', contextId: row.id });
      if (ok) sent++; else failed++;
    }
    return json({ ok: true, sent, failed });
  } catch (e) {
    logStructuredError({ fn: 'email-notify', errorCode: 'EMAIL_RUN_FAILED', contextId: e instanceof Error ? e.name : 'unknown' });
    return json({ error: 'RUN_FAILED' }, 500);
  } finally {
    await serviceClient.auth.stopAutoRefresh();
  }
}

if (import.meta.main) {
  serveWithErrorReporting('email-notify', handleEmailNotifyRequest);
}
