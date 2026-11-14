import { createClient } from '@supabase/supabase-js';
import { isValidInviteEmail } from '../../../pmo-portal/src/lib/invite/inviteHandler.ts';
import { checkRequestRate } from '../_shared/requestRateGuard.ts';
import { logStructuredError } from '../_shared/errorLog.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

serveWithErrorReporting('operator-org', async (req: Request) => {
  const cors = {
    'Access-Control-Allow-Origin': Deno.env.get('AGENT_ALLOWED_ORIGIN') ?? Deno.env.get('SITE_URL') ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  const json = (value: unknown, status: number) =>
    new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const fail = (code: string, status: number, extra: Record<string, unknown> = {}) => {
    if (
      ['MISCONFIGURED', 'LOOKUP_FAILED', 'INVITE_FAILED', 'ORG_CREATE_FAILED', 'PLAN_ASSIGN_FAILED'].includes(
        code,
      )
    ) {
      logStructuredError({ fn: 'operator-org', errorCode: code });
    }
    return json({ error: code, ...extra }, status);
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ') || !auth.slice(7)) return fail('UNAUTHORIZED', 401);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!url || !anon) return fail('MISCONFIGURED', 500);
  const jwt = auth.slice(7);
  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data, error } = await caller.auth.getUser(jwt);
  if (error || !data.user?.id) return fail('UNAUTHORIZED', 401);
  // Authorize the caller before constructing any service-key client.
  const operator = await caller.rpc('is_operator');
  const active = await caller.rpc('is_active_member');
  if (operator.error || active.error || operator.data !== true || active.data !== true) {
    return fail('OPERATOR_ONLY', 403);
  }
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail('BAD_REQUEST', 400);
  }
  if (!body || typeof body !== 'object') return fail('BAD_REQUEST', 400);
  const get = (key: string) => typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const makeService = () => createClient(url, serviceKey);
  let service: ReturnType<typeof makeService> | undefined;
  const getService = () => service ??= makeService();
  const handleStatus = async () => {
    const orgId = get('org_id');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
      return fail('BAD_ORG_ID', 400);
    }
    if (!serviceKey) return fail('MISCONFIGURED', 500);
    const service = getService();
    const organization = await service.from('organizations').select('id,name,lifecycle_state').eq('id', orgId)
      .limit(1);
    if (organization.error) return fail('LOOKUP_FAILED', 502);
    if (!organization.data?.length) return json({ exists: false }, 200);
    const [profiles, stages, features] = await Promise.all([
      service.from('profiles').select('id', { count: 'exact' }).eq('org_id', orgId).eq('role', 'Admin').eq(
        'status',
        'active',
      ).range(0, 999),
      service.from('pipeline_stage_config').select('status', { count: 'exact', head: true }).eq(
        'org_id',
        orgId,
      ),
      service.from('org_features').select('feature_key,enabled').eq('org_id', orgId),
    ]);
    if (profiles.error || profiles.count === null || stages.error || stages.count === null || features.error) {
      return fail('LOOKUP_FAILED', 502);
    }
    // The plan tables have no table path for any API role by design (0530); Operator reads go
    // through 0537's operator_org_plan under the caller's token. Called only after the
    // organization row was found: it raises unknown_org for a missing organization.
    const plan = await caller.rpc('operator_org_plan', { p_org_id: orgId });
    if (plan.error) return fail('LOOKUP_FAILED', 502);
    const allProfiles = [...(profiles.data ?? [])];
    while (allProfiles.length < profiles.count) {
      const offset = allProfiles.length;
      const page = await service.from('profiles').select('id').eq('org_id', orgId).eq('role', 'Admin').eq(
        'status',
        'active',
      ).range(offset, offset + 999);
      if (page.error || !page.data?.length) return fail('LOOKUP_FAILED', 502);
      allProfiles.push(...page.data);
    }
    let active = 0, pending = 0;
    for (const profile of allProfiles) {
      const user = await service.auth.admin.getUserById(profile.id);
      if (user.error || !user.data.user) return fail('LOOKUP_FAILED', 502);
      if (user.data.user.last_sign_in_at) active++;
      else pending++;
    }
    return json({
      exists: true,
      name: organization.data[0].name,
      lifecycle_state: organization.data[0].lifecycle_state,
      plan_id: plan.data ?? null,
      admins: { active, pending },
      stage_config_count: stages.count,
      features: (features.data ?? []).map((f) => ({ key: f.feature_key, enabled: f.enabled })),
    }, 200);
  };
  const handleCreate = async () => {
    const fields = [
      ['name', 'ORG_NAME_REQUIRED'],
      ['admin_email', 'BAD_EMAIL'],
      ['admin_full_name', 'ADMIN_NAME_REQUIRED'],
      ['default_currency', 'CURRENCY_REQUIRED'],
      ['default_locale', 'LOCALE_REQUIRED'],
      ['default_timezone', 'TIMEZONE_REQUIRED'],
      ['plan_id', 'PLAN_REQUIRED'],
    ];
    for (const [key, code] of fields) {
      if (!get(key) || (key === 'admin_email' && !isValidInviteEmail(get(key)))) return fail(code, 400);
    }
    // PostgREST treats * as a wildcard even when SQL pattern characters are escaped.
    if (get('name').includes('*')) return fail('BAD_ORG_NAME', 400);
    if (!serviceKey) return fail('MISCONFIGURED', 500);
    const service = getService();
    const rate = await checkRequestRate(service as never, {
      key: `operator-org:create:${data.user.id}`,
      limit: 5,
      windowSecs: 60,
    });
    if (rate.exceeded) {
      return new Response(JSON.stringify({ error: 'RATE_LIMITED' }), {
        status: 429,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'Retry-After': String(rate.retryAfterSeconds),
        },
      });
    }
    // The plan tables have no table path for any API role by design (0530); Operator reads go
    // through 0537's operator_plan_catalogue under the caller's token — no service key needed here.
    const catalogue = await caller.rpc('operator_plan_catalogue');
    if (catalogue.error) return fail('LOOKUP_FAILED', 502);
    if (!catalogue.data?.some((row: { plan_id: string }) => row.plan_id === get('plan_id'))) {
      return fail('UNKNOWN_PLAN', 400);
    }
    // Escape SQL pattern metacharacters; * is separately refused by validation.
    const escape = (value: string) => value.replace(/[\\%_]/g, '\\$&');
    const email = get('admin_email');
    const existing = await service.from('organizations').select('id').ilike('name', escape(get('name')))
      .order('created_at').order('id').limit(1);
    if (existing.error) return fail('LOOKUP_FAILED', 502);
    if (existing.data?.length) {
      const id = existing.data[0].id;
      const admin = await service.from('profiles').select('id').eq('org_id', id).eq('role', 'Admin').ilike(
        'email',
        escape(email),
      ).limit(1);
      if (admin.error) return fail('LOOKUP_FAILED', 502);
      return admin.data?.length
        ? json({ ok: true, org_id: id, created: false }, 200)
        : fail('ORG_NAME_TAKEN', 409);
    }
    const profiles = await service.from('profiles').select('id').ilike('email', escape(email)).limit(1);
    if (profiles.error) return fail('LOOKUP_FAILED', 502);
    if (profiles.data?.length) return fail('ADMIN_HAS_PROFILE', 409);
    let account:
      | { id: string; last_sign_in_at?: string | null; user_metadata?: Record<string, unknown> }
      | undefined;
    // ponytail: one Auth call per page of all project accounts; the installed client has no
    // address lookup. Upgrade to a definer function that looks up one account by address.
    for (let page = 1;; page++) {
      const result = await service.auth.admin.listUsers({ page, perPage: 1000 });
      if (result.error) return fail('LOOKUP_FAILED', 502);
      account = result.data.users.find((u) => u.email?.trim().toLowerCase() === email.toLowerCase());
      if (account || result.data.users.length === 0) break;
    }
    let adminId = account?.id;
    // Only a profile-less, never-signed-in pending invite can be reused.
    if (account) {
      if (account.last_sign_in_at || account.user_metadata?.invite_pending !== true) {
        return fail('ADMIN_ACCOUNT_EXISTS', 409);
      }
    } else {
      // Redirects come from server configuration, never the request origin.
      const site = Deno.env.get('SITE_URL');
      if (!site) return fail('MISCONFIGURED', 500);
      const invite = await service.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${site.replace(/\/$/, '')}/update-password`,
        data: { invite_pending: true },
      });
      if (invite.error || !invite.data.user?.id) return fail('INVITE_FAILED', 502);
      if (
        invite.data.user.last_sign_in_at ||
        invite.data.user.email?.trim().toLowerCase() !== email.toLowerCase() ||
        invite.data.user.user_metadata?.invite_pending !== true
      ) return fail('ADMIN_ACCOUNT_EXISTS', 409);
      adminId = invite.data.user.id;
    }
    // Never delete or alter an account as compensation if a later write fails.
    // Use the caller client so the database enforces Operator checks and records the actor.
    const created = await caller.rpc('operator_create_org', {
      p_name: get('name'),
      p_admin_user_id: adminId,
      p_admin_full_name: get('admin_full_name'),
      p_default_currency: get('default_currency'),
      p_default_locale: get('default_locale'),
      p_default_number_locale: get('default_number_locale') || null,
      p_default_timezone: get('default_timezone'),
    });
    if (created.error) {
      return created.error.message.includes('org_name_taken')
        ? fail('ORG_NAME_TAKEN', 409)
        : fail('ORG_CREATE_FAILED', 502, { step: 'create_org' });
    }
    // Keep the caller client for the database's Operator checks and audit actor.
    const assigned = await caller.rpc('operator_set_org_plan', {
      p_org_id: created.data,
      p_plan_id: get('plan_id'),
    });
    if (assigned.error) return fail('PLAN_ASSIGN_FAILED', 502, { step: 'assign_plan', org_id: created.data });
    return json({ ok: true, org_id: created.data, created: true }, 200);
  };
  if (body.action === 'status') return handleStatus();
  if (body.action === 'create') return handleCreate();
  return fail('BAD_ACTION', 400);
});
