import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ proposeNumber: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { project: { proposeNumber: h.proposeNumber } } }));

import { useProjectNumberProposal } from './useProjectNumberProposal';

beforeEach(() => vi.clearAllMocks());

describe('AC-CODE-002 project number proposal state', () => {
  it('requests one proposal for the selected client and exposes loading then success', async () => {
    let resolve!: (value: string) => void;
    h.proposeNumber.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    const { result } = renderHook(() => useProjectNumberProposal('client-1', true));
    expect(result.current.status).toBe('loading');
    expect(h.proposeNumber).toHaveBeenCalledWith('client-1');
    await act(async () => resolve('PRJ-26-0001'));
    await waitFor(() => expect(result.current).toMatchObject({ status: 'success', number: 'PRJ-26-0001' }));
  });

  it('ignores a late response after a different client is selected', async () => {
    let resolveFirst!: (value: string) => void;
    h.proposeNumber
      .mockReturnValueOnce(new Promise<string>((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce('PRJ-26-0002');
    const { result, rerender } = renderHook(({ client }) => useProjectNumberProposal(client, true), {
      initialProps: { client: 'client-1' },
    });
    rerender({ client: 'client-2' });
    await waitFor(() => expect(result.current.number).toBe('PRJ-26-0002'));
    await act(async () => resolveFirst('STALE-0001'));
    expect(result.current.number).toBe('PRJ-26-0002');
  });

  it('does not reserve a number while disabled for header edit', () => {
    const { result } = renderHook(() => useProjectNumberProposal('client-1', false));
    expect(h.proposeNumber).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ status: 'idle', number: null });
  });

  it('keeps the number absent and exposes the RPC failure without inventing one', async () => {
    h.proposeNumber.mockRejectedValue(new Error('project_number_client_segment_required'));
    const { result } = renderHook(() => useProjectNumberProposal('client-1', true));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.number).toBeNull();
    expect(result.current.error).toContain('client_segment_required');
  });
});
