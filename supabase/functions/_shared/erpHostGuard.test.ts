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

Deno.test('host guard refuses when DNS resolution fails', async () => {
  Deno.resolveDns = (() => Promise.reject(new Error('dns unavailable'))) as typeof Deno.resolveDns;
  try {
    assertEquals(await isPrivateOrReservedHost('erp.example.com'), true);
  } finally {
    Deno.resolveDns = originalResolveDns;
  }
});
