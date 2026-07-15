/**
 * external-connect — Deno test (task 2.2 + P2 fixes)
 *
 * Tests the connect edge function's credential validation logic with mocked fetch.
 * Tests the refactored handler functions directly.
 * AC-EAC-001, AC-EAC-002, AC-EAC-003, AC-EAC-004, AC-EAC-006
 */

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1.0.10';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

// ============================================================================
// Validator functions (copied from index.ts for unit testing)
// ============================================================================

interface ValidatorDeps {
  fetchImpl: typeof fetch;
}

async function validateClickUpToken(
  token: string,
  deps: ValidatorDeps,
): Promise<void> {
  try {
    const res = await deps.fetchImpl('https://api.clickup.com/api/v2/user', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new AppError('Invalid ClickUp token', 'config-rejected');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid ClickUp token', 'config-rejected');
  }
}

async function validateErpNextCredentials(
  siteUrl: string,
  apiKey: string,
  apiSecret: string,
  deps: ValidatorDeps,
): Promise<void> {
  // SSRF hardening: parse URL and reject private/loopback/link-local/metadata addresses
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
    const url = `${siteUrl.replace(/\/$/, '')}/api/resource/User/${encodeURIComponent(apiKey)}`;
    const res = await deps.fetchImpl(url, {
      headers: { Authorization: `token ${apiKey}:${apiSecret}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new AppError('Invalid ERPNext credentials', 'config-rejected');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid ERPNext credentials', 'config-rejected');
  }
}

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
  if (host === '169.254.169.254') return true;
  if (host === 'metadata.google.internal') return true;
  if (host === 'metadata.azure.com') return true;

  return false;
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('validateClickUpToken: valid token (200) → resolves', async () => {
  const mockFetch = async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    return new Response(JSON.stringify({ id: 123, username: 'test' }), { status: 200 });
  };
  await validateClickUpToken('valid-token', { fetchImpl: mockFetch });
});

Deno.test('validateClickUpToken: invalid token (401) → throws config-rejected', async () => {
  const mockFetch = async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  };
  await assertRejects(
    () => validateClickUpToken('bad-token', { fetchImpl: mockFetch }),
    AppError,
    'Invalid ClickUp token',
  );
});

Deno.test('validateClickUpToken: network error → throws config-rejected', async () => {
  const mockFetch = async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    throw new Error('Network error');
  };
  try {
    await validateClickUpToken('token', { fetchImpl: mockFetch });
    throw new Error('should have thrown');
  } catch (err) {
    assert(err instanceof AppError);
    assertEquals(err.code, 'config-rejected');
    assertEquals(err.message, 'Invalid ClickUp token');
  }
});

Deno.test('validateErpNextCredentials: valid credentials (200) → resolves', async () => {
  const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    assertEquals(String(input), 'https://erp.example.com/api/resource/User/test-key');
    return new Response(JSON.stringify({ data: { name: 'test-key' } }), { status: 200 });
  };
  await validateErpNextCredentials('https://erp.example.com', 'test-key', 'test-secret', { fetchImpl: mockFetch });
});

Deno.test('validateErpNextCredentials: invalid credentials (401/403) → throws config-rejected', async () => {
  const mockFetch = async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  };
  await assertRejects(
    () => validateErpNextCredentials('https://erp.example.com', 'bad-key', 'bad-secret', { fetchImpl: mockFetch }),
    AppError,
    'Invalid ERPNext credentials',
  );
});

Deno.test('validateErpNextCredentials: normalizes siteUrl (trailing slash)', async () => {
  let calledUrl = '';
  const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ data: { name: 'test-key' } }), { status: 200 });
  };
  await validateErpNextCredentials('https://erp.example.com/', 'test-key', 'test-secret', { fetchImpl: mockFetch });
  assertEquals(calledUrl, 'https://erp.example.com/api/resource/User/test-key');
});

Deno.test('validateErpNextCredentials: uses token auth header format', async () => {
  let authHeader = '';
  const mockFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = init?.headers as Record<string, string> | undefined;
    authHeader = headers?.Authorization ?? '';
    return new Response(JSON.stringify({ data: { name: 'test-key' } }), { status: 200 });
  };
  await validateErpNextCredentials('https://erp.example.com', 'test-key', 'test-secret', { fetchImpl: mockFetch });
  assert(authHeader.includes('token test-key:test-secret'));
});

// ============================================================================
// SSRF hardening tests
// ============================================================================

Deno.test('validateErpNextCredentials: rejects HTTP (non-HTTPS)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('http://erp.example.com', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Only HTTPS URLs are allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects localhost', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://localhost', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects 127.0.0.1', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://127.0.0.1', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects 10.0.0.0/8', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://10.0.0.1', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects 172.16.0.0/12', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://172.16.0.1', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects 172.31.255.255 (upper bound of /12)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://172.31.255.255', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects 192.168.0.0/16', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://192.168.1.1', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects 169.254.0.0/16 (link-local)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://169.254.1.1', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects ::1 (IPv6 loopback)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://[::1]', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects fc00::/7 (ULA)', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://[fc00::1]', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects AWS metadata endpoint', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://169.254.169.254', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: rejects GCP metadata endpoint', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('https://metadata.google.internal', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Private or reserved addresses are not allowed',
  );
});

Deno.test('validateErpNextCredentials: accepts valid public HTTPS URL', async () => {
  let called = false;
  const mockFetch = async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    called = true;
    return new Response(JSON.stringify({ data: { name: 'test-key' } }), { status: 200 });
  };
  await validateErpNextCredentials('https://erp.example.com', 'test-key', 'test-secret', { fetchImpl: mockFetch });
  assert(called);
});

Deno.test('validateErpNextCredentials: apiKey is URL-encoded in path', async () => {
  let calledUrl = '';
  const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ data: { name: 'test-key' } }), { status: 200 });
  };
  await validateErpNextCredentials('https://erp.example.com', 'key with spaces', 'secret', { fetchImpl: mockFetch });
  assert(calledUrl.includes('key%20with%20spaces'));
});

Deno.test('validateErpNextCredentials: rejects invalid URL format', async () => {
  const mockFetch = async () => new Response('', { status: 200 });
  await assertRejects(
    () => validateErpNextCredentials('not-a-url', 'key', 'secret', { fetchImpl: mockFetch }),
    AppError,
    'Invalid site URL',
  );
});

// ============================================================================
// isPrivateOrReservedHost unit tests
// ============================================================================

Deno.test('isPrivateOrReservedHost: localhost → true', () => {
  assert(isPrivateOrReservedHost('localhost'));
});

Deno.test('isPrivateOrReservedHost: 127.0.0.1 → true', () => {
  assert(isPrivateOrReservedHost('127.0.0.1'));
});

Deno.test('isPrivateOrReservedHost: 10.0.0.1 → true', () => {
  assert(isPrivateOrReservedHost('10.0.0.1'));
});

Deno.test('isPrivateOrReservedHost: 172.16.0.1 → true', () => {
  assert(isPrivateOrReservedHost('172.16.0.1'));
});

Deno.test('isPrivateOrReservedHost: 172.31.255.255 → true', () => {
  assert(isPrivateOrReservedHost('172.31.255.255'));
});

Deno.test('isPrivateOrReservedHost: 172.15.0.1 → false (outside /12)', () => {
  assert(!isPrivateOrReservedHost('172.15.0.1'));
});

Deno.test('isPrivateOrReservedHost: 172.32.0.1 → false (outside /12)', () => {
  assert(!isPrivateOrReservedHost('172.32.0.1'));
});

Deno.test('isPrivateOrReservedHost: 192.168.1.1 → true', () => {
  assert(isPrivateOrReservedHost('192.168.1.1'));
});

Deno.test('isPrivateOrReservedHost: 169.254.1.1 → true', () => {
  assert(isPrivateOrReservedHost('169.254.1.1'));
});

Deno.test('isPrivateOrReservedHost: ::1 → true', () => {
  assert(isPrivateOrReservedHost('::1'));
});

Deno.test('isPrivateOrReservedHost: [::1] → true (bracketed IPv6)', () => {
  assert(isPrivateOrReservedHost('[::1]'));
});

Deno.test('isPrivateOrReservedHost: fc00::1 → true', () => {
  assert(isPrivateOrReservedHost('fc00::1'));
});

Deno.test('isPrivateOrReservedHost: [fc00::1] → true (bracketed IPv6)', () => {
  assert(isPrivateOrReservedHost('[fc00::1]'));
});

Deno.test('isPrivateOrReservedHost: fd00::1 → true', () => {
  assert(isPrivateOrReservedHost('fd00::1'));
});

Deno.test('isPrivateOrReservedHost: [fd00::1] → true (bracketed IPv6)', () => {
  assert(isPrivateOrReservedHost('[fd00::1]'));
});

Deno.test('isPrivateOrReservedHost: fe80::1 → false (link-local not in fc00::/7)', () => {
  assert(!isPrivateOrReservedHost('fe80::1'));
});

Deno.test('isPrivateOrReservedHost: 169.254.169.254 → true', () => {
  assert(isPrivateOrReservedHost('169.254.169.254'));
});

Deno.test('isPrivateOrReservedHost: metadata.google.internal → true', () => {
  assert(isPrivateOrReservedHost('metadata.google.internal'));
});

Deno.test('isPrivateOrReservedHost: metadata.azure.com → true', () => {
  assert(isPrivateOrReservedHost('metadata.azure.com'));
});

Deno.test('isPrivateOrReservedHost: example.com → false', () => {
  assert(!isPrivateOrReservedHost('example.com'));
});

Deno.test('isPrivateOrReservedHost: erp.company.com → false', () => {
  assert(!isPrivateOrReservedHost('erp.company.com'));
});

Deno.test('isPrivateOrReservedHost: 8.8.8.8 → false (public DNS)', () => {
  assert(!isPrivateOrReservedHost('8.8.8.8'));
});

Deno.test('isPrivateOrReservedHost: 1.1.1.1 → false (public DNS)', () => {
  assert(!isPrivateOrReservedHost('1.1.1.1'));
});
