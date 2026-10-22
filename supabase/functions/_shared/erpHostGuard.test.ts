import { guardedErpFetch, isPrivateOrReservedHost } from './erpHostGuard.ts';

function assertEquals(actual: unknown, expected: unknown, message = ''): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const originalResolveDns = Deno.resolveDns;

function mockDns(records: { A?: string[]; AAAA?: string[] }) {
  Deno.resolveDns = ((hostname: string, recordType: string) => {
    const answer = records[recordType as 'A' | 'AAAA'];
    if (!answer) throw new Deno.errors.NotFound('no records');
    return Promise.resolve(answer);
  }) as typeof Deno.resolveDns;
}

Deno.test('host guard rejects private and special literal ranges', async () => {
  for (const host of ['127.0.0.1', '10.1.2.3', '169.254.1.2', '100.64.1.2', '198.18.0.1', '192.0.0.9', '[::ffff:127.0.0.1]', '[::7f00:1]', '[64:ff9b::a00:1]', '[2002:0a00:0001::1]', '[fe80::1]', '[fc00::1]', '[fec0::1]']) {
    assertEquals(await isPrivateOrReservedHost(host), true, host);
  }
});

Deno.test('host guard rejects a hostname if any DNS answer is private', async () => {
  mockDns({ A: ['203.0.113.10', '10.1.2.3'], AAAA: ['2001:4860:4860::8888'] });
  try {
    assertEquals(await isPrivateOrReservedHost('erp.example.com'), true);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('host guard accepts a hostname with public A and AAAA answers', async () => {
  mockDns({ A: ['8.8.8.8'], AAAA: ['2001:4860:4860::8888'] });
  try {
    assertEquals(await isPrivateOrReservedHost('pmo.8.8.8.8.sslip.io'), false);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('host guard accepts an IPv6-only hostname when A has no records', async () => {
  Deno.resolveDns = ((_hostname: string, recordType: string) => {
    if (recordType === 'A') return Promise.reject(new Deno.errors.NotFound('no A records'));
    return Promise.resolve(['2001:4860:4860::8888']);
  }) as typeof Deno.resolveDns;
  try {
    assertEquals(await isPrivateOrReservedHost('ipv6-only.example.com'), false);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('host guard refuses when both DNS record types are absent', async () => {
  Deno.resolveDns = (() => Promise.reject(new Deno.errors.NotFound('no records'))) as typeof Deno.resolveDns;
  try {
    assertEquals(await isPrivateOrReservedHost('no-address.example.com'), true);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('host guard refuses a private AAAA answer when A has no records', async () => {
  Deno.resolveDns = ((_hostname: string, recordType: string) => {
    if (recordType === 'A') return Promise.reject(new Deno.errors.NotFound('no A records'));
    return Promise.resolve(['fc00::1']);
  }) as typeof Deno.resolveDns;
  try {
    assertEquals(await isPrivateOrReservedHost('private-v6.example.com'), true);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('host guard refuses a non-NotFound A lookup error', async () => {
  Deno.resolveDns = ((_hostname: string, recordType: string) => {
    if (recordType === 'A') return Promise.reject(new Error('dns unavailable'));
    return Promise.resolve(['2001:4860:4860::8888']);
  }) as typeof Deno.resolveDns;
  try {
    assertEquals(await isPrivateOrReservedHost('resolver-error.example.com'), true);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('host guard allows hostname-text fallback when resolver API is absent', async () => {
  (Deno as unknown as { resolveDns?: unknown }).resolveDns = undefined;
  try {
    assertEquals(await isPrivateOrReservedHost('public-host.example.com'), false);
    assertEquals(await isPrivateOrReservedHost('127.0.0.1'), true);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('host guard allows hostname-text fallback when DNS resolution is not supported', async () => {
  Deno.resolveDns = (() => Promise.reject(new DOMException('unsupported', 'NotSupported'))) as typeof Deno.resolveDns;
  try {
    assertEquals(await isPrivateOrReservedHost('public-host.example.com'), false);
    assertEquals(await isPrivateOrReservedHost('10.0.0.1'), true);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('host guard refuses when DNS resolution fails', async () => {
  Deno.resolveDns = (() => Promise.reject(new Error('dns unavailable'))) as typeof Deno.resolveDns;
  try {
    assertEquals(await isPrivateOrReservedHost('erp.example.com'), true);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('host guard refuses promptly when DNS lookup is aborted', async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  Deno.resolveDns = ((_host: string, _type: 'A' | 'AAAA', options?: { signal?: AbortSignal }) => {
    observedSignal = options?.signal;
    return new Promise<string[]>((_resolve, reject) => {
      observedSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  }) as typeof Deno.resolveDns;
  const checking = isPrivateOrReservedHost('public-host.example.com', controller.signal);
  controller.abort();
  try {
    assertEquals(await checking, true);
    assertEquals(observedSignal, controller.signal);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('guarded ERP fetch permits the configured origin and refuses another origin', async () => {
  const originalFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = (() => { sent++; return Promise.resolve(new Response('ok')); }) as typeof fetch;
  Deno.resolveDns = (() => Promise.resolve(['8.8.8.8'])) as unknown as typeof Deno.resolveDns;
  try {
    const guarded = guardedErpFetch('https://erp.example.com');
    await guarded('https://erp.example.com/api/resource/Doc');
    let refused = false;
    try { await guarded('https://other.example.com/api/resource/Doc'); } catch { refused = true; }
    assertEquals(refused, true);
    assertEquals(sent, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.resolveDns = originalResolveDns;
  }
});
