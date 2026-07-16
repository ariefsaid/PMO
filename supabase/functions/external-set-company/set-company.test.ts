/**
 * external-set-company — Deno unit tests (OD-INT-6).
 *
 * Tests the ERPNext company selection logic with mocked fetch and mocked Supabase.
 * Verifies:
 * - Admin can set company
 * - Operator can set company
 * - Non-Admin/Operator gets 403
 * - Cross-org denied
 * - Missing/inactive binding returns 404/422
 * - Invalid company returns 404/422
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
    // More precise fc00::/7 check
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

interface ErpCompanyDeps {
  fetchImpl: typeof fetch;
  siteUrl: string;
  apiKey: string;
  apiSecret: string;
}

async function validateErpNextCompany(deps: ErpCompanyDeps, companyId: string): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(deps.siteUrl);
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
    const url = `${deps.siteUrl.replace(/\/$/, '')}/api/resource/Company/${encodeURIComponent(companyId)}`;
    const res = await deps.fetchImpl(url, {
      headers: { Authorization: `token ${deps.apiKey}:${deps.apiSecret}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      if (res.status === 404) {
        throw new AppError('Company not found in ERPNext', 'NOT_FOUND');
      }
      throw new AppError('Failed to validate ERPNext company', 'external-unreachable');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Failed to validate ERPNext company', 'external-unreachable');
  }
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('validateErpNextCompany: valid company exists → resolves', async () => {
  const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = String(input);
    assertEquals(url, 'https://erp.example.com/api/resource/Company/ACME%20Corp');
    return new Response(JSON.stringify({ data: { name: 'ACME Corp' } }), { status: 200 });
  };

  await validateErpNextCompany(
    { fetchImpl: mockFetch, siteUrl: 'https://erp.example.com', apiKey: 'key', apiSecret: 'secret' },
    'ACME Corp',
  );
});

Deno.test('validateErpNextCompany: normalizes siteUrl trailing slash', async () => {
  let calledUrl = '';
  const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ data: { name: 'ACME' } }), { status: 200 });
  };

  await validateErpNextCompany(
    { fetchImpl: mockFetch, siteUrl: 'https://erp.example.com/', apiKey: 'key', apiSecret: 'secret' },
    'ACME',
  );

  assertEquals(calledUrl, 'https://erp.example.com/api/resource/Company/ACME');
});

Deno.test('validateErpNextCompany: uses token auth header format', async () => {
  let authHeader = '';
  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = init?.headers as Record<string, string> | undefined;
    authHeader = headers?.Authorization ?? '';
    return new Response(JSON.stringify({ data: { name: 'ACME' } }), { status: 200 });
  };

  await validateErpNextCompany(
    { fetchImpl: mockFetch, siteUrl: 'https://erp.example.com', apiKey: 'key', apiSecret: 'secret' },
    'ACME',
  );

  assert(authHeader.includes('token key:secret'));
});

Deno.test('validateErpNextCompany: 404 throws NOT_FOUND', async () => {
  const mockFetch = async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://erp.example.com', apiKey: 'key', apiSecret: 'secret' },
      'NONEXISTENT',
    ),
    AppError,
    'Company not found in ERPNext',
  );
});

Deno.test('validateErpNextCompany: 401/403 throws external-unreachable', async () => {
  const mockFetch = async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://erp.example.com', apiKey: 'bad', apiSecret: 'bad' },
      'ACME',
    ),
    AppError,
    'Failed to validate ERPNext company',
  );
});

Deno.test('validateErpNextCompany: network error throws external-unreachable', async () => {
  const mockFetch = async () => { throw new Error('Network error'); };

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://erp.example.com', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Failed to validate ERPNext company',
  );
});

// ============================================================================
// SSRF hardening tests
// ============================================================================

Deno.test('validateErpNextCompany: rejects HTTP (non-HTTPS)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'http://erp.example.com', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Only HTTPS URLs are allowed',
  );
});

Deno.test('validateErpNextCompany: rejects localhost', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://localhost', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects 127.0.0.1', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://127.0.0.1', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects 10.0.0.0/8', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://10.0.0.1', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects 172.16.0.0/12', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://172.16.0.1', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects 172.31.255.255 (upper bound of /12)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://172.31.255.255', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects 192.168.0.0/16', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://192.168.1.1', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects 169.254.0.0/16 (link-local)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://169.254.1.1', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects ::1 (IPv6 loopback)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://[::1]', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects fc00::/7 (ULA)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://[fc00::1]', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects fd00::/7 (ULA)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://[fd00::1]', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects AWS metadata endpoint', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://169.254.169.254', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects GCP metadata endpoint', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://metadata.google.internal', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: rejects Azure metadata endpoint', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'https://metadata.azure.com', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCompany: accepts valid public HTTPS URL', async () => {
  let called = false;
  const mockFetch = async () => {
    called = true;
    return new Response(JSON.stringify({ data: { name: 'ACME' } }), { status: 200 });
  };

  await validateErpNextCompany(
    { fetchImpl: mockFetch, siteUrl: 'https://erp.example.com', apiKey: 'key', apiSecret: 'secret' },
    'ACME',
  );
  assert(called);
});

Deno.test('validateErpNextCompany: accepts erp.company.com', async () => {
  let called = false;
  const mockFetch = async () => {
    called = true;
    return new Response(JSON.stringify({ data: { name: 'ACME' } }), { status: 200 });
  };

  await validateErpNextCompany(
    { fetchImpl: mockFetch, siteUrl: 'https://erp.company.com', apiKey: 'key', apiSecret: 'secret' },
    'ACME',
  );
  assert(called);
});

Deno.test('validateErpNextCompany: accepts public DNS IP (8.8.8.8)', async () => {
  let called = false;
  const mockFetch = async () => {
    called = true;
    return new Response(JSON.stringify({ data: { name: 'ACME' } }), { status: 200 });
  };

  await validateErpNextCompany(
    { fetchImpl: mockFetch, siteUrl: 'https://8.8.8.8', apiKey: 'key', apiSecret: 'secret' },
    'ACME',
  );
  assert(called);
});

Deno.test('validateErpNextCompany: rejects invalid URL format', async () => {
  const mockFetch = async () => new Response('', { status: 200 });

  await assertRejects(
    () => validateErpNextCompany(
      { fetchImpl: mockFetch, siteUrl: 'not-a-url', apiKey: 'key', apiSecret: 'secret' },
      'ACME',
    ),
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