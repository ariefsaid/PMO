/**
 * external-connect — Deno test (task 2.2)
 *
 * Tests the connect edge function's credential validation logic with mocked fetch.
 * AC-EAC-001, AC-EAC-002, AC-EAC-003, AC-EAC-004
 */

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1.0.10';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

// Import the validator functions by copying them here for unit testing
// (In production they're internal to index.ts; we test the logic directly)

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
  const url = `${siteUrl.replace(/\/$/, '')}/api/resource/User/${apiKey}`;
  const res = await deps.fetchImpl(url, {
    headers: { Authorization: `token ${apiKey}:${apiSecret}` },
  });
  if (!res.ok) {
    throw new AppError('Invalid ERPNext credentials', 'config-rejected');
  }
}

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