// THEME-BACK-40 (#1643): the modified-poll doctype walk, imported from its own module.
import { inFlightAnchorFilter, sweepOrgDoctypesLive, sweepWatermarkDomain } from './doctypePoll.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test('AC-EXP-122 two kinds sharing a domain and doctype get their own cursors; a kind alone keeps its shipped key', () => {
  assert(sweepWatermarkDomain('expense-payment') === 'expenses::Payment Entry::expense-payment', sweepWatermarkDomain('expense-payment'));
  assert(sweepWatermarkDomain('expense-receipt') === 'expenses::Payment Entry::expense-receipt', sweepWatermarkDomain('expense-receipt'));
  assert(sweepWatermarkDomain('sales-invoice') === 'revenue::Sales Invoice', sweepWatermarkDomain('sales-invoice'));
});

Deno.test('BLOCK 1 the poll skips a document whose anchor an in-flight outbox row claims, after the base filter', async () => {
  const probed: string[] = [];
  const probe = (anchor: string) => { probed.push(anchor); return Promise.resolve(anchor === 'claimed'); };
  const filter = inFlightAnchorFilter('sales-invoice', probe, (row) => row.company === 'C')!;
  assert(await filter({ company: 'C', remarks: 'free' }), 'an unclaimed anchor is polled');
  assert(!(await filter({ company: 'C', remarks: 'claimed' })), 'a claimed anchor is skipped');
  assert(!(await filter({ company: 'OTHER', remarks: 'free' })), 'the base filter still rejects');
  assert(probed.join() === 'free,claimed', `a base-rejected row costs no outbox read: ${probed}`);
});

Deno.test('FR-PLN-006 the global sync switch holds the walk without touching ERP or any cursor', async () => {
  const client = { from: () => { throw new Error('no read expected'); }, rpc: () => { throw new Error('no read expected'); } } as never;
  const org = { orgId: 'o', siteUrl: 'https://erp.example.com', secretRef: 's', company: 'C', config: {}, ownedDomains: ['revenue'], versionMajor: 15, disabledFeatureKeys: ['erp_sync'] };
  const result = await sweepOrgDoctypesLive(client, org);
  assert(result.error === 'feature-off:erp_sync' && result.applied === 0 && result.complete, JSON.stringify(result));
});
