// THEME-BACK-40 (#1643): the timesheet backstop's live wiring, imported from its own module.
import { absentQueueBudget, reconcileOrgTimesheetPushesLive } from './timesheetBackstopLive.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test('THEME-BACK-06 a full mirror queue still leaves a quarter of the tick for approved sheets with no mirror row', () => {
  assert(absentQueueBudget(200, 0) === 200, 'an empty mirror queue gives absent sheets the whole limit');
  assert(absentQueueBudget(200, 180) === 50, 'the reserved floor wins over the leftover');
  assert(absentQueueBudget(200, 500) === 50, 'an overfull mirror queue cannot starve absent sheets');
});

Deno.test('BLOCK 9 an org that never assigned timesheets to ERPNext has nothing to reconcile and reads nothing', async () => {
  const client = { from: () => { throw new Error('no read expected'); }, rpc: () => { throw new Error('no read expected'); } } as never;
  const org = { orgId: 'o', siteUrl: 'https://erp.example.com', secretRef: 's', company: 'C', config: {}, ownedDomains: ['budget'], versionMajor: 15 };
  const result = await reconcileOrgTimesheetPushesLive(client, org);
  assert(result.driven === 0 && result.error === undefined, JSON.stringify(result));
});
