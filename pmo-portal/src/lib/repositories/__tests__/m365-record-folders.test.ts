import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke } } }));

import { repositories } from '../index';
import { AppError } from '@/src/lib/appError';

const ID = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';

beforeEach(() => invoke.mockReset());

describe('AC-M365DOC-071/072 — m365RecordFolders repository', () => {
  it('ensure goes through the custody transport', async () => {
    invoke.mockResolvedValueOnce({ data: { state: 'linked', document_id: DOC }, error: null });
    await expect(repositories.m365RecordFolders.ensure({ kind: 'procurement', id: ID }))
      .resolves.toEqual({ state: 'linked', document_id: DOC });
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', {
      body: { action: 'ensure_record_folder', kind: 'procurement', id: ID },
    });
  });

  it('linkExisting goes through the custody transport', async () => {
    invoke.mockResolvedValueOnce({
      data: { scanned: 0, linked: 0, needs_choice: 0, missing: 0, failed: 0, skipped: 0, next: null },
      error: null,
    });
    await repositories.m365RecordFolders.linkExisting();
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'link_existing_record_folders' } });
  });

  it('preserves the AppError code of a classified failure', async () => {
    const response = { clone: () => response, json: async () => ({ error: 'SCOPE_INSUFFICIENT' }), status: 403 };
    invoke.mockResolvedValueOnce({ data: null, error: { context: response } });
    const err = await repositories.m365RecordFolders.ensure({ kind: 'project', id: ID }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('SCOPE_INSUFFICIENT');
  });
});
