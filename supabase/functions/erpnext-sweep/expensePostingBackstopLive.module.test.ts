// THEME-BACK-40 (#1643): the expense posting pass's live wiring, imported from its own module.
import { expenseOutboxHoldReason, reconcileOrgExpensePostingsLive } from './expensePostingBackstopLive.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test('ADR-0081 an ineligible outbox row is held with the reason that says what a person must check', () => {
  assert(expenseOutboxHoldReason('confirmed') === 'expense-posting-mirror-diverged', 'confirmed');
  assert(expenseOutboxHoldReason('held') === 'command-held', 'held');
  assert(expenseOutboxHoldReason('failed') === 'expense-posting-attempts-exhausted', 'failed');
});

Deno.test('BLOCK 9 an org that never employed expenses has nothing to post and reads nothing', async () => {
  const client = { from: () => { throw new Error('no read expected'); }, rpc: () => { throw new Error('no read expected'); } } as never;
  const org = { orgId: 'o', siteUrl: 'https://erp.example.com', secretRef: 's', company: 'C', config: {}, ownedDomains: ['budget'], versionMajor: 15 };
  const result = await reconcileOrgExpensePostingsLive(client, org);
  assert(result.driven === 0 && result.error === undefined, JSON.stringify(result));
});
