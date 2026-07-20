// @vitest-environment jsdom
/**
 * connectClient — the FE transport for the m365-token-custody edge function (Phase-1 wiring).
 *
 * AC-M365-014/015/016/019: the transport is unit-tested in isolation here (the supabase
 * `functions.invoke` client is mocked), mirroring adapterSeam/dispatchClient's test approach.
 * The owning ACs for the rendered CARD behavior live in M365ConnectionCard.test.tsx; this file
 * owns the transport contract: the invoke args, the response unwrap, and the M365ErrorCode →
 * human-copy classification (never a raw internal string).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initiateM365Connect,
  disconnectM365,
  describeM365Error,
  classifyM365InvokeError,
} from '../connectClient';
import { AppError } from '../../appError';

/** Build a FunctionsHttpError-shaped error whose `.context` is a Response returning `body`. */
function httpError(body: unknown, status = 403): { context: Response } {
  const json = JSON.stringify(body);
  const response = {
    clone: () => response,
    json: async () => JSON.parse(json),
    status,
  } as unknown as Response;
  return { context: response };
}

/** Await `fn` and capture the thrown value as an AppError (the client only throws AppError). */
async function captureThrow(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error('expected the call to throw, but it resolved');
}

/** A FunctionsFetchError-shaped error: NO `.context` (the fetch never reached the edge fn). */
function networkError(message: string): Error {
  return new Error(message);
}

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

beforeEach(() => {
  invoke.mockReset();
});

describe('AC-M365-014 — initiateM365Connect transport', () => {
  it('AC-M365-014: POSTs action:initiate_connect and returns { authorizeUrl, state }', async () => {
    invoke.mockResolvedValueOnce({
      data: { authorizeUrl: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?...', state: 'state-abc' },
      error: null,
    });

    const result = await initiateM365Connect();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'initiate_connect' } });
    expect(result.authorizeUrl).toContain('login.microsoftonline.com');
    expect(result.state).toBe('state-abc');
  });

  it('AC-M365-014: a 200 with no data throws a generic AppError (no crash, no redirect)', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: null });
    await expect(initiateM365Connect()).rejects.toMatchObject({ name: 'AppError' });
  });
});

describe('AC-M365-015 — M365ErrorCode taxonomy maps to human copy (never a raw code/internal string)', () => {
  const cases: Array<{ code: string; status: number }> = [
    { code: 'NOT_ENTITLED', status: 403 },
    { code: 'FORBIDDEN', status: 403 },
    { code: 'UNAUTHORIZED', status: 401 },
    { code: 'CONNECTION_STALE', status: 409 },
    { code: 'CONNECTION_REVOKED', status: 410 },
    { code: 'NOT_CONNECTED', status: 404 },
    { code: 'TOKEN_EXCHANGE_FAILED', status: 502 },
    { code: 'INVALID_STATE', status: 400 },
    { code: 'SCOPE_INSUFFICIENT', status: 403 },
    { code: 'BAD_REQUEST', status: 400 },
    { code: 'GRAPH_ERROR', status: 502 },
    { code: 'INTERNAL_ERROR', status: 500 },
  ];

  for (const { code, status } of cases) {
    it(`AC-M365-015: ${code} (${status}) → human copy, code carried on AppError, no redirect`, async () => {
      // The edge fn's raw `message` may carry detail; the FE MUST map by `error` code, not echo it.
      const rawMessage = `raw internal detail for ${code} (must NOT surface)`;
      invoke.mockResolvedValueOnce({
        data: null,
        error: httpError({ error: code, message: rawMessage }, status),
      });

      const thrown = await captureThrow(() => initiateM365Connect());

      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown.code).toBe(code);
      expect(thrown.message).toBe(describeM365Error(code));
      // The raw server message + the code string never leak into the user-facing message.
      expect(thrown.message).not.toContain(rawMessage);
      expect(thrown.message).not.toContain(code);
      // And we did NOT navigate (invoke was the only transport call; no redirect API is touched).
      expect(invoke).toHaveBeenCalledTimes(1);
    });
  }

  it('AC-M365-015: an unknown code falls back to a generic human message (no raw echo)', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError({ error: 'SOMETHING_NEW', message: 'mystery' }, 500),
    });
    const thrown = await captureThrow(() => initiateM365Connect());
    expect(thrown.message).toBe(describeM365Error(undefined));
    expect(thrown.message).not.toContain('SOMETHING_NEW');
    expect(thrown.message).not.toContain('mystery');
  });
});

describe('AC-M365-015 (network path) — a fetch failure never surfaces its raw string', () => {
  it('classifies a network error (no .context Response) to external-unreachable + generic copy', () => {
    const raw = 'getaddrinfo ENOTFOUND login.microsoftonline.com';
    const { code, message } = classifyM365InvokeError(networkError(raw), undefined);
    expect(code).toBe('external-unreachable');
    expect(message).toBe(describeM365Error(undefined)); // generic — network shares the generic copy
    expect(message).not.toContain(raw);
    expect(message).not.toContain('ENOTFOUND');
  });

  it('initiate throws AppError(external-unreachable) on a network failure', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: networkError('Failed to send a request') });
    const thrown = await captureThrow(() => initiateM365Connect());
    expect(thrown.code).toBe('external-unreachable');
    expect(thrown.message).not.toContain('Failed to send a request');
  });
});

describe('AC-M365-019 — disconnectM365 transport', () => {
  it('AC-M365-019: POSTs action:disconnect and resolves on { success: true }', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    await expect(disconnectM365()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'disconnect' } });
  });

  it('AC-M365-019: a NOT_CONNECTED response surfaces the mapped human copy + code', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError({ error: 'NOT_CONNECTED', message: 'no active connection' }, 404),
    });
    const thrown = await captureThrow(() => disconnectM365());
    expect(thrown.code).toBe('NOT_CONNECTED');
    expect(thrown.message).toBe(describeM365Error('NOT_CONNECTED'));
  });

  it('AC-M365-019: an INTERNAL_ERROR on disconnect throws AppError(INTERNAL_ERROR)', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError({ error: 'INTERNAL_ERROR', message: 'failed to delete' }, 503),
    });
    const thrown = await captureThrow(() => disconnectM365());
    expect(thrown.code).toBe('INTERNAL_ERROR');
  });
});

describe('describeM365Error — no M365ErrorCode leaks its raw string into the human copy', () => {
  const allCodes = [
    'NOT_ENTITLED', 'FORBIDDEN', 'UNAUTHORIZED', 'CONNECTION_STALE', 'CONNECTION_REVOKED',
    'NOT_CONNECTED', 'TOKEN_EXCHANGE_FAILED', 'INVALID_STATE', 'SCOPE_INSUFFICIENT',
    'BAD_REQUEST', 'GRAPH_ERROR', 'INTERNAL_ERROR',
  ];
  for (const code of allCodes) {
    it(`${code}: copy is non-empty and does not contain the raw code or underscores`, () => {
      const copy = describeM365Error(code);
      expect(copy.length).toBeGreaterThan(10);
      expect(copy).not.toContain(code);
      expect(copy).not.toContain('_');
    });
  }
});
