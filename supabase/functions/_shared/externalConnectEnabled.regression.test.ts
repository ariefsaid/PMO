import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

/** Every shipped (non-test) source of the ERPNext sweep: its entry point and the modules beside it. */
async function sweepSources(): Promise<Array<{ site: string; source: string }>> {
  const dir = new URL('../erpnext-sweep/', import.meta.url);
  const sites: Array<{ site: string; source: string }> = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    sites.push({ site: `erpnext-sweep/${entry.name}`, source: await Deno.readTextFile(new URL(entry.name, dir)) });
  }
  assert(sites.some(({ site }) => site === 'erpnext-sweep/index.ts'), 'the sweep entry point must be scanned');
  return sites;
}

Deno.test('AC-IEM-009: shipped inbound paths cannot reintroduce a hard-coded enabled resolver bypass', async () => {
  const sites = [
    'clickup-webhook-worker/index.ts',
    'erpnext-onboard/index.ts',
    'erpnext-sweep/index.ts',
    'erpnext-webhook/index.ts',
  ];
  for (const site of sites) {
    const source = await Deno.readTextFile(new URL(`../${site}`, import.meta.url));
    assertEquals(source.includes('connectEnabled: true'), false, `${site} must pass the shared decision`);
  }
  for (const { site, source } of await sweepSources()) {
    assertEquals(source.includes('connectEnabled: true'), false, `${site} must pass the shared decision`);
  }
});

Deno.test('AC-IEM-009: shared decision is used by every existing flag consumer', async () => {
  // Every consumer must go through ONE shared decision — either by importing `externalConnectEnabled`
  // directly, or (the ERPNext sweep since #651/ADR-0072; erpnext-onboard since #654) by importing the shared resolver
  // `_shared/erpAuthPair.ts`, whose module IS the kill-switch consumer. No consumer may hard-code the
  // decision; the sibling test above guards that with the `connectEnabled: true` sweep.
  for (const site of ['adapter-dispatch/index.ts', 'clickup-sweep/index.ts', 'clickup-webhook-worker/index.ts', 'erpnext-webhook/index.ts']) {
    const source = await Deno.readTextFile(new URL(`../${site}`, import.meta.url));
    assert(source.includes('externalConnectEnabled'), `${site} must use externalConnectEnabled`);
  }
  for (const site of ['erpnext-sweep/index.ts', 'erpnext-onboard/index.ts']) {
    const source = await Deno.readTextFile(new URL(`../${site}`, import.meta.url));
    assert(
      source.includes('erpAuthPair') && !source.includes('connectEnabled: true'),
      `${site} must route the kill-switch through the shared _shared/erpAuthPair resolver, never hard-code it`,
    );
  }
  const sweep = await sweepSources();
  assert(sweep.some(({ source }) => source.includes('erpAuthPair')), 'the sweep must route the kill-switch through _shared/erpAuthPair');
  for (const { site, source } of sweep) {
    assert(!source.includes('connectEnabled: true'), `${site} must never hard-code the kill-switch decision`);
  }
});
