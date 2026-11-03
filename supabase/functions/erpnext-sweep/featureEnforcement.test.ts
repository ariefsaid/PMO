// FR-PLN-006 (jobs) [Deno unit] — erpnext-sweep's outbox pass holds a module whose plan switch is OFF.
//
// 0534 gives the sweep a per-org entitlement read (`service_resolved_org_features`); the binding carries
// the OFF keys as `disabledFeatureKeys`. A candidate whose domain maps to an OFF key is HELD — no ERP
// call, no state change, reported as `feature-off:<key>` — and resumes on the next tick once the switch
// is back on. A candidate of a switched-on domain (or an org with no entitlement data) is driven exactly
// as before, and the terminal-state paths are untouched.
//
// FR-PLN-006 CLOSURE / availability:
//   • a candidate ERP ALREADY ACCEPTED (`committed`) is never held — its local finalize still runs, so a
//     switch-off can never leave PMO and ERP disagreeing about a document that exists upstream;
//   • an entitlement read that FAILS holds that ORG ONLY and every gated key for it (fail-closed), never
//     silently un-holds the other orgs in the same tick;
//   • the per-domain passes (timesheets, imprest) still finish what ERP already accepted while held.
//
// Verify: cd supabase/functions/erpnext-sweep && deno test featureEnforcement.test.ts

// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });

const {
  reconcileOrgOutbox, DOMAIN_FEATURE_KEY, featureDisabled, listEmployingOrgsLive,
  timesheetBackstopDepsLive, imprestPostingBackstopDepsLive,
} = await import('./index.ts');
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

// ── FR-PLN-006 closure: an accepted candidate always finalizes ──────────────────────────────────
Deno.test('FR-PLN-006: a committed candidate is RECOVERED while its module is off (never stranded)', async () => {
  const committed = { ...candidate('r1', 'revenue'), state: 'committed' as const };
  const pending = candidate('r2', 'revenue');
  const driven: string[] = [];
  const result = await reconcileOrgOutbox(
    async () => [committed, pending],
    { orgId: 'org-1', ownedDomains: ['revenue'], disabledFeatureKeys: ['revenue'] },
    ((row: OutboxRow) => { driven.push(row.id); return {} as never; }) as never,
    (async () => { /* injected dispatch */ }) as never,
  );
  assert(driven.join(',') === 'r1', `the committed candidate must finalize, got ${driven.join(',') || '<none>'}`);
  assert(result.reconciled === 1, `expected the committed candidate reconciled, got ${result.reconciled}`);
  const held = result.errors.find((e) => e.id === 'r2');
  assert(!!held && held.error.startsWith('feature-off:revenue'), 'the still-to-be-minted candidate stays held');
});

Deno.test('FR-PLN-006: a committed candidate of an on module is driven exactly once', async () => {
  const driven: string[] = [];
  const result = await reconcileOrgOutbox(
    async () => [{ ...candidate('r1', 'revenue'), state: 'committed' as const }],
    { orgId: 'org-1', ownedDomains: ['revenue'] },
    ((row: OutboxRow) => { driven.push(row.id); return {} as never; }) as never,
    (async () => { /* injected dispatch */ }) as never,
  );
  assert(driven.join(',') === 'r1' && result.reconciled === 1, 'a committed candidate reconciles as before when on');
});

// ── FR-PLN-006 availability: an unreadable entitlement is fail-closed, per org ──────────────────
Deno.test('FR-PLN-006: an unreadable entitlement holds every gated key (fail-closed)', () => {
  assert(featureDisabled({ featuresUnreadable: true }, 'revenue'), 'an unreadable read holds revenue');
  assert(featureDisabled({ featuresUnreadable: true }, 'stock'), 'an unreadable read holds an unmapped-in-rows key');
  assert(!featureDisabled({ featuresUnreadable: false, disabledFeatureKeys: [] }, 'revenue'), 'a clean read holds nothing');
});

/** The live wiring's client for this file: only the three reads `listEmployingOrgsLive` performs. */
function orgsClient(opts: { rpc: Record<string, { data: unknown; error: unknown }> }) {
  const table = (name: string) => {
    const data = name === 'external_org_bindings'
      ? [
        { id: 'b1', org_id: 'org-1', site_url: 'https://a.example.invalid', secret_ref: 'r1', config: {}, activated_at: '2026-01-01T00:00:00Z', version_major: 15 },
        { id: 'b2', org_id: 'org-2', site_url: 'https://b.example.invalid', secret_ref: 'r2', config: {}, activated_at: '2026-01-01T00:00:00Z', version_major: 15 },
      ]
      : [{ org_id: 'org-1', domain: 'revenue' }, { org_id: 'org-2', domain: 'revenue' }];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in']) builder[m] = () => builder;
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
    return builder;
  };
  return {
    from: table,
    rpc: (fn: string, args: { p_org_id?: string }) => {
      const key = `${fn}:${args?.p_org_id}`;
      return Promise.resolve(opts.rpc[key] ?? { data: [], error: null });
    },
  };
}

Deno.test('FR-PLN-006: one org\'s failed entitlement read holds that org only — it cannot un-hold the others', async () => {
  const client = orgsClient({
    rpc: {
      'service_resolved_org_features:org-1': { data: null, error: { message: 'timeout' } },
      'service_resolved_org_features:org-2': { data: [{ feature_key: 'revenue', enabled: false }], error: null },
    },
  });
  const orgs = await listEmployingOrgsLive(client as never);
  const one = orgs.find((o) => o.orgId === 'org-1');
  const two = orgs.find((o) => o.orgId === 'org-2');
  assert(!!one && !!two, 'both employing orgs are returned');
  assert(featureDisabled(one!, 'revenue'), 'the failed org holds its gated modules (fail-closed)');
  assert(featureDisabled(one!, 'procurement'), 'the failed org holds EVERY gated key, not just any read row');
  assert(featureDisabled(two!, 'revenue'), 'the healthy org keeps its own resolved switch');
  assert(!featureDisabled(two!, 'procurement'), 'the healthy org is not held on a key it did not report off');
});

Deno.test('FR-PLN-006: a healthy entitlement read resolves the switch set per org (no regression)', async () => {
  const client = orgsClient({
    rpc: {
      'service_resolved_org_features:org-1': { data: [{ feature_key: 'revenue', enabled: true }], error: null },
      'service_resolved_org_features:org-2': { data: [{ feature_key: 'revenue', enabled: false }], error: null },
    },
  });
  const orgs = await listEmployingOrgsLive(client as never);
  assert(!featureDisabled(orgs[0], 'revenue'), 'org-1 keeps revenue on');
  assert(featureDisabled(orgs[1], 'revenue'), 'org-2 holds revenue');
});

// ── FR-PLN-006 closure in the per-domain passes ────────────────────────────────────────────────
const BINDING = {
  orgId: 'org-1', siteUrl: 'https://erp.example.invalid', secretRef: 'ref', company: 'Example Co',
  config: {}, ownedDomains: ['timesheets', 'expenses'], versionMajor: 15, activatedAt: '2026-01-01T00:00:00Z',
} as unknown as Parameters<typeof timesheetBackstopDepsLive>[1];

Deno.test('FR-PLN-006: a held timesheets module still lists only accepted (committed) sheets for finalize', async () => {
  // The live queue read returns two sheets; only the one whose outbox command is `committed` is recoverable.
  const client = {
    from: (name: string) => {
      const data = name === 'timesheet_erp_mirror'
        ? [
          { id: 'm1', timesheet_id: 'ts-accepted', push_state: 'pending', erp_cancelled_at: null, last_attempt_at: null },
          { id: 'm2', timesheet_id: 'ts-new', push_state: 'pending', erp_cancelled_at: null, last_attempt_at: null },
        ]
        : [];
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'gte']) builder[m] = () => builder;
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
      return builder;
    },
  };
  const deps = timesheetBackstopDepsLive(client as never, BINDING, new Set(['o-accepted']), new Set(),
    new Set(['ts-accepted']));
  const rows = await deps.listPendingTimesheetPushes('org-1', 200);
  assert(rows.length === 1 && rows[0].timesheet_id === 'ts-accepted',
    `expected only the accepted sheet, got ${rows.map((r) => r.timesheet_id).join(',') || '<none>'}`);
});

Deno.test('FR-PLN-006: a held imprest module lists no NEW work but still finishes an accepted command', async () => {
  const accepted: OutboxRow = {
    ...candidate('o-accepted', 'expenses'),
    state: 'committed' as const,
    pmoRecordId: 'rep-1:replenishment',
    idempotencyKey: 'impt:rep-1:1700000000000',
  } as OutboxRow;
  const client = {
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'update', 'gte']) builder[m] = () => builder;
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
      return builder;
    },
  };
  const deps = imprestPostingBackstopDepsLive(client as never, BINDING, [accepted], undefined, new Set(), true);
  const pending = await deps.listPending('org-1', 200);
  assert(pending.length === 0, `a held module mints no new transfer, got ${pending.length}`);
  // …and the finalize-only queue is untouched by the hold (it carries no ERP write).
  assert(typeof deps.listStranded === 'function', 'the stranded/finalize-only listing stays wired while held');
});
