import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockTrackAgentComposeViewSaved = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/analytics', () => ({ trackAgentComposeViewSaved: mockTrackAgentComposeViewSaved }));

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViewMutations: () => ({ create: { mutateAsync: mockCreate } }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' } }),
}));

import { useComposeArtifact } from './useComposeArtifact';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

const spec = { version: 1, panels: [] } as unknown as CompositionSpec;

beforeEach(() => {
  mockTrackAgentComposeViewSaved.mockClear();
  mockCreate.mockReset();
});

describe('useComposeArtifact analytics', () => {
  it('AC-APH-013 agent_compose_view_saved fires on successful save with run_id', async () => {
    mockCreate.mockResolvedValue({ id: 'view-1' });
    const { result } = renderHook(() => useComposeArtifact(spec, 'run-1'));
    await act(async () => { await result.current.save('My View'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(mockTrackAgentComposeViewSaved).toHaveBeenCalledWith('run-1');
  });

  it('does not fire agent_compose_view_saved when save fails', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useComposeArtifact(spec, 'run-1'));
    await act(async () => { await result.current.save('My View'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('error'));
    expect(mockTrackAgentComposeViewSaved).not.toHaveBeenCalled();
  });

  it('does not fire agent_compose_view_saved when saved without a runId', async () => {
    mockCreate.mockResolvedValue({ id: 'view-1' });
    const { result } = renderHook(() => useComposeArtifact(spec));
    await act(async () => { await result.current.save('My View'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(mockTrackAgentComposeViewSaved).not.toHaveBeenCalled();
  });
});
