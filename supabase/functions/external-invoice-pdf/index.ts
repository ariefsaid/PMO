/**
 * external-invoice-pdf (#912, OD-INV-PDF-1, ADR-0083) — the ERP's own print-format PDF of a SUBMITTED,
 * ERP-owned sales invoice, for an Admin/Finance caller of that invoice's org.
 *
 * Shape copied from external-items: verify the caller JWT locally (ADR-0057) → every PMO read under the
 * CALLER's JWT (RLS is the tenancy boundary) → the service role ONLY for the ERP binding + credential
 * (resolveErpAuthPair, ADR-0072) → https + host guard → the ERP call (erpnext/invoicePdf.ts).
 * The ERP document name comes from the machine-written `external_refs` link; the request names only
 * the PMO invoice id (DD-PDF-3). The credential never leaves this function. Nothing is stored.
 */
import { createClient } from '@supabase/supabase-js';
import {
  bearerToken,
  verifyCallerJwt,
  jwksFromUrl,
  type JwksResolver,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import {
  fetchSubmittedSalesInvoicePdf,
  InvoicePdfError,
  type InvoicePdfFailure,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/invoicePdf.ts';
import { safePdfFilename } from '../../../pmo-portal/src/lib/invoicePdfFilename.ts';
import { erpClientForOrg } from '../_shared/erpClientForOrg.ts';
import { moneyWriteRolesForDomain } from '../_shared/moneyWriteRoles.ts';
import { logStructuredError } from '../_shared/errorLog.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

let jwks: JwksResolver | null = null;
export function setTestJwks(resolver: JwksResolver): void {
  jwks = resolver;
}
const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DD-PDF-7: every refusal carries a FIXED message — never ERP-supplied text. */
const REFUSALS = {
  UNAUTHORIZED: [401, 'Sign in again to download this invoice.'],
  FORBIDDEN: [403, 'You do not have access to download this invoice.'],
  BAD_REQUEST: [400, 'The request did not name an invoice.'],
  METHOD_NOT_ALLOWED: [405, 'Use POST.'],
  NOT_FOUND: [404, 'This invoice is not available.'],
  NOT_SUBMITTED: [409, 'Only a submitted invoice can be downloaded.'],
  NOT_ERP_INVOICE: [409, 'This invoice was not issued through the ERP.'],
  ERP_NOT_CONNECTED: [422, 'The ERP connection is not active.'],
  ERP_NOT_PERMITTED: [502, 'The ERP refused to print this invoice.'],
  ERP_DOCUMENT_MISSING: [502, 'The ERP has no such invoice.'],
  ERP_UNREACHABLE: [502, 'The ERP did not answer. Try again.'],
  MISCONFIGURED: [500, 'Server misconfigured.'],
} as const satisfies Record<string, readonly [number, string]>;
type RefusalCode = keyof typeof REFUSALS;

function refuse(code: RefusalCode): Response {
  const [status, message] = REFUSALS[code];
  return Response.json({ error: code, message }, { status, headers: CORS });
}

const FAILURE_CODE: Record<InvoicePdfFailure, RefusalCode> = {
  'not-submitted': 'NOT_SUBMITTED',
  'not-permitted': 'ERP_NOT_PERMITTED',
  'not-found': 'ERP_DOCUMENT_MISSING',
  unreachable: 'ERP_UNREACHABLE',
};

export async function handleInvoicePdfRequest(req: Request): Promise<Response> {
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
    userId = (
      await verifyCallerJwt(jwt, jwks, {
        issuer: Deno.env.get('EDGE_JWT_ISSUER') ?? `${url}/auth/v1`,
        audience: 'authenticated',
        algorithms: ['ES256'],
      })
    ).sub;
  } catch {
    return refuse('UNAUTHORIZED');
  }

  // NFR-PDF-SEC-002: every PMO read below runs under the CALLER's JWT. No caller-supplied org.
  const caller = createClient(url, key, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: profile, error: profileError } = await caller
    .from('profiles')
    .select('org_id')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile?.org_id) return refuse('FORBIDDEN');
  const orgId = profile.org_id as string;

  // DD-PDF-1: the CURRENT role + active membership — the rule the revenue money dispatch applies.
  const { data: actorState, error: actorError } = await caller.rpc('actor_authorization_state', {
    p_org_id: orgId,
    p_user_id: userId,
  });
  const standing = actorState as { role: string | null; active: boolean } | null;
  if (actorError || !standing?.active || !standing.role || !moneyWriteRolesForDomain('revenue').includes(standing.role))
    return refuse('FORBIDDEN');

  let salesInvoiceId: unknown;
  try {
    salesInvoiceId = (await req.json())?.salesInvoiceId;
  } catch {
    return refuse('BAD_REQUEST');
  }
  if (typeof salesInvoiceId !== 'string' || !UUID.test(salesInvoiceId)) return refuse('BAD_REQUEST');

  const { data: invoice, error: invoiceError } = await caller
    .from('sales_invoices')
    .select('id,org_id,status,erp_docstatus')
    .eq('id', salesInvoiceId)
    .maybeSingle();
  if (invoiceError || !invoice || invoice.org_id !== orgId) return refuse('NOT_FOUND');
  if (invoice.erp_docstatus === null || invoice.erp_docstatus === undefined) return refuse('NOT_ERP_INVOICE');
  if (invoice.erp_docstatus !== 1 || invoice.status === 'Draft' || invoice.status === 'Cancelled')
    return refuse('NOT_SUBMITTED');

  // DD-PDF-3: the ERP name comes from the machine-written link (repointed on amend), never the request.
  const { data: link, error: linkError } = await caller
    .from('external_refs')
    .select('external_record_id,external_tier')
    .eq('org_id', orgId)
    .eq('domain', 'revenue')
    .eq('pmo_record_id', salesInvoiceId)
    .maybeSingle();
  if (linkError || !link || link.external_tier !== 'erpnext' || typeof link.external_record_id !== 'string' || !link.external_record_id)
    return refuse('NOT_ERP_INVOICE');
  const erpName = link.external_record_id as string;

  const service = createClient(url, key, clientOptions);
  const connection = await erpClientForOrg(service, orgId);
  if ('refusal' in connection) return refuse('ERP_NOT_CONNECTED');

  try {
    const bytes = await fetchSubmittedSalesInvoicePdf(
      connection.client,
      erpName,
    );
    return new Response(bytes, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safePdfFilename(erpName)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const code: RefusalCode = err instanceof InvoicePdfError ? FAILURE_CODE[err.kind] : 'ERP_UNREACHABLE';
    // NFR-PDF-OBS-001: the two outcomes an operator must act on, by code + PMO id only.
    if (code === 'ERP_NOT_PERMITTED' || code === 'ERP_DOCUMENT_MISSING')
      logStructuredError({ fn: 'external-invoice-pdf', errorCode: code, contextId: salesInvoiceId });
    return refuse(code);
  }
}

if (import.meta.main) serveWithErrorReporting('external-invoice-pdf', handleInvoicePdfRequest);
