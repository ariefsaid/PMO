import { isPrivateOrReservedHost } from './erpHostGuard.ts';

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
  for (const host of ['127.0.0.1', '10.1.2.3', '169.254.1.2', '100.64.1.2', '[::ffff:127.0.0.1]', '[fe80::1]', '[fc00::1]']) {
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

Deno.test('host guard falls back to hostname checks when resolver API is absent', async () => {
  (Deno as unknown as { resolveDns?: unknown }).resolveDns = undefined;
  try {
    assertEquals(await isPrivateOrReservedHost('public-host.example.com'), false);
    assertEquals(await isPrivateOrReservedHost('127.0.0.1'), true);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});

Deno.test('host guard falls back when DNS resolution is not supported', async () => {
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
