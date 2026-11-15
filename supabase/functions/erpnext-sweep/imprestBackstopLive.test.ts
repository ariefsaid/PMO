// THEME-BACK-40 (#1643): the site float transfer pass's live wiring, imported from its own module.
import { imprestPostingBackstopDepsLive, reconcileOrgImprestPostingsLive } from './imprestBackstopLive.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const ORG = { orgId: 'o', siteUrl: 'https://erp.example.com', secretRef: 's', company: 'C', config: {}, versionMajor: 15 };

/** Every read answers empty: no outbox candidates, no retry-pending rows, no transfer intents. */
function emptyClient() {
  // deno-lint-ignore no-explicit-any
  const q: any = new Proxy({}, { get: (_t, prop) => prop === 'then' ? (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }) : () => q });
  return { from: () => q, rpc: () => Promise.resolve({ data: [], error: null }) } as never;
}

Deno.test('BLOCK 9 an org that never employed expenses has no float transfers to post and reads nothing', async () => {
  const client = { from: () => { throw new Error('no read expected'); }, rpc: () => { throw new Error('no read expected'); } } as never;
  const result = await reconcileOrgImprestPostingsLive(client, { ...ORG, ownedDomains: ['budget'] });
  assert(result.driven === 0 && result.error === undefined, JSON.stringify(result));
});

Deno.test('FR-PLN-006 a switched-off imprest module is reported held, never silently skipped', async () => {
  const held = await reconcileOrgImprestPostingsLive(emptyClient(), { ...ORG, ownedDomains: ['expenses'], disabledFeatureKeys: ['imprest'] });
  assert(held.driven === 0 && held.error === 'feature-off:imprest', JSON.stringify(held));
  const on = await reconcileOrgImprestPostingsLive(emptyClient(), { ...ORG, ownedDomains: ['expenses'] });
  assert(on.driven === 0 && on.error === undefined, JSON.stringify(on));
});

Deno.test('FR-PLN-006 a held module lists no new transfer as work and never reads the queue', async () => {
  const client = { from: () => { throw new Error('no read expected'); }, rpc: () => { throw new Error('no read expected'); } } as never;
  const deps = imprestPostingBackstopDepsLive(client, { ...ORG, ownedDomains: ['expenses'] }, [], undefined, new Set(), true);
  const pending = await deps.listPending('o', 50);
  assert(pending.length === 0, JSON.stringify(pending));
});
