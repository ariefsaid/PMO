/**
 * [Deno] Local ERPNext bench allowance on the SHIPPED host guard (#1318). The bench is a plain-http
 * Docker host, which the production rule refuses; a developer's served lane may reach it only when
 * the explicit flag is set, the function runs against a local Supabase, AND the site is one of the
 * listed bench origins. Every other case must keep today's refusal.
 *
 * Verify: cd supabase/functions/_shared && deno test erpHostGuard.localBench.test.ts --allow-env --allow-net --allow-read
 */
import { guardedErpFetch, isLocalBenchSite, isPermittedErpSiteUrl } from './erpHostGuard.ts';

function assertEquals(actual: unknown, expected: unknown, message = ''): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const ENV_KEYS = ['ERPNEXT_ALLOW_LOCAL_BENCH', 'ERPNEXT_LOCAL_BENCH_ORIGINS', 'SUPABASE_URL'] as const;
type EnvKey = typeof ENV_KEYS[number];

/** Run `fn` with exactly these env values (unset when absent), restoring the originals afterwards. */
async function withEnv(values: Partial<Record<EnvKey, string>>, fn: () => Promise<void>): Promise<void> {
  const saved = new Map(ENV_KEYS.map((key) => [key, Deno.env.get(key)]));
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

const originalResolveDns = Deno.resolveDns;
const BENCH = 'http://host.docker.internal:8080';
const LOCAL_SERVED = 'http://kong:8000';
const ENABLED = { ERPNEXT_ALLOW_LOCAL_BENCH: '1', SUPABASE_URL: LOCAL_SERVED } as const;

Deno.test('local bench: refused when the allowance flag is not set (production behaviour)', async () => {
  await withEnv({ SUPABASE_URL: LOCAL_SERVED }, async () => {
    assertEquals(await isPermittedErpSiteUrl(BENCH), false, BENCH);
    assertEquals(isLocalBenchSite(BENCH), false, 'isLocalBenchSite');
  });
  await withEnv({ ERPNEXT_ALLOW_LOCAL_BENCH: 'true', SUPABASE_URL: LOCAL_SERVED }, async () => {
    assertEquals(await isPermittedErpSiteUrl(BENCH), false, 'flag must be the literal 1');
  });
});

Deno.test('local bench: permitted with the flag, a local Supabase and a listed origin', async () => {
  for (const supabaseUrl of [LOCAL_SERVED, 'http://127.0.0.1:54321', 'http://localhost:54321', 'http://host.docker.internal:54321']) {
    await withEnv({ ERPNEXT_ALLOW_LOCAL_BENCH: '1', SUPABASE_URL: supabaseUrl }, async () => {
      assertEquals(await isPermittedErpSiteUrl(BENCH), true, `${BENCH} under ${supabaseUrl}`);
      assertEquals(await isPermittedErpSiteUrl('http://localhost:8080'), true, `localhost bench under ${supabaseUrl}`);
      assertEquals(await isPermittedErpSiteUrl(`${BENCH}/`), true, 'trailing slash is the same origin');
    });
  }
});

Deno.test('local bench: refused against a hosted Supabase even with the flag set', async () => {
  for (const supabaseUrl of ['https://abcdefghijklmnopqrst.supabase.co', 'https://kong.example.com', 'http://kong.example.com', 'https://kong:8000']) {
    await withEnv({ ERPNEXT_ALLOW_LOCAL_BENCH: '1', SUPABASE_URL: supabaseUrl }, async () => {
      assertEquals(await isPermittedErpSiteUrl(BENCH), false, `${BENCH} under ${supabaseUrl}`);
    });
  }
  await withEnv({ ERPNEXT_ALLOW_LOCAL_BENCH: '1' }, async () => {
    assertEquals(await isPermittedErpSiteUrl(BENCH), false, 'SUPABASE_URL unset');
  });
  await withEnv({ ERPNEXT_ALLOW_LOCAL_BENCH: '1', SUPABASE_URL: 'not a url' }, async () => {
    assertEquals(await isPermittedErpSiteUrl(BENCH), false, 'SUPABASE_URL unparsable');
  });
});

Deno.test('local bench: only the listed origins — other private hosts, ports and schemes stay refused', async () => {
  await withEnv(ENABLED, async () => {
    for (const site of [
      'http://169.254.169.254', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5', 'http://10.0.0.5:8080',
      'http://127.0.0.1:8080', 'http://host.docker.internal:8081', 'http://host.docker.internal',
      'https://host.docker.internal:8080', 'http://kong:8000', 'not a url',
    ]) {
      assertEquals(await isPermittedErpSiteUrl(site), false, site);
    }
  });
});

Deno.test('local bench: an explicit origin list replaces the default', async () => {
  await withEnv({ ...ENABLED, ERPNEXT_LOCAL_BENCH_ORIGINS: ' http://bench.local:9000 , not a url ' }, async () => {
    assertEquals(await isPermittedErpSiteUrl('http://bench.local:9000'), true, 'listed');
    assertEquals(await isPermittedErpSiteUrl(BENCH), false, 'default no longer listed');
  });
  await withEnv({ ...ENABLED, ERPNEXT_LOCAL_BENCH_ORIGINS: '' }, async () => {
    assertEquals(await isPermittedErpSiteUrl(BENCH), true, 'empty list falls back to the default');
  });
});

Deno.test('local bench: public https rule is unchanged while the allowance is on', async () => {
  await withEnv(ENABLED, async () => {
    try {
      Deno.resolveDns = (() => Promise.resolve(['8.8.8.8'])) as unknown as typeof Deno.resolveDns;
      assertEquals(await isPermittedErpSiteUrl('https://erp.example.com'), true, 'public https');
      assertEquals(await isPermittedErpSiteUrl('http://erp.example.com'), false, 'public http');
      Deno.resolveDns = (() => Promise.resolve(['10.1.2.3'])) as unknown as typeof Deno.resolveDns;
      assertEquals(await isPermittedErpSiteUrl('https://erp.example.com'), false, 'https resolving private');
    } finally {
      Deno.resolveDns = originalResolveDns;
    }
  });
});

Deno.test('local bench: guarded fetch reaches the bench but still refuses another origin', async () => {
  const originalFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    sent.push(String(input));
    return Promise.resolve(new Response('ok'));
  }) as typeof fetch;
  try {
    await withEnv(ENABLED, async () => {
      const guarded = guardedErpFetch(BENCH);
      await guarded(`${BENCH}/api/resource/Budget`);
      let refused = false;
      try { await guarded('http://10.0.0.5:8080/api/resource/Budget'); } catch { refused = true; }
      assertEquals(refused, true, 'cross-origin refused');
    });
    await withEnv({ ERPNEXT_ALLOW_LOCAL_BENCH: '1', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }, async () => {
      let refused = false;
      try { await guardedErpFetch(BENCH)(`${BENCH}/api/resource/Budget`); } catch { refused = true; }
      assertEquals(refused, true, 'hosted refuses the bench');
    });
    assertEquals(sent.length, 1, 'only the permitted bench request was sent');
    assertEquals(sent[0], `${BENCH}/api/resource/Budget`, 'sent url');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
