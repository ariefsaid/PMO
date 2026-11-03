// FR-PLN-006 (jobs) [Deno unit] — erpnext-sweep's outbox pass holds a module whose plan switch is OFF.
//
// 0534 gives the sweep a per-org entitlement read (`service_resolved_org_features`); the binding carries
// the OFF keys as `disabledFeatureKeys`. A candidate whose domain maps to an OFF key is HELD — no ERP
// call, no state change, reported as `feature-off:<key>` — and resumes on the next tick once the switch
// is back on. A candidate of a switched-on domain (or an org with no entitlement data) is driven exactly
// as before, and the terminal-state paths are untouched.
//
// Verify: cd supabase/functions/erpnext-sweep && deno test featureEnforcement.test.ts

// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });

const { reconcileOrgOutbox, DOMAIN_FEATURE_KEY, featureDisabled } = await import('./index.ts');
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function candidate(id: string, domain: string): OutboxRow {
  return {
    id,
    domain,
    pmoRecordId: `pmo-${id}`,
    idempotencyKey: `key-${id}`,
    state: 'pending',
    externalRecordId: null,
    canonical: { id: `pmo-${id}` },
    claimGeneration: 1,
    payloadDigest: null,
  } as OutboxRow;
}

type Harness = { org: { orgId: string; ownedDomains: string[]; disabledFeatureKeys?: string[] }; driven: string[] };

function harness(disabled?: string[]): Harness {
  return {
    org: {
      orgId: 'org-1',
      ownedDomains: ['procurement', 'revenue', 'companies'],
      ...(disabled ? { disabledFeatureKeys: disabled } : {}),
    },
    driven: [],
  };
}

async function run(h: Harness) {
  const candidates = [candidate('p1', 'procurement'), candidate('r1', 'revenue'), candidate('c1', 'companies')];
  return await reconcileOrgOutbox(
    async () => candidates,
    h.org,
    ((row: OutboxRow) => { h.driven.push(row.id); return {} as never; }) as never,
    (async () => { /* the injected dispatch: recorded via buildDeps */ }) as never,
  );
}

Deno.test('FR-PLN-006: a switched-off revenue module holds its outbox candidates and drives the rest', async () => {
  const h = harness(['revenue']);
  const result = await run(h);
  assert(result.reconciled === 2, `expected 2 driven candidates, got ${result.reconciled}`);
  assert(h.driven.join(',') === 'p1,c1', `expected p1,c1 driven, got ${h.driven.join(',')}`);
  const held = result.errors.find((e) => e.id === 'r1');
  assert(!!held, 'the held revenue candidate is reported (never dropped silently)');
  assert(held!.error.startsWith('feature-off:revenue'), `expected a feature-off hold, got ${held!.error}`);
});

Deno.test('FR-PLN-006: the CRM master feed holds on a switched-off crm module', async () => {
  const h = harness(['crm']);
  const result = await run(h);
  assert(h.driven.join(',') === 'p1,r1', `expected p1,r1 driven, got ${h.driven.join(',')}`);
  const held = result.errors.find((e) => e.id === 'c1');
  assert(!!held && held.error.startsWith('feature-off:crm'), 'the companies candidate is held on crm');
});

Deno.test('FR-PLN-006/FR-PLN-007: re-enabling the module resumes the same candidate', async () => {
  const h = harness([]);
  const result = await run(h);
  assert(result.reconciled === 3, `a switched-on org drives every candidate, got ${result.reconciled}`);
  assert(h.driven.join(',') === 'p1,r1,c1', `expected all three driven, got ${h.driven.join(',')}`);
  assert(result.errors.length === 0, 'no hold is reported while the modules are on');
});

Deno.test('FR-PLN-006: legacy fixtures with no entitlement data are unchanged (nothing held)', async () => {
  const h = harness(undefined);
  const result = await run(h);
  assert(result.reconciled === 3, 'an org with no disabledFeatureKeys drives every candidate');
});

Deno.test('the domain → switch mapping covers the gated ERP domains only', () => {
  assert(DOMAIN_FEATURE_KEY.procurement === 'procurement', 'procurement maps to its own key');
  assert(DOMAIN_FEATURE_KEY.revenue === 'revenue', 'revenue maps to its own key');
  assert(DOMAIN_FEATURE_KEY.companies === 'crm', 'the companies domain is the CRM feed');
  assert(featureDisabled({ disabledFeatureKeys: ['stock'] }, 'stock'), 'featureDisabled reads the set');
  assert(!featureDisabled({}, 'stock'), 'an absent set holds nothing');
});
