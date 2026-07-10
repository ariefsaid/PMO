import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../supabase/client.ts', () => ({ supabase: { functions: { invoke: h.invoke } } }));

import { dispatchTaskCommand } from './dispatchClient.ts';
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

  it('falls back to the raw error message when the body is not parseable JSON', async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: { message: 'network error', context: undefined },
    });
    await expect(dispatchTaskCommand('delete', { id: 't1' })).rejects.toBeInstanceOf(AppError);
    await expect(dispatchTaskCommand('delete', { id: 't1' })).rejects.toMatchObject({ message: 'network error' });
  });

  it('throws when invoke resolves with no error but also no data', async () => {
    h.invoke.mockResolvedValue({ data: null, error: null });
    await expect(dispatchTaskCommand('create', { id: 't1' })).rejects.toBeInstanceOf(AppError);
  });
});
