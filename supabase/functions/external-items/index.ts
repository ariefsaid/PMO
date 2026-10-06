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
import { resolveErpAuthPair } from '../_shared/erpAuthPair.ts';
import { isPrivateOrReservedHost } from '../external-companies/index.ts';
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
  const { data: binding, error } = await service
    .from('external_org_bindings')
    .select('site_url,secret_ref,status,activated_at,config')
    .eq('org_id', profile.org_id)
    .eq('external_tier', 'erpnext')
    .maybeSingle();
  if (error || !binding) return json({ error: 'BINDING_NOT_FOUND' }, 404);
  if (binding.status !== 'active' || !binding.activated_at)
    return json({ error: 'config-rejected', message: 'ERPNext binding is not active' }, 422);
  const company = (binding.config as { company?: unknown } | null)?.company;
  if (purpose === 'purchase-tax-templates' && (typeof company !== 'string' || !company))
    return json({ error: 'config-rejected', message: 'ERPNext company is not set' }, 422);
  try {
    const site = new URL(binding.site_url);
    if (site.protocol !== 'https:' || isPrivateOrReservedHost(site.hostname))
      return json({ error: 'config-rejected', message: 'ERPNext site URL is not permitted' }, 422);
    const credentials = await resolveErpAuthPair(service, {
      orgId: profile.org_id,
      secretRef: binding.secret_ref,
    });
    const client = { ...credentials, baseUrl: binding.site_url, fetchImpl: fetch, maxRetries: 0 };
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
