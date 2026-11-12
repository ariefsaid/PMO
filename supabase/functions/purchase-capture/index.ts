/** Caller-authorized, read-only purchase-history preview. */
import { createClient } from '@supabase/supabase-js';
import { verifyCallerJwt, JwtVerifyError, jwksFromUrl, type JwksResolver } from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import { collectCaptureSources, collectCaptureLedger, proposeCapture, reconcileCapture, type CaptureAdapter, type CaptureDocument } from '../../../pmo-portal/src/lib/adapterSeam/captureHistory.ts';
import { createPurchaseCaptureAdapter as createErpNextAdapter, type CaptureMirrorRow, type CaptureMirrorLedgerLine } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/captureHistory.ts';
import { createPurchaseCaptureAdapter as createOdooAdapter } from '../../../pmo-portal/src/lib/adapterSeam/odoo/captureHistory.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

let jwks: JwksResolver | null = null;
export function setTestJwks(resolver: JwksResolver): void { jwks = resolver; }
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' },
});

export async function handlePurchaseCaptureRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return json('ok');
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) return json({ error: 'UNAUTHORIZED' }, 401);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!url || !serviceKey || !anonKey) return json({ error: 'MISCONFIGURED' }, 500);
  let userId: string;
  try {
    jwks ??= jwksFromUrl(`${url}/auth/v1/.well-known/jwks.json`);
    userId = (await verifyCallerJwt(token, jwks, { issuer: Deno.env.get('EDGE_JWT_ISSUER') ?? `${url}/auth/v1`, audience: 'authenticated', algorithms: ['ES256'] })).sub;
  } catch (err) { return json({ error: 'UNAUTHORIZED' }, err instanceof JwtVerifyError ? err.status : 401); }
  let body: { action?: unknown; scope?: { projectId?: unknown } };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  const projectId = body?.scope?.projectId;
  if (!['preview', 'report', 'apply'].includes(String(body?.action)) || (projectId !== null && (typeof projectId !== 'string' || !UUID.test(projectId)))) {
    return json({ error: 'BAD_REQUEST' }, 400);
  }
  const service = createClient(url, serviceKey, options);
  const { data: profile, error: profileError } = await service.from('profiles').select('org_id,role,status').eq('id', userId).single();
  if (profileError || !profile || profile.role !== 'Admin' || profile.status !== 'active') return json({ error: 'FORBIDDEN' }, 403);
  const { data: state, error: stateError } = await service.rpc('actor_authorization_state', { p_org_id: profile.org_id, p_user_id: userId });
  if (stateError || !state || state.active !== true || state.role !== 'Admin') return json({ error: 'FORBIDDEN' }, 403);
  const { data: bindings, error: bindingError } = await service.from('external_org_bindings').select('id,external_tier,config')
    .eq('org_id', profile.org_id).not('activated_at', 'is', null).eq('status', 'active').limit(2);
  if (bindingError || !bindings || bindings.length !== 1) return json({ error: 'BINDING_UNAVAILABLE' }, 409);
  const caller = createClient(url, anonKey, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
  const config = bindings[0].config as { project_map?: Record<string, unknown> } | null;
  const factories: Record<string, () => CaptureAdapter> = {
    erpnext: () => createErpNextAdapter(async (cursor) => {
      const { data, error } = await caller.rpc('purchase_capture_source_page', { p_cursor: cursor, p_project_id: body.action === 'report' ? null : projectId, p_limit: 500 });
      if (error || !data || !Array.isArray(data.sources) || typeof data.revision !== 'string') throw new Error('source read failed');
      return { rows: data.sources as CaptureMirrorRow[], nextCursor: data.next_cursor, revision: data.revision };
    }, { projectMap: config?.project_map ?? {}, readPage: async (cursor) => {
      const { data, error } = await caller.rpc('purchase_capture_ledger_page', { p_cursor: cursor, p_limit: 500 });
      if (error || !data || !Array.isArray(data.lines) || typeof data.revision !== 'string') throw new Error('ledger read failed');
      return { rows: data.lines as CaptureMirrorLedgerLine[], nextCursor: data.next_cursor, revision: data.revision };
    } }),
    odoo: createOdooAdapter,
  };
  const factory = factories[String(bindings[0].external_tier)];
  if (!factory) return json({ error: 'UNSUPPORTED', missing: ['purchase capture adapter'] }, 409);
  const adapter = factory();
  const census = await collectCaptureSources(adapter);
  if (!census.complete || !census.revision) return json({ complete: false, missing: census.missing, erp_write: false }, 409);
  const { data: health, error: healthError } = await caller.rpc('purchase_capture_feed_health');
  const feedHealth = healthError || !health ? { caught_up: false, reason: 'purchase_feed_health_unavailable' } : health;
  if (body.action === 'apply') return json({ error: 'NOT_AVAILABLE', erp_write: false }, 501);
  if (body.action === 'report' || body.action === 'preview') {
    const ledger = await collectCaptureLedger(adapter, census.revision);
    const { data: org, error: orgError } = await service.from('organizations').select('default_currency').eq('id', profile.org_id).single();
    if (orgError || !org?.default_currency) return json({ error: 'CURRENCY_UNAVAILABLE', erp_write: false }, 409);
    const documents: CaptureDocument[] = census.sources.map((source) => ({ id: source.id,
      projectId: source.projectIds.length === 1 ? source.projectIds[0] : null,
      purchaseId: source.purchaseId, kind: source.kind, state: source.state }));
    const projectIds = projectId ? [projectId as string] : [...new Set([
      ...ledger.lines.flatMap((fact) => fact.projectId ? [fact.projectId] : []),
      ...census.sources.flatMap((source) => source.projectIds),
    ])];
    const unassigned = ledger.lines.filter((fact) => fact.projectId === null);
    const reports = await Promise.all(projectIds.map(async (id) => {
      const facts = ledger.lines.filter((fact) => fact.projectId === id);
      const canVerify = ledger.complete && feedHealth.caught_up === true && unassigned.length === 0
        && facts.every((fact) => !fact.reason);
      const witnessResult = canVerify ? await caller.rpc('purchase_capture_actuals_witness', { p_project_id: id }) : null;
      const witness = witnessResult?.error ? null : witnessResult?.data;
      const report = reconcileCapture({ projectId: id, currency: org.default_currency,
        complete: canVerify && witness?.complete === true && witness?.revision === census.revision,
        expectedActualsCents: witness?.amount_cents,
        ledger: facts.filter((fact) => !fact.reason).map((fact) => fact.line), documents });
      report.remainder.push(...facts.filter((fact) => fact.reason).map((fact) => ({ ...fact.line, reason: fact.reason! })));
      return report;
    }));
    const complete = reports.length > 0 && reports.every((report) => report.complete) && unassigned.length === 0;
    return json({ complete, revision: census.revision, reports, unassigned,
      ...(body.action === 'preview' ? { proposals: proposeCapture(census.sources, projectId as string | null) } : {}),
      feed_health: feedHealth, missing: [...ledger.missing, ...(feedHealth.caught_up ? [] : ['purchase feed not current']),
        ...(complete ? [] : ['actuals snapshot or ledger coverage not verified'])], erp_write: false });
  }
  return json({ error: 'BAD_REQUEST' }, 400);
}

if (import.meta.main) serveWithErrorReporting('purchase-capture', handlePurchaseCaptureRequest);
