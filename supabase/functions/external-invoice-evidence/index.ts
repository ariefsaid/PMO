/**
 * Read-only invoice evidence proxy for S-17. Caller identity, active membership, invoice tenancy,
 * and the machine-written ERP link are verified before asking the bound ERP for allowlisted fields.
 * The ERP credential remains server-side; responses are never cached or logged with contact data.
 */
import { createClient } from '@supabase/supabase-js';
import { bearerToken, verifyCallerJwt, jwksFromUrl, type JwksResolver } from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import { projectSalesInvoiceEvidence } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/invoiceEvidence.ts';
import { getDoc } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { erpClientForOrg } from '../_shared/erpClientForOrg.ts';
import { logStructuredError } from '../_shared/errorLog.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

let jwks: JwksResolver | null = null;
export function setTestJwks(resolver: JwksResolver): void { jwks = resolver; }
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_ROLES = ['Admin', 'Executive', 'Project Manager', 'Finance'];
const REFUSALS = {
  UNAUTHORIZED: [401, 'Sign in again to view this invoice.'],
  FORBIDDEN: [403, 'You do not have access to view this invoice.'],
  BAD_REQUEST: [400, 'The request did not name an invoice.'],
  METHOD_NOT_ALLOWED: [405, 'Use POST.'],
  NOT_FOUND: [404, 'This invoice is not available.'],
  ERP_NOT_CONNECTED: [422, 'The ERP connection is not active.'],
  ERP_UNREACHABLE: [502, 'Invoice evidence is temporarily unavailable.'],
  MISCONFIGURED: [500, 'Server misconfigured.'],
} as const;
type Refusal = keyof typeof REFUSALS;
function refuse(code: Refusal): Response {
  const [status, message] = REFUSALS[code];
  return Response.json({ error: code, message }, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });
}

export async function handleInvoiceEvidenceRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return refuse('METHOD_NOT_ALLOWED');
  const jwt = bearerToken(req.headers.get('Authorization'));
  if (!jwt) return refuse('UNAUTHORIZED');
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) return refuse('MISCONFIGURED');
  let userId: string;
  try {
    jwks ??= jwksFromUrl(`${url}/auth/v1/.well-known/jwks.json`);
    userId = (await verifyCallerJwt(jwt, jwks, {
      issuer: Deno.env.get('EDGE_JWT_ISSUER') ?? `${url}/auth/v1`,
      audience: 'authenticated', algorithms: ['ES256'],
    })).sub;
  } catch { return refuse('UNAUTHORIZED'); }

  const caller = createClient(url, key, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: profile, error: profileError } = await caller.from('profiles').select('org_id').eq('id', userId).maybeSingle();
  if (profileError || !profile?.org_id) return refuse('FORBIDDEN');
  const orgId = profile.org_id as string;
  const { data: actorState, error: actorError } = await caller.rpc('actor_authorization_state', {
    p_org_id: orgId, p_user_id: userId,
  });
  const standing = actorState as { role: string | null; active: boolean } | null;
  if (actorError || !standing?.active || !standing.role || !READ_ROLES.includes(standing.role)) return refuse('FORBIDDEN');

  let invoiceId: unknown;
  try { invoiceId = (await req.json())?.salesInvoiceId; } catch { return refuse('BAD_REQUEST'); }
  if (typeof invoiceId !== 'string' || !UUID.test(invoiceId)) return refuse('BAD_REQUEST');
  const { data: invoice, error: invoiceError } = await caller.from('sales_invoices')
    .select('id,org_id').eq('id', invoiceId).eq('org_id', orgId).maybeSingle();
  if (invoiceError || !invoice || invoice.org_id !== orgId) return refuse('NOT_FOUND');
  const { data: link, error: linkError } = await caller.from('external_refs')
    .select('external_record_id,external_tier').eq('org_id', orgId).eq('domain', 'revenue')
    .eq('pmo_record_id', invoiceId).maybeSingle();
  if (linkError || !link || link.external_tier !== 'erpnext'
    || typeof link.external_record_id !== 'string' || !link.external_record_id) return refuse('NOT_FOUND');

  const service = createClient(url, key, clientOptions);
  const connection = await erpClientForOrg(service, orgId);
  if ('refusal' in connection) return refuse('ERP_NOT_CONNECTED');
  try {
    const doc = await getDoc(connection.client, 'Sales Invoice', link.external_record_id);
    const evidence = projectSalesInvoiceEvidence(doc);
    return Response.json(evidence, { headers: { ...CORS, 'Cache-Control': 'no-store' } });
  } catch {
    logStructuredError({ fn: 'external-invoice-evidence', errorCode: 'ERP_UNREACHABLE', contextId: invoiceId });
    return refuse('ERP_UNREACHABLE');
  }
}

if (import.meta.main) serveWithErrorReporting('external-invoice-evidence', handleInvoiceEvidenceRequest);
