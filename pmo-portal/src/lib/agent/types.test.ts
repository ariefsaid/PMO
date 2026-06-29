/**
 * Compile-time contract tests for the agent types module.
 * AC-### tags in each it() title are the traceability anchors (ADR-0010).
 */
import { it, expect } from 'vitest';
import type { ComposeViewRequest, ComposeViewResponse, ComposeViewError } from './types';

it('contract types compile — ComposeViewResponse sample type-checks correctly', () => {
  // This test is primarily a compile-time assertion. If the types are wrong, tsc will fail.
  const response: ComposeViewResponse = {
    spec: { version: 1, panels: [] },
    repairAttempts: 0,
  };
  expect(response.repairAttempts).toBe(0);
  expect(response.spec.version).toBe(1);
});

it('contract types compile — ComposeViewError discriminated union type-checks', () => {
  const err422: ComposeViewError = {
    status: 422,
    error: 'REPAIR_EXHAUSTED',
    validationError: { code: 'UNKNOWN_ENTITY', detail: 'secrets' },
  };
  expect(err422.status).toBe(422);
  expect(err422.error).toBe('REPAIR_EXHAUSTED');

  const err401: ComposeViewError = {
    status: 401,
    error: 'UNAUTHORIZED',
  };
  expect(err401.status).toBe(401);

  const err429: ComposeViewError = {
    status: 429,
    error: 'RATE_LIMITED',
    retryAfterSeconds: 3600,
  };
  expect(err429.retryAfterSeconds).toBe(3600);
});

it('contract types compile — ComposeViewRequest optional contextHints', () => {
  const req: ComposeViewRequest = {
    prompt: 'show projects',
    orgId: 'org-1',
    contextHints: { currentUserId: 'u-1', currentDate: '2026-06-29' },
  };
  expect(req.orgId).toBe('org-1');

  const reqMinimal: ComposeViewRequest = {
    prompt: 'show projects',
    orgId: 'org-1',
  };
  expect(reqMinimal.contextHints).toBeUndefined();
});
