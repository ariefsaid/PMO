/**
 * Odoo company listing and set-once activation (FR-ODC-005, PQ-8). Both read through the stored key before
 * activation (the only Odoo calls allowed until then); `activate_odoo_binding` refuses a second company.
 */
import { bindCall, odooCall, OdooError, type OdooClientDeps } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { fetchOdooVersionMajor, type OdooCompany } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/connect.ts';
import { INITIAL_CONNECTION, nextConnection } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/connectionState.ts';
import { discoverCapabilities, DISCOVERY_BUDGET_MS, versionPolicy } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { odooClientForOrg } from '../../_shared/odooClientForOrg.ts';
import { odooError, type OdooCtx } from './router.ts';

type Companies = { companies: OdooCompany[]; client: OdooClientDeps; config: Record<string, unknown> } | { response: Response };

async function readCompanies(c: OdooCtx): Promise<Companies> {
  const r = await odooClientForOrg(c.sc, c.orgId, { requireActivated: false, requireCompany: false });
  if ('refusal' in r) return { response: odooError(c, 'The Odoo connection is not usable', r.refusal, 422) };
  try {
    const rows = await odooCall<OdooCompany[]>(r.client, 'res.company', 'search_read', { domain: [], fields: ['id', 'name'] });
    return { companies: rows.map(({ id, name }) => ({ id, name })), client: r.client, config: r.config };
  } catch (err) {
    return { response: odooError(c, 'Odoo did not answer', err instanceof OdooError ? err.errorClass : 'unreachable', 502) };
  }
}

export async function listCompanies(c: OdooCtx): Promise<Response> {
  const read = await readCompanies(c);
  return 'response' in read ? read.response : c.respond({ companies: read.companies });
}

export async function activate(c: OdooCtx): Promise<Response> {
  const companyId = Number(c.body.companyId);
  if (!Number.isInteger(companyId)) return odooError(c, 'companyId is required', 'BAD_REQUEST', 400);
  const read = await readCompanies(c);
  if ('response' in read) return read.response;
  const chosen = read.companies.find((x) => x.id === companyId);
  if (!chosen) return odooError(c, 'That company is not available to this key', 'company-not-found', 404);
  const versionMajor = await fetchOdooVersionMajor(read.client);
  const verdict = versionPolicy(versionMajor, true);
  if (!verdict.ok) return odooError(c, 'This Odoo version is not supported. Odoo 20 or later is needed.', verdict.reason, 422);
  // FR-ODC-020/021: activation stores the first capability snapshot and the state it implies, in the same write.
  let capabilities;
  try {
    capabilities = await discoverCapabilities(bindCall(read.client), { versionMajor, now: new Date(), deadlineAt: Date.now() + DISCOVERY_BUDGET_MS });
  } catch (err) {
    const errorClass = err instanceof OdooError ? err.errorClass : 'unreachable';
    return odooError(c, errorClass === 'timeout' ? 'Odoo is slow, try again' : 'Odoo did not answer', errorClass, 502);
  }
  const keyExpiresOn = typeof read.config.key_expires_on === 'string' ? read.config.key_expires_on : null;
  const connection = nextConnection(INITIAL_CONNECTION, { ok: true, missing: capabilities.missing }, { now: new Date(), keyExpiresOn, activated: true, disconnected: false });
  const { data: activatedAt, error } = await c.sc.rpc('activate_odoo_binding', {
    p_org_id: c.orgId, p_version_major: versionMajor, p_company_id: chosen.id, p_company_name: chosen.name, p_config_patch: { capabilities, connection }, p_actor_id: c.userId,
  });
  if (error) {
    const msg = error.message ?? '';
    if (/already chosen/.test(msg)) return odooError(c, 'This connection is locked to the company picked first', 'company-locked', 409);
    if (/unsupported odoo major version/.test(msg)) return odooError(c, 'This Odoo version is not supported. Odoo 20 or later is needed.', 'unsupported-version', 409);
    return odooError(c, 'Activation was refused', 'activation-refused', 409);
  }
  return c.respond({ ok: true, companyId: chosen.id, versionMajor, activatedAt });
}
