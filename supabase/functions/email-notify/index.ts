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
import { renderEmail, type OrgNaming } from './templates.ts';

const BATCH = 20;
const LEASE = '5 minutes';
const RESEND_URL = 'https://api.resend.com/emails';

type Claimed = {
  id: string; to_email: string; event_key: string; locale: string;
  title: string; body: string | null; attempts: number; org_id?: string | null;
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
    const rows = (data ?? []) as Claimed[];
    // One org_naming read per distinct organisation in the batch (the one lookup, migration 1904). A failed read sends the
    // stored wording rather than holding the email back.
    const naming = new Map<string, OrgNaming>();
    for (const orgId of new Set(rows.map((r) => r.org_id).filter((o): o is string => !!o))) {
      const res = await serviceClient.rpc('org_naming', { p_org: orgId });
      if (res.error) logStructuredError({ fn: 'email-notify', errorCode: 'ORG_NAMING_FAILED', contextId: orgId });
      else naming.set(orgId, (res.data ?? {}) as OrgNaming);
    }
    for (const row of rows) {
      const mail = renderEmail(row.event_key, row.locale, row.title, row.body, row.org_id ? naming.get(row.org_id) : undefined);
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
