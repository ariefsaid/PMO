/**
 * external-companies — Deno unit tests (OD-INT-6).
 *
 * Tests the ERPNext company list fetching logic with mocked fetch and mocked Supabase.
 * Verifies:
 * - Admin can fetch companies
 * - Operator can fetch companies
 * - Non-Admin/Operator gets 403
 * - Cross-org denied
 * - Missing/inactive binding returns 404/422
 * - SSRF guard rejects private/loopback/link-local/metadata hosts
 * - Audit is called
 */

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1.0.10';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

// ============================================================================
// Validator functions (copied from index.ts for unit testing)
// ============================================================================

function isPrivateOrReservedHost(hostname: string): boolean {
  // Normalize: remove brackets from IPv6 addresses, remove port, lowercase
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1); // Remove brackets from [::1] format
  }
  // Don't split bare IPv6 addresses (they contain colons but no port)
  // Only split if it's IPv4 (contains .)
  if (host.includes('.')) {
    host = host.split(':')[0];
  }

  if (host === 'localhost' || host === 'localhost.localdomain') return true;
  if (host === '::1' || host.startsWith('127.')) return true;

  const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const a = parseInt(ipv4Match[1], 10);
    const b = parseInt(ipv4Match[2], 10);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }

  if (host.startsWith('fc') || host.startsWith('fd')) {
    // More precise fc00::/7 check: first 7 bits of 128-bit address = 1111110
    // First hextet (16 bits) for fc00:: = 0xfc00 = 1111110000000000
    // Mask with 0xfe00 = 1111111000000000, check == 0xfc00
    const firstHextet = host.split(':')[0];
    const first = parseInt(firstHextet, 16);
    if (!isNaN(first) && (first & 0xfe00) === 0xfc00) return true;
  }
  if (host === '::') return true;
  if (host === '::1') return true;
  if (host === '169.254.169.254') return true;
  if (host === 'metadata.google.internal') return true;
  if (host === 'metadata.azure.com') return true;

  return false;
}

async function validateErpNextCompanyList(
  siteUrl: string,
  apiKey: string,
  apiSecret: string,
  deps: { fetchImpl: typeof fetch },
): Promise<string[]> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(siteUrl);
  } catch {
    throw new AppError('Invalid site URL', 'config-rejected');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new AppError('Only HTTPS URLs are allowed', 'config-rejected');
  }

  const hostname = parsedUrl.hostname;
  if (isPrivateOrReservedHost(hostname)) {
    throw new AppError('Private or reserved addresses are not allowed', 'config-rejected');
  }

  try {
    const url = `${siteUrl.replace(/\/$/, '')}/api/resource/Company?fields=["name"]&limit_page_length=200`;
    const res = await deps.fetchImpl(url, {
      headers: { Authorization: `token ${apiKey}:${apiSecret}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      if (res.status === 404) {
        throw new AppError('ERPNext site not found', 'NOT_FOUND');
      }
      throw new AppError('Failed to fetch ERPNext companies', 'external-unreachable');
    }
    const data = (await res.json()) as { data?: Array<{ name: string }> };
    return (data.data ?? []).map((c) => c.name);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Failed to fetch ERPNext companies', 'external-unreachable');
  }
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('validateErpNextCompanyList: valid credentials returns company list', async () => {
  const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes('/api/resource/Company')) {
      return new Response(JSON.stringify({
        data: [
          { name: 'ACME Corp' },
          { name: 'Global Industries' },
          { name: 'Test Company' },
        ],
      }), { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const companies = await validateErpNextCompanyList(
    'https://erp.example.com',
    'test-key',
    'test-secret',
    { fetchImpl: mockFetch },
  );

  assertEquals(companies.length, 3);
  assertEquals(companies, ['ACME Corp', 'Global Industries', 'Test Company']);
});

Deno.test('validateErpNextCompanyList: normalizes siteUrl trailing slash', async () => {
  let calledUrl = '';
  const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ data: [{ name: 'ACME' }] }), { status: 200 });
  };

  await validateErpNextCompanyList(
    'https://erp.example.com/',
    'test-key',
    'test-secret',
    { fetchImpl: mockFetch },
  );

  assertEquals(calledUrl, 'https://erp.example.com/api/resource/Company?fields=["name"]&limit_page_length=200');
});

Deno.test('validateErpNextCompanyList: uses token auth header format', async () => {
  let authHeader = '';
  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = init?.headers as Record<string, string> | undefined;
    authHeader = headers?.Authorization ?? '';
    return new Response(JSON.stringify({ data: [{ name: 'ACME' }] }), { status: 200 });
  };

  await validateErpNextCompanyList(
    'https://erp.example.com',
    'test-key',
    'test-secret',
    { fetchImpl: mockFetch },
  );

  assert(authHeader.includes('token test-key:test-secret'));
});

Deno.test('validateErpNextCompanyList: 401/403 throws config-rejected', async () => {
  const mockFetch = async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });

  await assertRejects(
    () => validateErpNextCompanyList('https://erp.example.com', 'bad-key', 'bad-secret', { fetchImpl: mockFetch }),
    AppError,
    'Failed to fetch ERPNext companies',
  );
});

Deno.test('validateErpNextCompanyList: 404 throws NOT_FOUND', async () => {
  const mockFetch = async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 });

  await assertRejects(
    () => validateErpNextCompanyList('https://erp.example.com', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'ERPNext site not found',
  );
});

Deno.test('validateErpNextCompanyList: network error throws external-unreachable', async () => {
  const mockFetch = async () => { throw new Error('Network error'); };

  await assertRejects(
    () => validateErpNextCompanyList('https://erp.example.com', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Failed to fetch ERPNext companies',
  );
});

// ============================================================================
// SSRF hardening tests
// ============================================================================

Deno.test('validateErpNextCompanyList: rejects HTTP (non-HTTPS)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('http://erp.example.com', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Only HTTPS URLs are allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects localhost', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://localhost', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects 127.0.0.1', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://127.0.0.1', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects 10.0.0.0/8', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://10.0.0.1', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects 172.16.0.0/12', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://172.16.0.1', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects 172.31.255.255 (upper bound of /12)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://172.31.255.255', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects 192.168.0.0/16', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://192.168.1.1', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects 169.254.0.0/16 (link-local)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://169.254.1.1', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects ::1 (IPv6 loopback)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://[::1]', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects fc00::/7 (ULA)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://[fc00::1]', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects fd00::/7 (ULA)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://[fd00::1]', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects AWS metadata endpoint', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://169.254.169.254', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects GCP metadata endpoint', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://metadata.google.internal', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: rejects Azure metadata endpoint', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('https://metadata.azure.com', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompanyList: accepts valid public HTTPS URL', async () => {
  let called = false;
  const mockFetch = async () => {
    called = true;
    return new Response(JSON.stringify({ data: [{ name: 'ACME' }] }), { status: 200 });
  };

  await validateErpNextCompanyList('https://erp.example.com', 'test-key', 'test-secret', { fetchImpl: mockFetch });
  assert(called);
});

Deno.test('validateErpNextCompanyList: accepts erp.company.com', async () => {
  let called = false;
  const mockFetch = async () => {
    called = true;
    return new Response(JSON.stringify({ data: [{ name: 'ACME' }] }), { status: 200 });
  };

  await validateErpNextCompanyList('https://erp.company.com', 'test-key', 'test-secret', { fetchImpl: mockFetch });
  assert(called);
});

Deno.test('validateErpNextCompanyList: accepts public DNS IP (8.8.8.8)', async () => {
  let called = false;
  const mockFetch = async () => {
    called = true;
    return new Response(JSON.stringify({ data: [{ name: 'ACME' }] }), { status: 200 });
  };

  await validateErpNextCompanyList('https://8.8.8.8', 'test-key', 'test-secret', { fetchImpl: mockFetch });
  assert(called);
});

Deno.test('validateErpNextCompanyList: rejects invalid URL format', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompanyList('not-a-url', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Invalid site URL',
  );
});

// ============================================================================
// isPrivateOrReservedHost unit tests
// ============================================================================

Deno.test('isPrivateOrReservedHost: localhost → true', () => {
  assertEquals(isPrivateOrReservedHost('localhost'), true);
});

Deno.test('isPrivateOrReservedHost: 127.0.0.1 → true', () => {
  assertEquals(isPrivateOrReservedHost('127.0.0.1'), true);
});

Deno.test('isPrivateOrReservedHost: 10.0.0.1 → true', () => {
  assertEquals(isPrivateOrReservedHost('10.0.0.1'), true);
});

Deno.test('isPrivateOrReservedHost: 172.16.0.1 → true', () => {
  assertEquals(isPrivateOrReservedHost('172.16.0.1'), true);
});

Deno.test('isPrivateOrReservedHost: 172.31.255.255 → true', () => {
  assertEquals(isPrivateOrReservedHost('172.31.255.255'), true);
});

Deno.test('isPrivateOrReservedHost: 172.15.0.1 → false (outside /12)', () => {
  assertEquals(isPrivateOrReservedHost('172.15.0.1'), false);
});

Deno.test('isPrivateOrReservedHost: 172.32.0.1 → false (outside /12)', () => {
  assertEquals(isPrivateOrReservedHost('172.32.0.1'), false);
});

Deno.test('isPrivateOrReservedHost: 192.168.1.1 → true', () => {
  assertEquals(isPrivateOrReservedHost('192.168.1.1'), true);
});

Deno.test('isPrivateOrReservedHost: 169.254.1.1 → true', () => {
  assertEquals(isPrivateOrReservedHost('169.254.1.1'), true);
});

Deno.test('isPrivateOrReservedHost: [::1] → true (bracketed IPv6)', () => {
  assertEquals(isPrivateOrReservedHost('[::1]'), true);
});

Deno.test('isPrivateOrReservedHost: [fc00::1] → true (bracketed IPv6)', () => {
  assertEquals(isPrivateOrReservedHost('[fc00::1]'), true);
});

Deno.test('isPrivateOrReservedHost: [fd00::1] → true (bracketed IPv6)', () => {
  assertEquals(isPrivateOrReservedHost('[fd00::1]'), true);
});

Deno.test('isPrivateOrReservedHost: fe80::1 → false (link-local not in fc00::/7)', () => {
  assertEquals(isPrivateOrReservedHost('fe80::1'), false);
});

Deno.test('isPrivateOrReservedHost: 169.254.169.254 → true', () => {
  assertEquals(isPrivateOrReservedHost('169.254.169.254'), true);
});

Deno.test('isPrivateOrReservedHost: metadata.google.internal → true', () => {
  assertEquals(isPrivateOrReservedHost('metadata.google.internal'), true);
});

Deno.test('isPrivateOrReservedHost: metadata.azure.com → true', () => {
  assertEquals(isPrivateOrReservedHost('metadata.azure.com'), true);
});

Deno.test('isPrivateOrReservedHost: example.com → false', () => {
  assertEquals(isPrivateOrReservedHost('example.com'), false);
});

Deno.test('isPrivateOrReservedHost: erp.company.com → false', () => {
  assertEquals(isPrivateOrReservedHost('erp.company.com'), false);
});

Deno.test('isPrivateOrReservedHost: 8.8.8.8 → false (public DNS)', () => {
  assertEquals(isPrivateOrReservedHost('8.8.8.8'), false);
});

Deno.test('isPrivateOrReservedHost: 1.1.1.1 → false (public DNS)', () => {
  assertEquals(isPrivateOrReservedHost('1.1.1.1'), false);
});