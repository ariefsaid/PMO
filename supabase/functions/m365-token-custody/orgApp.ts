import type { HandlerDeps, HandlerResult } from './types.ts';

export interface ResolvedApp { tenantId: string; clientId: string; clientSecret: string; source: 'org' | 'deployment' }

export async function resolveOrgApp(deps: HandlerDeps, orgId: string): Promise<ResolvedApp | HandlerResult> {
  const { data, error } = await deps.serviceClient.rpc('m365_org_app_resolve', { p_org_id: orgId });
  if (error || !Array.isArray(data) || data.length > 1) return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Unable to resolve application' } };
  if (data.length === 1) {
    const row = data[0] as Record<string, unknown>;
    if (typeof row.tenant_id !== 'string' || typeof row.client_id !== 'string' || typeof row.client_secret !== 'string' || !row.tenant_id || !row.client_id || !row.client_secret) return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Unable to resolve application' } };
    return { tenantId: row.tenant_id, clientId: row.client_id, clientSecret: row.client_secret, source: 'org' };
  }
  const { m365TenantId, m365ClientId, m365ClientSecret } = deps.env;
  if (!m365TenantId || !m365ClientId || !m365ClientSecret) return { status: 409, body: { error: 'M365_APP_NOT_CONFIGURED', message: 'Microsoft application is not configured' } };
  return { tenantId: m365TenantId, clientId: m365ClientId, clientSecret: m365ClientSecret, source: 'deployment' };
}

import { resolveOrgOrResult } from './auth.ts';
import { authorizeAdminOrOperator } from './orgApproval.ts';
import { errorResult, M365HandlerError } from './types.ts';
import { fetchMicrosoftJson } from './microsoftTransport.ts';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: string): HandlerResult => ({ status, body: { error, message: error } });

async function adminOrg(deps: HandlerDeps): Promise<string | HandlerResult> {
  const org = await resolveOrgOrResult(deps);
  if (typeof org !== 'string') return org;
  try {
    const profileOrg = await authorizeAdminOrOperator({ callerClient: deps.callerClient, serviceClient: deps.serviceClient, userId: deps.userId });
    if (profileOrg !== org) return fail(403, 'FORBIDDEN');
  }
  catch (err) { if (err instanceof M365HandlerError) return errorResult(err); throw err; }
  return org;
}

export async function handleSaveOrgApp(deps: HandlerDeps, body: Record<string, unknown>): Promise<HandlerResult> {
  const orgId = await adminOrg(deps);
  if (typeof orgId !== 'string') return orgId;
  const tenant = typeof body.tenantId === 'string' ? body.tenantId.trim().toLowerCase() : '';
  const client = typeof body.clientId === 'string' ? body.clientId.trim().toLowerCase() : '';
  const secret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : undefined;
  if (!GUID.test(tenant) || !GUID.test(client) || (body.clientSecret !== undefined && (!secret || secret.length > 1024))) return fail(400, 'BAD_REQUEST');
  let validationSecret = secret;
  if (validationSecret === undefined) {
    const existing = await resolveOrgApp(deps, orgId);
    if ('status' in existing) return existing.status === 409 ? fail(400, 'BAD_REQUEST') : existing;
    if (existing.source !== 'org') return fail(400, 'BAD_REQUEST');
    validationSecret = existing.clientSecret;
  }
  let reply: Awaited<ReturnType<typeof fetchMicrosoftJson>>;
  try {
    reply = await fetchMicrosoftJson(deps.fetch ?? fetch, `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: client, client_secret: validationSecret, scope: 'https://graph.microsoft.com/.default' }),
    });
  } catch { return fail(502, 'MICROSOFT_UNREACHABLE'); }
  if (!reply.response.ok) {
    const data = reply.data && typeof reply.data === 'object' ? reply.data as Record<string, unknown> : {};
    const codes = Array.isArray(data.error_codes) ? data.error_codes : [];
    if (reply.response.status >= 400 && reply.response.status < 500) {
      if (data.error === 'invalid_tenant' || codes.includes(90002)) return fail(422, 'TENANT_REJECTED');
      if (typeof data.error === 'string' && data.error.length > 0) return fail(422, 'APP_REJECTED');
    }
    return fail(502, 'MICROSOFT_UNREACHABLE');
  }
  if (!reply.data || typeof reply.data !== 'object' || typeof (reply.data as Record<string, unknown>).access_token !== 'string' || !(reply.data as Record<string, string>).access_token.trim()) return fail(502, 'MICROSOFT_UNREACHABLE');
  const { data, error } = await deps.serviceClient.rpc('m365_set_org_app', { p_org_id: orgId, p_tenant_id: tenant, p_client_id: client, p_secret_value: secret ?? null, p_actor_id: deps.userId });
  if (error) return fail(500, 'INTERNAL_ERROR');
  return { status: 200, body: { success: true, changedApp: (data as { changed_app?: unknown } | null)?.changed_app === true } };
}

export async function handleOrgAppInfo(deps: HandlerDeps): Promise<HandlerResult> {
  const orgId = await adminOrg(deps);
  if (typeof orgId !== 'string') return orgId;
  const app = await resolveOrgApp(deps, orgId);
  if ('status' in app && app.status !== 409) return app;
  const configured = !('status' in app) && app.source === 'org';
  return { status: 200, body: {
    configured, source: 'status' in app ? null : app.source, tenantId: configured ? app.tenantId : null,
    clientId: configured ? app.clientId : null, secretSet: configured,
    callbackUrls: { connect: deps.env.m365RedirectUri, signIn: `${deps.env.supabaseUrl}/auth/v1/callback` },
  } };
}

export async function handleClearOrgApp(deps: HandlerDeps): Promise<HandlerResult> {
  const orgId = await adminOrg(deps);
  if (typeof orgId !== 'string') return orgId;
  const { error } = await deps.serviceClient.rpc('m365_clear_org_app', { p_org_id: orgId, p_actor_id: deps.userId });
  return error ? fail(500, 'INTERNAL_ERROR') : { status: 200, body: { success: true } };
}
