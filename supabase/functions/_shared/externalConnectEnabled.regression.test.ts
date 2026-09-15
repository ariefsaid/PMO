import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

Deno.test('AC-IEM-009: shipped inbound paths cannot reintroduce a hard-coded enabled resolver bypass', async () => {
  const sites = [
    'clickup-webhook-worker/index.ts',
    'erpnext-sweep/index.ts',
    'erpnext-webhook/index.ts',
  ];
  for (const site of sites) {
    const source = await Deno.readTextFile(new URL(`../${site}`, import.meta.url));
    assertEquals(source.includes('connectEnabled: true'), false, `${site} must pass the shared decision`);
  }
});

Deno.test('AC-IEM-009: shared decision is used by every existing flag consumer', async () => {
  // Every consumer must go through ONE shared decision — either by importing `externalConnectEnabled`
  // directly, or (the ERPNext sweep, since #651/ADR-0072) by importing the shared resolver
  // `_shared/erpAuthPair.ts`, whose module IS the kill-switch consumer. No consumer may hard-code the
  // decision; the sibling test above guards that with the `connectEnabled: true` sweep.
  for (const site of ['adapter-dispatch/index.ts', 'clickup-sweep/index.ts', 'clickup-webhook-worker/index.ts', 'erpnext-onboard/index.ts', 'erpnext-webhook/index.ts']) {
    const source = await Deno.readTextFile(new URL(`../${site}`, import.meta.url));
    assert(source.includes('externalConnectEnabled'), `${site} must use externalConnectEnabled`);
  }
  const sweep = await Deno.readTextFile(new URL('../erpnext-sweep/index.ts', import.meta.url));
  assert(
    sweep.includes('erpAuthPair') && !sweep.includes('connectEnabled: true'),
    'erpnext-sweep must route the kill-switch through the shared _shared/erpAuthPair resolver, never hard-code it',
  );
});
