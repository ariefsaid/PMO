// THEME-BACK-40 (#1643): the budget backstop's live wiring, imported from its own module.
import { budgetAccountIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import {
  BUDGET_ARCHIVE_CANCEL_HELD, BUDGET_ARCHIVE_RESUME_ACTOR_UNAUTHORIZED, budgetArchiveWaitResumeLive, budgetBackstopDepsLive,
  reconcileOrgBudgetPushesLive,
} from './budgetBackstopLive.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const ORG = { orgId: 'o', siteUrl: 'https://erp.example.com', secretRef: 's', company: 'C', config: {}, ownedDomains: ['budget'], versionMajor: 16 };

Deno.test('AC-BUD-023 a binding that was never activated has no budget queue: the pass reads nothing and drives nothing', async () => {
  const client = { from: () => { throw new Error('no read expected'); }, rpc: () => { throw new Error('no read expected'); } } as never;
  const result = await reconcileOrgBudgetPushesLive(client, { ...ORG, activatedAt: null });
  assert(result.driven === 0 && result.error === undefined, JSON.stringify(result));
});

/** Both mirror tables, read as thenable query chains; `accountRows` is what the account-grain mirror holds. */
function mirrorClient(accountRows: Array<Record<string, unknown>>) {
  return {
    from(table: string) {
      const data = table === 'budget_version_account_erp_mirror' ? accountRows : [];
      // deno-lint-ignore no-explicit-any
      const q: any = { select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q,
        then: (resolve: (v: unknown) => unknown) => resolve({ data, error: null }) };
      return q;
    },
  } as never;
}

const VERSION = '22222222-2222-4222-8222-222222222222';

Deno.test('MEDIUM-2 an outbox-only orphan is queued under its bare version, year and account unless that exact unit is mirrored', async () => {
  const identity = budgetAccountIdentity(VERSION, 'FY 2027', 'Travel - C');
  const orphan = [{ id: 'outbox-1', pmo_record_id: identity }];
  const queued = await budgetBackstopDepsLive(mirrorClient([]), ORG, orphan).listPendingBudgetPushes('o', 50);
  assert(queued.length === 1 && queued[0].budget_version_id === VERSION && queued[0].fiscal_year === 'FY 2027' && queued[0].erp_account === 'Travel - C', JSON.stringify(queued));
  const mirrored = [{ id: 'm1', budget_version_id: VERSION, push_state: 'failed', erp_cancelled_at: null, fiscal_year: 'FY 2027', to_fiscal_year: null, erp_account: 'Travel - C', budget_intent: 'ensure' }];
  const deduped = await budgetBackstopDepsLive(mirrorClient(mirrored), ORG, orphan).listPendingBudgetPushes('o', 50);
  assert(deduped.length === 1 && deduped[0].id === 'm1', `the mirror row wins: ${JSON.stringify(deduped)}`);
});

/** A recording stand-in for the resume path: reads answer from `tables`, every `update` is recorded with its table,
 *  and `rpc` answers from `rpcs` (unknown RPCs fail, which the authorization check treats as a refusal). */
function resumeClient(tables: Record<string, unknown[]>, rpcs: Record<string, unknown> = {}) {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const q: any = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [], error: null });
          if (prop === 'update') return (patch: Record<string, unknown>) => { updates.push({ table, patch }); return q; };
          if (prop === 'insert') return () => q;
          return () => q;
        },
      });
      return q;
    },
    rpc: (fn: string) => Promise.resolve(fn in rpcs ? { data: rpcs[fn], error: null } : { data: null, error: { message: 'unknown rpc', code: 'X' } }),
  } as never;
  return { client, updates };
}

const PARKED = (reason: string) => ({ table: 'budget_version_account_erp_mirror', patch: { push_state: 'held', push_error: reason } });
const RESUME_ORG = { ...ORG, activatedAt: '2026-01-01T00:00:00Z' };
const ACTIVATED_AT = '2026-03-01T00:00:00Z';

Deno.test('rm-1472 a held cancellation parks the waiting units under the cancellation reason and pushes nothing', async () => {
  const { client, updates } = resumeClient({ budget_archive_cancel_intents: [{ id: 'i1', state: 'held' }] });
  const outcome = await budgetArchiveWaitResumeLive(client, RESUME_ORG)(VERSION, 'project-1', ACTIVATED_AT);
  assert(outcome === 'held', outcome);
  assert(JSON.stringify(updates) === JSON.stringify([PARKED(BUDGET_ARCHIVE_CANCEL_HELD)]), JSON.stringify(updates));
});

Deno.test('rm-1472/I-1 a settled cancellation with no recorded activator parks the units under the cancellation reason', async () => {
  const { client, updates } = resumeClient({ budget_archive_cancel_intents: [], budget_archive_requests: [] });
  const outcome = await budgetArchiveWaitResumeLive(client, RESUME_ORG)(VERSION, 'project-1', ACTIVATED_AT);
  assert(outcome === 'held', outcome);
  assert(JSON.stringify(updates) === JSON.stringify([PARKED(BUDGET_ARCHIVE_CANCEL_HELD)]), JSON.stringify(updates));
});

Deno.test('rm-1472/M-2 an activator who may no longer push parks the units under their OWN reason', async () => {
  const { client, updates } = resumeClient({ budget_archive_cancel_intents: [], budget_archive_requests: [{ id: 'r1', requested_by: 'user-1' }] });
  const outcome = await budgetArchiveWaitResumeLive(client, RESUME_ORG)(VERSION, 'project-1', ACTIVATED_AT);
  assert(outcome === 'held', outcome);
  assert(JSON.stringify(updates) === JSON.stringify([PARKED(BUDGET_ARCHIVE_RESUME_ACTOR_UNAUTHORIZED)]), JSON.stringify(updates));
});

Deno.test('rm-1472 an unsettled cancellation keeps the units waiting and writes nothing', async () => {
  const { client, updates } = resumeClient({ budget_archive_cancel_intents: [{ id: 'i1', state: 'issued' }] });
  const outcome = await budgetArchiveWaitResumeLive(client, RESUME_ORG)(VERSION, 'project-1', ACTIVATED_AT);
  assert(outcome === 'waiting' && updates.length === 0, `${outcome} ${JSON.stringify(updates)}`);
});

/** A recording client for the whole live pass: `outbox_reconcile_candidates` answers `candidates`, every
 *  mirror/archive queue is empty, and each `budget_versions` read (the per-queued-row re-read) is recorded
 *  by the version id it asked for. A version that does not exist skips the row, so nothing is driven. */
function candidatePassClient(candidates: Array<Record<string, unknown>>) {
  const versionReads: string[] = [];
  const client = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const q: any = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
          if (prop === 'maybeSingle') return () => Promise.resolve({ data: null, error: null });
          if (prop === 'eq') return (column: string, value: unknown) => {
            if (table === 'budget_versions' && column === 'id') versionReads.push(String(value));
            return q;
          };
          return () => q;
        },
      });
      return q;
    },
    rpc: (fn: string) => Promise.resolve({
      data: fn === 'outbox_reconcile_candidates' ? candidates : [],
      error: null,
    }),
  } as never;
  return { client, versionReads };
}

Deno.test('H-1 the budget pass queues EVERY budget-domain candidate the RPC admits (any state or attempt count) and nothing else', async () => {
  const v = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
  const row = (n: number, state: string, attempts: number, domain = 'budget') => ({
    id: `outbox-${n}`, domain, pmo_record_id: budgetAccountIdentity(v(n), 'FY 2027', 'Travel - C'),
    idempotency_key: `k${n}`, state, attempt_count: attempts,
  });
  const { client, versionReads } = candidatePassClient([
    row(1, 'pending', 0), row(2, 'failed', 4), row(3, 'quarantined', 9), row(4, 'committing', 1),
    row(5, 'pending', 0, 'timesheets'),
  ]);
  const result = await reconcileOrgBudgetPushesLive(client, { ...ORG, activatedAt: '2026-01-01T00:00:00Z' });
  assert(result.error === undefined, JSON.stringify(result));
  assert(
    JSON.stringify([...versionReads].sort()) === JSON.stringify([v(1), v(2), v(3), v(4)]),
    `every budget candidate (and no other domain's) must be queued: ${JSON.stringify(versionReads)}`,
  );
});
