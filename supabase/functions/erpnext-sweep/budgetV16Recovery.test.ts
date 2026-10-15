(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { moneyWriteReadModelContext, buildReconcileDepsLive } = await import('./index.ts');
import { budgetAccountIdentity, budgetAccountPushKey } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { encodeFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }

const ORG = '00000000-0000-4000-8000-0000000000aa';
const VERSION = '0b3e3333-0000-4000-8000-000000000001';
const PROJECT = '0b3e3333-0000-4000-8000-000000000002';
const ACTOR = '0b3e3333-0000-4000-8000-000000000003';
const FY = '2026';
const ACTIVATED = '2026-01-01T00:00:00.000Z';
const SALARY = '5100 - Salary - Co';
const COGS = '5200 - COGS - Co';
Deno.env.set('SWEEP_BENCH_KEY', 'test-key');
Deno.env.set('SWEEP_BENCH_SECRET', 'test-secret');
const ORG_BINDING = {
  orgId: ORG, siteUrl: 'https://erp.sweep.test', secretRef: 'sweep-bench', company: 'Co',
  config: { company: 'Co', project_map: { [PROJECT]: 'ERP-PROJ-1' } }, ownedDomains: ['budget'], versionMajor: 16,
};

function recoveryWorld(args: { account?: string; mapAccount?: string; activatedAt?: string; intent?: 'ensure' | 'remove'; predecessor?: string | null; removeDesired?: boolean }) {
  const account = args.account ?? SALARY;
  const identity = budgetAccountIdentity(VERSION, FY, account);
  const payload = {
    id: VERSION, erp_doc_kind: 'budget', projectId: PROJECT, fiscal_year: FY,
    outbox_identity: identity, erp_account: account, budget_intent: args.intent ?? 'ensure',
    budget_predecessor: args.predecessor ?? null, activated_at: ACTIVATED,
    line_items: args.removeDesired === false ? [] : [{ category: 'Labor', budgeted_amount: '90000.00', fiscal_year: FY }],
  };
  const outbox = {
    id: 'outbox-v16', domain: 'budget', pmoRecordId: identity,
    idempotencyKey: budgetAccountPushKey(identity, ACTIVATED), state: 'pending', externalRecordId: null,
    canonical: null, claimGeneration: 0, payloadDigest: null,
  };
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select: () => q,
        eq: (key: string, value: unknown) => { filters[key] = value; return q; },
        is: () => q, in: () => q, not: () => q, gt: () => q, order: () => q, limit: () => q,
        maybeSingle: () => {
          if (table === 'external_command_outbox') return Promise.resolve({ data: { operation: 'create', payload, actor_user_id: ACTOR }, error: null });
          if (table === 'budget_versions') return Promise.resolve({ data: { id: VERSION, org_id: ORG, project_id: PROJECT, status: 'Active', activated_at: args.activatedAt ?? ACTIVATED }, error: null });
          if (table === 'projects') return Promise.resolve({ data: { id: PROJECT, org_id: ORG, start_date: '2026-02-01', end_date: '2026-11-30' }, error: null });
          if (table === 'budget_version_account_erp_mirror') return Promise.resolve({ data: args.predecessor ? { budget_version_id: VERSION, erp_budget_name: args.predecessor } : null, error: null });
          if (table === 'external_refs') return Promise.resolve({ data: args.predecessor ? { external_record_id: args.predecessor } : null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
          const rows = table === 'budget_line_items'
            ? (args.removeDesired === false ? [] : [{ id: 'li', category: 'Labor', budgeted_amount: '90000.00', fiscal_year: FY }])
            : table === 'budget_category_account_map'
              ? [{ category: 'Labor', erp_account: args.mapAccount ?? SALARY }]
              : [];
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return q;
    },
    rpc: (fn: string) => Promise.resolve({ data: fn === 'actor_authorization_state' ? { role: 'Admin', active: true } : true, error: null }),
  } as unknown as SupabaseClient;
  return { client, payload, outbox };
}

async function runRecovery(args: Parameters<typeof recoveryWorld>[0]) {
  const { client, outbox } = recoveryWorld(args);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ name: FY, year_start_date: '2026-01-01', year_end_date: '2026-12-31' }] }), { status: 200 }))) as typeof fetch;
  try { return await buildReconcileDepsLive(client, ORG_BINDING as never, outbox as never); }
  finally { globalThis.fetch = originalFetch; }
}

Deno.test('AC-BV16-004 recovery holds an ensure whose frozen account is no longer desired', async () => {
  let failure: unknown;
  try { await runRecovery({ account: SALARY, mapAccount: COGS }); } catch (error) { failure = error; }
  assert((failure as { code?: string })?.code === 'budget-sweep-gate-held', 'map edits must hold a frozen Salary ensure instead of reissuing it as COGS');
});

Deno.test('AC-BV16-004 recovery refuses a missing account identity', async () => {
  const { client, outbox } = recoveryWorld({});
  const { buildReconcileDepsLive: build } = await import('./index.ts');
  const malformed = { ...outbox, pmoRecordId: `${VERSION}:${encodeFiscalYear(FY)}` };
  let failure: unknown;
  try { await build(client, ORG_BINDING as never, malformed as never); } catch (error) { failure = error; }
  assert((failure as { code?: string })?.code === 'budget-sweep-gate-held', 'legacy identity cannot pass the v16 account recovery gate');
});

Deno.test('AC-BV16-004 equivalent activation timestamp spellings retain the same account key', () => {
  const identity = budgetAccountIdentity(VERSION, FY, SALARY);
  const canonical = budgetAccountPushKey(identity, ACTIVATED);
  const alternate = budgetAccountPushKey(identity, '2026-01-01 00:00:00+00');
  assert(canonical === alternate, 'sweep key derivation normalizes timestamp spellings through the shared epoch helper');
});

Deno.test('AC-BV16-004 a newer activation cannot recover an old account intent', async () => {
  let failure: unknown;
  try { await runRecovery({ activatedAt: '2026-02-01T00:00:00Z' }); } catch (error) { failure = error; }
  assert((failure as { code?: string })?.code === 'budget-sweep-gate-held', 'new activation is a different command epoch');
});

Deno.test('AC-BV16-005 remove recovery requires the account to remain absent and a predecessor witness', async () => {
  let failure: unknown;
  try { await runRecovery({ intent: 'remove', predecessor: null, removeDesired: false }); } catch (error) { failure = error; }
  assert((failure as { code?: string })?.code === 'budget-sweep-gate-held', 'remove without same-org project/year/account predecessor witness is held');
});

Deno.test('AC-BV16-005 an in-span remove-only year can recover when the account remains absent and witnessed', async () => {
  let failure: unknown;
  try { await runRecovery({ intent: 'remove', predecessor: 'ERP-BUDGET-OLD', removeDesired: false }); } catch (error) { failure = error; }
  assert((failure as { code?: string })?.code !== 'budget-sweep-gate-held', `valid in-span remove-only intent must pass the gate: ${String((failure as Error)?.message)}`);
});

Deno.test('AC-BV16-004 replay recovery marks the account writer as replay without changing fresh writes', () => {
  const replay = moneyWriteReadModelContext({ orgId: 'org', actorUserId: 'actor', isReplay: true });
  assert(replay.isReplay === true, 'stored outbox payload recovery must preserve replay status for the account mirror writer');
  assert(replay.callerUserId === 'actor' && replay.orgId === 'org', 'replay context must retain org and recorded actor');
  const fresh = moneyWriteReadModelContext({ orgId: 'org', actorUserId: null });
  assert(fresh.isReplay === false && fresh.callerUserId === undefined, 'fresh successful push remains eligible to clear its own tombstone');
});
