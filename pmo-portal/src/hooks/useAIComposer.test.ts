/**
 * Unit tests for useAIComposer hook.
 * AC-AS-019: client-side compile re-validation before populating builder.
 * AC-AS-019 + Recon #4: orgId sourced from currentUser.org_id, NOT app_metadata.
 * Reconciliation #1: compileCompositionSpec throws (not returns errors).
 */
import { it, expect, vi, beforeEach, describe } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockCompile,
  mockFetch,
  mockCurrentUser,
  mockSession,
} = vi.hoisted(() => {
  const mockCurrentUser = { id: 'u-1', org_id: 'org-1' };
  const mockSession = { access_token: 'jwt-token-abc' };
  return {
    mockCompile: vi.fn(),
    mockFetch: vi.fn(),
    mockCurrentUser,
    mockSession,
  };
});

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: mockCurrentUser,
    session: mockSession,
  }),
}));

vi.mock('@/src/lib/viewspec/compiler', () => ({
  compileCompositionSpec: mockCompile,
}));

// Stub import.meta.env
vi.stubGlobal('import', {
  meta: {
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
    },
  },
});

global.fetch = mockFetch;

import { useAIComposer } from './useAIComposer';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

const VALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'panel-1',
      primitive: 'KPITile',
      querySpec: {
        entity: 'projects',
        select: ['id', 'name', 'contract_value'],
        aggregate: { fn: 'sum', column: 'contract_value', alias: 'total' },
      },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCompile.mockReturnValue([]); // default: compile succeeds
});

describe('useAIComposer', () => {
  it('AC-AS-019 compose() re-runs compileCompositionSpec and returns the spec only when it does not throw', async () => {
    // Mock fetch returning a valid spec
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ spec: VALID_SPEC, repairAttempts: 0 }),
    });
    mockCompile.mockReturnValue([]); // does not throw

    const { result } = renderHook(() => useAIComposer());

    let returnedSpec: CompositionSpec | null = null;
    await act(async () => {
      returnedSpec = await result.current.compose('show projects');
    });

    // Should have returned the spec
    expect(returnedSpec).toEqual(VALID_SPEC);

    // Should have called fetch with correct args (Recon #4: orgId from currentUser)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/compose-view');
    expect(options.method).toBe('POST');
    const headers = options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-token-abc');
    const body = JSON.parse(options.body as string);
    expect(body.prompt).toBe('show projects');
    expect(body.orgId).toBe('org-1'); // from currentUser.org_id, NOT app_metadata

    // compileCompositionSpec must have been called client-side
    expect(mockCompile).toHaveBeenCalledWith(VALID_SPEC, { userId: 'u-1', orgId: 'org-1' });
  });

  it('AC-AS-019 compose() returns null and sets error when client-side compile throws (defense-in-depth)', async () => {
    const { ValidationError } = await import('@/src/lib/viewspec/types');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ spec: VALID_SPEC, repairAttempts: 0 }),
    });
    mockCompile.mockImplementation(() => {
      throw new ValidationError('UNKNOWN_ENTITY', 'secrets');
    });

    const { result } = renderHook(() => useAIComposer());

    let returnedSpec: CompositionSpec | null = null;
    await act(async () => {
      returnedSpec = await result.current.compose('show secrets');
    });

    // Defense-in-depth: tampered spec must not reach the builder
    expect(returnedSpec).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('compose() returns null and sets 422 error message when server returns 422', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'REPAIR_EXHAUSTED',
        validationError: { code: 'MISSING_REQUIRED_FILTER' },
        repairAttempts: 2,
      }),
    });

    const { result } = renderHook(() => useAIComposer());

    let returnedSpec: CompositionSpec | null = null;
    await act(async () => {
      returnedSpec = await result.current.compose('show tasks');
    });

    expect(returnedSpec).toBeNull();
    expect(result.current.error).toMatch(/try rephrasing/i);
  });

  it('compose() returns null and sets 429 error message when server returns 429', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: 'RATE_LIMITED',
        retryAfterSeconds: 3600,
      }),
    });

    const { result } = renderHook(() => useAIComposer());

    let returnedSpec: CompositionSpec | null = null;
    await act(async () => {
      returnedSpec = await result.current.compose('show something');
    });

    expect(returnedSpec).toBeNull();
    expect(result.current.error).toMatch(/limit/i);
  });

  it('compose() sets status to loading immediately then idle on completion', async () => {
    let resolveResponse: (value: unknown) => void;
    const pending = new Promise((res) => { resolveResponse = res; });
    mockFetch.mockReturnValue(pending.then(() => ({
      ok: true,
      status: 200,
      json: async () => ({ spec: VALID_SPEC, repairAttempts: 0 }),
    })));

    const { result } = renderHook(() => useAIComposer());

    expect(result.current.status).toBe('idle');

    let composeProm: Promise<CompositionSpec | null>;
    act(() => {
      composeProm = result.current.compose('show projects');
    });

    // Status should be loading before response arrives (NFR-AS-PERF-002)
    expect(result.current.status).toBe('loading');

    await act(async () => {
      resolveResponse!(undefined);
      await composeProm!;
    });

    expect(result.current.status).toBe('idle');
  });
});
