/** Org-scoped ERP Item picker. Catalog authority stays in ERPNext; React Query caches the read.
 *  #520: `purpose: 'purchase-tax-templates'` lists the binding company's enabled Purchase Taxes and Charges Templates
 *  for the vendor-invoice picker (the company comes from the binding, never the caller). */
import { createClient } from '@supabase/supabase-js';
import {
  bearerToken,
  verifyCallerJwt,
  jwksFromUrl,
  type JwksResolver,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import { listErpItems } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/itemCatalog.ts';
import { listPurchaseTaxTemplates } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/erpPurchaseTaxRows.ts';
import { erpClientForOrg } from '../_shared/erpClientForOrg.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

let jwks: JwksResolver | null = null;
export function setTestJwks(resolver: JwksResolver): void {
  jwks = resolver;
}
const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};
function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

export async function handleItemsRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return json({});
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const jwt = bearerToken(req.headers.get('Authorization'));
  if (!jwt) return json({ error: 'UNAUTHORIZED' }, 401);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) return json({ error: 'MISCONFIGURED' }, 500);
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
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  // Caller-JWT RLS is the active-member check, as in adapter-dispatch. No caller-supplied org.
  const caller = createClient(url, key, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: profile, error: profileError } = await caller
    .from('profiles')
    .select('org_id')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile?.org_id) return json({ error: 'FORBIDDEN' }, 403);
  let purpose: unknown;
  try {
    purpose = (await req.json()).purpose;
  } catch {
    return json({ error: 'BAD_REQUEST' }, 400);
  }
  if (purpose !== 'sales' && purpose !== 'purchase' && purpose !== 'purchase-tax-templates')
    return json({ error: 'BAD_REQUEST' }, 400);

  const service = createClient(url, key, clientOptions);
  const connection = await erpClientForOrg(service, profile.org_id, {
    requireCompany: purpose === 'purchase-tax-templates',
  });
  if ('refusal' in connection) {
    if (connection.refusal === 'company-not-set')
      return json({ error: 'config-rejected', message: 'ERPNext company is not set' }, 422);
    if (connection.refusal === 'not-found') return json({ error: 'BINDING_NOT_FOUND' }, 404);
    if (connection.refusal === 'inactive')
      return json({ error: 'config-rejected', message: 'ERPNext binding is not active' }, 422);
    if (connection.refusal === 'invalid-site')
      return json({ error: 'config-rejected', message: 'ERPNext site URL is not permitted' }, 422);
    return json({ error: 'external-unreachable', message: purpose === 'purchase-tax-templates' ? 'Could not load ERP tax templates. Try again.' : 'Could not load ERP items. Try again.' }, 502);
  }
  const company = connection.config?.company;
  try {
    const client = connection.client;
    if (purpose === 'purchase-tax-templates')
      return json({ templates: await listPurchaseTaxTemplates(client, company as string) });
    const items = await listErpItems(client, purpose);
    return json({ items });
  } catch {
    // Stable public error; upstream text may contain private ERP document details.
    return json(
      {
        error: 'external-unreachable',
        message:
          purpose === 'purchase-tax-templates'
            ? 'Could not load ERP tax templates. Try again.'
            : 'Could not load ERP items. Try again.',
      },
      502,
    );
  }
}

if (import.meta.main) serveWithErrorReporting('external-items', handleItemsRequest);
