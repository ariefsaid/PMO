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
  const sites = [
    'adapter-dispatch/index.ts',
    'clickup-sweep/index.ts',
    'clickup-webhook-worker/index.ts',
    'erpnext-onboard/index.ts',
    'erpnext-sweep/index.ts',
    'erpnext-webhook/index.ts',
  ];
  for (const site of sites) {
    const source = await Deno.readTextFile(new URL(`../${site}`, import.meta.url));
    assert(source.includes('externalConnectEnabled'), `${site} must use externalConnectEnabled`);
  }
});
