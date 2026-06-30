/**
 * useComposeArtifact tests — Tasks 10/11 (RED→GREEN).
 * AC-CV-006: valid spec → compiledPanels non-null, validationError null.
 * AC-CV-007: invalid spec → compiledPanels null, validationError UNKNOWN_ENTITY.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockMutateAsync, mockCurrentUser } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
  mockCurrentUser: { id: 'user-1', org_id: 'org-1' },
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViewMutations: () => ({
    create: { mutateAsync: mockMutateAsync },
  }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
}));

// Use the REAL compileCompositionSpec (the boundary must be genuine).
// No mock here — validates the hook correctly exercises the compiler.

import { useComposeArtifact } from './useComposeArtifact';

// ── Spec fixtures ──────────────────────────────────────────────────────────────

const VALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'KPITile',
      querySpec: {
        entity: 'projects',
        select: ['id'],
        aggregate: { fn: 'count', column: 'id', alias: 'count' },
      },
    },
  ],
};

const INVALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p-bad',
      primitive: 'KPITile',
      querySpec: {
        entity: 'secret_salaries' as 'projects', // unknown entity — bypasses TS for the test
        select: ['id'],
      },
    },
  ],
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useComposeArtifact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-CV-006 returns compiledPanels and null validationError for a valid spec', () => {
    const { result } = renderHook(() => useComposeArtifact(VALID_SPEC));

    expect(result.current.compiledPanels).not.toBeNull();
    expect(result.current.compiledPanels).toHaveLength(1);
    expect(result.current.validationError).toBeNull();
  });

  it('AC-CV-007 returns null compiledPanels and an UNKNOWN_ENTITY validationError for an unknown entity', () => {
    const { result } = renderHook(() => useComposeArtifact(INVALID_SPEC));

    expect(result.current.compiledPanels).toBeNull();
    expect(result.current.validationError).not.toBeNull();
    expect(result.current.validationError?.code).toBe('UNKNOWN_ENTITY');
  });

  it('initializes with idle saveStatus, null saveError, null savedViewId', () => {
    const { result } = renderHook(() => useComposeArtifact(VALID_SPEC));

    expect(result.current.saveStatus).toBe('idle');
    expect(result.current.saveError).toBeNull();
    expect(result.current.savedViewId).toBeNull();
  });

  it('save calls create.mutateAsync with name, spec, and scope private by default', async () => {
    mockMutateAsync.mockResolvedValueOnce({ id: 'new-view-1', name: 'Test View' });

    const { result } = renderHook(() => useComposeArtifact(VALID_SPEC));

    await act(async () => {
      await result.current.save('Test View');
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      name: 'Test View',
      spec: VALID_SPEC,
      scope: 'private',
    });
  });

  it('save sets saveStatus to saved and savedViewId on success', async () => {
    mockMutateAsync.mockResolvedValueOnce({ id: 'view-abc', name: 'Test View' });
    const { result } = renderHook(() => useComposeArtifact(VALID_SPEC));

    await act(async () => {
      await result.current.save('Test View');
    });

    expect(result.current.saveStatus).toBe('saved');
    expect(result.current.savedViewId).toBe('view-abc');
  });

  it('save sets saveStatus to error and saveError message on failure', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('network fail'));
    const { result } = renderHook(() => useComposeArtifact(VALID_SPEC));

    await act(async () => {
      await result.current.save('Test View');
    });

    expect(result.current.saveStatus).toBe('error');
    expect(result.current.saveError).toMatch(/update failed|could not save/i);
  });
});
