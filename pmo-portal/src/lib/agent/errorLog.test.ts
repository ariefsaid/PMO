/**
 * Tests for the shared structured edge-function error logger (`_shared/errorLog.ts`).
 * Observability hardening (spike 2026-07-04, harden #1): every error/failure path across
 * agent-chat / compose-view / agent-dispatch must log a STRUCTURED line carrying an error
 * CODE + a context id, and NEVER a secret value or prompt/PII text.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logStructuredError } from '../../../../supabase/functions/_shared/errorLog';

describe('logStructuredError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs one console.error call carrying fn + errorCode', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logStructuredError({ fn: 'agent-chat', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    expect(spy).toHaveBeenCalledTimes(1);
    const [message, context] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain('agent-chat');
    expect(context).toMatchObject({ errorCode: 'MISSING_OPENROUTER_API_KEY', fn: 'agent-chat' });
  });

  it('includes an optional context id (e.g. runId/automationId) when supplied', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logStructuredError({ fn: 'agent-dispatch', errorCode: 'TICK_FAILED', contextId: 'run-123' });
    const [, context] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(context).toMatchObject({ errorCode: 'TICK_FAILED', contextId: 'run-123' });
  });

  it('never includes a secret/key/token/prompt field even if accidentally passed', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logStructuredError({
      fn: 'agent-chat',
      errorCode: 'MISSING_OPENROUTER_API_KEY',
      // @ts-expect-error — apiKey/prompt are not part of the typed context; this asserts
      // the function signature itself has no slot for them (compile-time scrub).
      apiKey: 'sk-or-should-never-appear',
    });
    const [, context] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.stringify(context)).not.toContain('sk-or-should-never-appear');
  });

  it('omits contextId from the logged context when not supplied (no stray undefined key)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logStructuredError({ fn: 'compose-view', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    const [, context] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect('contextId' in context).toBe(false);
  });
});
