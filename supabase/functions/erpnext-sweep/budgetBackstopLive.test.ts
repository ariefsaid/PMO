// THEME-BACK-40 (#1643): the budget backstop's live wiring, imported from its own module.
import { budgetAccountIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import {
  BUDGET_ARCHIVE_CANCEL_HELD, BUDGET_ARCHIVE_CANCEL_SUPERSEDED, BUDGET_ARCHIVE_RESUME_ACTOR_UNAUTHORIZED, budgetBackstopDepsLive,
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

Deno.test('rm-1472 a parked unit names who must act: the cancellation, the activator, or nobody (superseded)', () => {
  const reasons = new Set([BUDGET_ARCHIVE_CANCEL_HELD, BUDGET_ARCHIVE_RESUME_ACTOR_UNAUTHORIZED, BUDGET_ARCHIVE_CANCEL_SUPERSEDED]);
  assert(reasons.size === 3, `the three reasons must stay distinct: ${[...reasons]}`);
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
