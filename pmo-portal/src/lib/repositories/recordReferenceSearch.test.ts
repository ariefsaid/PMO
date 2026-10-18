import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/src/lib/appError';

const dal = vi.hoisted(() => ({ searchRecordReferences: vi.fn() }));
vi.mock('@/src/lib/db/recordReferenceSearch', () => dal);

import { searchRecordReferencesRepository } from './recordReferenceSearch';

const page = {
  items: [{
    kind: 'project' as const,
    id: 'project-id',
    title: 'Synthetic service project',
    context: null,
    reference: 'PO-2026-081',
    aliases: ['PO-2026-081'],
    exact: true,
  }],
  hasMore: false,
};

beforeEach(() => vi.clearAllMocks());

describe('recordReferenceSearchRepository (AC-S40-003)', () => {
  it('AC-S40-003: delegates the exact query and returns the typed bounded page', async () => {
    dal.searchRecordReferences.mockResolvedValueOnce(page);

    await expect(searchRecordReferencesRepository('PO-2026-081')).resolves.toEqual(page);
    expect(dal.searchRecordReferences).toHaveBeenCalledWith('PO-2026-081');
  });

  it('AC-S40-003: normalizes thrown PostgREST-shaped failures to AppError', async () => {
    dal.searchRecordReferences.mockRejectedValueOnce({ message: 'synthetic RLS denial', code: '42501' });
    const request = searchRecordReferencesRepository('PO-2026');

    await expect(request).rejects.toMatchObject({
      name: 'AppError',
      message: 'synthetic RLS denial',
      code: '42501',
    });
    await expect(request).rejects.toBeInstanceOf(AppError);
  });
});
