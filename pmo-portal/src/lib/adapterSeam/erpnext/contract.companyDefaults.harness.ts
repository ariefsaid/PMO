/**
 * ERPNext's company-defaults.set harness (#1599 ECX-3): drives the SHIPPED `companyDefaults.ts` against a fake ERPNext that
 * answers the way the bed did (`__fixtures__/companyDefaults.json`): a Company PUT is refused only for a group account, another
 * company's account or an unknown name (417), and is ACCEPTED for an account of the wrong type and for a group or another
 * company's cost centre. No behaviour lives here; it only translates PMO terms to ERPNext records.
 */
import type { CompanyDefaultsHarness } from '../contractSuite/harness.ts';
import type { CompanyDefaultSlot, DefaultTargetFacts } from '../companyDefaults.ts';
import { createErpnextCompanyDefaults, ERPNEXT_DEFAULT_FIELD } from './companyDefaults.ts';

const COMPANY = 'Test Co';
const SLOT_OF = Object.fromEntries(Object.entries(ERPNEXT_DEFAULT_FIELD).map(([slot, field]) => [field, slot])) as Record<string, CompanyDefaultSlot>;

/** The bed's refusal body for a Company save (fixture case "bank<-group"). */
function refusal(message: string, excType = 'ValidationError'): Response {
  return new Response(JSON.stringify({
    exception: `frappe.exceptions.${excType}: ${message}`, exc_type: excType,
    _server_messages: JSON.stringify([JSON.stringify({ message, title: 'Message', indicator: 'red' })]),
  }), { status: 417, headers: { 'content-type': 'application/json' } });
}
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response(JSON.stringify({ exc_type: 'DoesNotExistError' }), { status: 404, headers: { 'content-type': 'application/json' } });

export function createCompanyDefaultsHarness(): CompanyDefaultsHarness {
  const accounts = new Map<string, Record<string, unknown>>();
  const centres = new Map<string, Record<string, unknown>>();
  const company: Record<string, unknown> = {
    name: COMPANY, default_payable_account: null, default_expense_account: null, default_cash_account: null,
    default_bank_account: null, cost_center: null, modified: '2026-11-16 00:00:00.000000',
  };
  const writes: CompanyDefaultSlot[][] = [];
  let dropNext = false;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    const [, , , doctype, rawName] = u.pathname.split('/');
    const name = rawName === undefined ? undefined : decodeURIComponent(rawName);
    const method = init?.method ?? 'GET';
    const type = decodeURIComponent(doctype);
    if (type === 'Account' && method === 'GET') { const d = accounts.get(name ?? ''); return d ? ok(d) : notFound(); }
    if (type === 'Cost Center' && method === 'GET') { const d = centres.get(name ?? ''); return d ? ok(d) : notFound(); }
    if (type !== 'Company' || name !== COMPANY) return notFound();
    if (method === 'GET') return ok({ ...company });
    if (method !== 'PUT') return notFound();
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    for (const [field, value] of Object.entries(body)) {
      if (!(field in SLOT_OF)) continue;            // the bed drops an unknown field silently
      if (value === null || value === '') continue;
      if (field === 'cost_center') {
        if (!centres.has(String(value))) return refusal(`Could not find Cost Center: ${value}`, 'LinkValidationError');
        continue;                                    // the bed accepts a group or another company's cost centre
      }
      const a = accounts.get(String(value));
      if (!a) return refusal(`Could not find Default Account: ${value}`, 'LinkValidationError');
      if (a.is_group) return refusal(`<strong>Default Account</strong>: <strong>${value}</strong> is a group account.`);
      if (a.company !== COMPANY) return refusal(`Account ${value} does not belong to company: ${COMPANY}`);
      // the bed checks no account type
    }
    writes.push(Object.keys(body).filter((f) => f in SLOT_OF).map((f) => SLOT_OF[f]));
    if (dropNext) { dropNext = false; return ok({ ...company }); }
    for (const [field, value] of Object.entries(body)) if (field in SLOT_OF) company[field] = value === '' ? null : value;
    company.modified = new Date().toISOString();
    return ok({ ...company });
  }) as typeof fetch;

  const client = { fetchImpl, apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://erp.test', maxRetries: 0 };
  return {
    company: COMPANY,
    writer: createErpnextCompanyDefaults(client, COMPANY),
    load(kind, f: DefaultTargetFacts) {
      const doc = { name: f.name, company: f.company, is_group: f.isGroup ? 1 : 0, disabled: f.disabled ? 1 : 0 };
      if (kind === 'cost_centre') centres.set(f.name, doc);
      else accounts.set(f.name, { ...doc, root_type: f.rootType ?? null, account_type: f.accountType ?? '' });
    },
    held: () => Object.fromEntries(Object.entries(ERPNEXT_DEFAULT_FIELD).map(([slot, field]) => [slot, (company[field] as string | null) || null])) as ReturnType<CompanyDefaultsHarness['held']>,
    writes: () => writes.map((w) => [...w]),
    dropNextWrite: () => { dropNext = true; },
  };
}
