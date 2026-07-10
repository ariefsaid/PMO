import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../supabase/client.ts', () => ({ supabase: { functions: { invoke: h.invoke } } }));

import { dispatchTaskCommand, classifyDispatchError } from './dispatchClient.ts';
import { AppError } from '../appError.ts';

beforeEach(() => {
  h.invoke.mockReset();
});

describe('dispatchTaskCommand — the FE→adapter-dispatch transport (FR-CUA-022/023/024, ADR-0056)', () => {
  it('invokes adapter-dispatch with { domain: "tasks", operation, record } and returns the CommandResult', async () => {
    const canonical = { id: 'pmo-1', name: 'Survey site', status: 'Done' };
    h.invoke.mockResolvedValue({ data: { externalRecordId: 'cu-1', canonical }, error: null });

    const result = await dispatchTaskCommand('transition', { id: 'pmo-1', status: 'Done' });

    expect(h.invoke).toHaveBeenCalledWith('adapter-dispatch', {
      body: { domain: 'tasks', operation: 'transition', record: { id: 'pmo-1', status: 'Done' } },
    });
    expect(result).toEqual({ externalRecordId: 'cu-1', canonical });
  });

  it('maps a commit-rejected edge-fn body onto an AppError with that code + message', async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          clone: () => ({ json: async () => ({ error: 'commit-rejected', message: 'ClickUp rejected the status' }) }),
        },
      },
    });
    await expect(dispatchTaskCommand('transition', { id: 't1' })).rejects.toMatchObject({
      name: 'AppError',
      code: 'commit-rejected',
      message: 'ClickUp rejected the status',
    });
  });

  it('maps an external-unreachable edge-fn body onto an AppError with that code + message', async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          clone: () => ({ json: async () => ({ error: 'external-unreachable', message: 'ClickUp is unreachable' }) }),
        },
      },
    });
    await expect(dispatchTaskCommand('create', { id: 't1' })).rejects.toMatchObject({
      code: 'external-unreachable',
      message: 'ClickUp is unreachable',
    });
  });

  it('classifies a no-context (network) failure as external-unreachable — never the raw fetch string (review fix #5)', async () => {
    // A FunctionsFetchError (network failure: DNS/connection/refused) carries NO HTTP Response on
    // `.context` — the request never reached the edge fn. It MUST surface as external-unreachable
    // with a GENERIC message, never the raw fetch string ('network error', 'name resolution failed').
    h.invoke.mockResolvedValue({
      data: null,
      error: { message: 'network error', context: undefined },
    });
    await expect(dispatchTaskCommand('delete', { id: 't1' })).rejects.toMatchObject({
      code: 'external-unreachable',
      message: 'The external system could not be reached',
    });
  });

  it('never surfaces a raw FunctionsFetchError string (name resolution failed / Failed to send a request)', async () => {
    const scary = 'Failed to send a request: name resolution failed (getaddrinfo ENOTFOUND)';
    h.invoke.mockResolvedValue({ data: null, error: { message: scary, context: undefined } });
    const err = await dispatchTaskCommand('transition', { id: 't1' }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('external-unreachable');
    // The raw fetch string MUST NOT be the user-facing message.
    expect(err.message).not.toContain('name resolution failed');
    expect(err.message).not.toContain('Failed to send a request');
  });

  it('throws when invoke resolves with no error but also no data', async () => {
    h.invoke.mockResolvedValue({ data: null, error: null });
    await expect(dispatchTaskCommand('create', { id: 't1' })).rejects.toBeInstanceOf(AppError);
  });
});

describe('classifyDispatchError — pure network/structured-code classification (review fix #5)', () => {
  // A network failure shape: NO HTTP Response on `.context` (FunctionsFetchError — fetch rejected).
  const networkError = { message: 'Failed to send a request: name resolution failed', context: undefined };
  // An HTTP error shape: `.context` is a Response (FunctionsHttpError — non-2xx with a body).
  const httpError = (body: unknown) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: { clone: () => ({ json: async () => body }) },
  });

  it('a known structured code from the body wins', () => {
    expect(classifyDispatchError(httpError({ error: 'commit-rejected', message: 'no map' }), { error: 'commit-rejected', message: 'no map' }))
      .toEqual({ code: 'commit-rejected', message: 'no map' });
    expect(classifyDispatchError(httpError({ error: 'external-unreachable' }), { error: 'external-unreachable', message: 'down' }))
      .toEqual({ code: 'external-unreachable', message: 'down' });
  });

  it('a no-code network failure (no HTTP response) → external-unreachable + generic message, never the raw string', () => {
    const out = classifyDispatchError(networkError, undefined);
    expect(out.code).toBe('external-unreachable');
    expect(out.message).toBe('The external system could not be reached');
    expect(out.message).not.toContain('name resolution failed');
  });

  it('an HTTP failure with no structured code → undefined code + the body message (a controlled edge-fn message, not a raw fetch string)', () => {
    const out = classifyDispatchError(httpError({ message: 'internal error' }), { message: 'internal error' });
    expect(out.code).toBeUndefined();
    expect(out.message).toBe('internal error');
  });

  it('an HTTP failure with an UNKNOWN structured code → undefined code (not surfaced as a known classification)', () => {
    const out = classifyDispatchError(httpError({ error: 'SOME_NEW_CODE' }), { error: 'SOME_NEW_CODE' });
    expect(out.code).toBeUndefined();
  });
});
