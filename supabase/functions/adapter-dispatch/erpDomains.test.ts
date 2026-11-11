// BACK-39: the ERP dispatch domains are ONE list (ERPNEXT_DISPATCH_DOMAINS). Every consumer derives from it, so a
// supported domain resolves the same way in the adapter registry, the ERP-domain gate and the target-binding guards,
// and an unsupported domain fails closed in all of them.
import { assert, assertEquals } from 'jsr:@std/assert';
import { ERPNEXT_DISPATCH_DOMAINS, ERPNEXT_EXPENSES_DOMAIN, ERPNEXT_TIER, isErpDispatchDomain } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { selectAdapterFactory } from './dispatchAdapters.ts';
import { checkTransitionTargetBinding, type GuardLookupClient } from './transitionTargetGuard.ts';
import { moneyWriteRolesForDomain } from '../_shared/moneyWriteRoles.ts';

const noMappingClient = {
  from: () => ({ select: () => ({ eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }) }),
} as unknown as GuardLookupClient;

Deno.test('every ERP dispatch domain has an erpnext adapter factory, is an ERP domain, and is guarded', async () => {
  for (const domain of ERPNEXT_DISPATCH_DOMAINS) {
    assert(selectAdapterFactory(ERPNEXT_TIER, domain), `${domain}: adapter factory`);
    assert(isErpDispatchDomain(domain), `${domain}: ERP-domain gate`);
    const res = await checkTransitionTargetBinding(noMappingClient, 'org-1', { domain, operation: 'transition', record: { id: 'r-1' } });
    assertEquals(res.ok, false, `${domain}: the target-binding guard must not be inert`);
  }
});

Deno.test('an unsupported domain is not an ERP domain anywhere (fail closed)', async () => {
  for (const domain of [ERPNEXT_EXPENSES_DOMAIN, 'unknown-domain']) {
    assertEquals(selectAdapterFactory(ERPNEXT_TIER, domain), undefined, `${domain}: adapter factory`);
    assertEquals(isErpDispatchDomain(domain), false, `${domain}: ERP-domain gate`);
    assertEquals(moneyWriteRolesForDomain(domain), [], `${domain}: no writers`);
    const res = await checkTransitionTargetBinding(noMappingClient, 'org-1', { domain, operation: 'transition', record: { id: 'r-1' } });
    assertEquals(res.ok, true, `${domain}: outside the ERP guard's scope by design`);
  }
});

/**
 * #1511 F4: the equipment register is an externally-owned domain whose tier is Odoo ONLY (D5/D7) — it is deliberately not in
 * `ERPNEXT_DISPATCH_DOMAINS` (ERPNext must never own it, FR-OFM-002), yet it does have a write-role set. It is the ONE named
 * exception; a new domain with writers must still be an ERP dispatch domain or be added here with its own reason.
 */
const ODOO_ONLY_DOMAINS = new Set(['equipment']);

Deno.test('the money role map only names ERP dispatch domains, plus the Odoo-only register', () => {
  const withRoles = ['companies', 'procurement', 'revenue', 'budget', 'timesheets', 'expenses', 'tasks', 'reference', 'equipment']
    .filter((domain) => moneyWriteRolesForDomain(domain).length > 0);
  for (const domain of withRoles) {
    assert(isErpDispatchDomain(domain) || ODOO_ONLY_DOMAINS.has(domain), `${domain} has writers but is neither an ERP dispatch domain nor a named Odoo-only one`);
  }
});
