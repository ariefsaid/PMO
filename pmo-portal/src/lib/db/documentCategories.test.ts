import { describe, it, expect, vi, beforeEach } from 'vitest';

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from, rpc } }));

import * as dal from './documentCategories';
import { AppError } from '@/src/lib/appError';

/** The paged builder chain both lists use: select → order ×n → range. */
const select = (data: unknown, error: unknown = null) => {
  const chain = { range: () => Promise.resolve({ data, error }) } as Record<string, unknown>;
  chain.order = () => chain;
  return { select: () => chain };
};

beforeEach(() => { from.mockReset(); rpc.mockReset(); });

describe('document categories DAL (#2579)', () => {
  it('joins each category with its viewer roles', async () => {
    from.mockImplementation((name: string) => name === 'document_categories'
      ? select([{ id: 'c1', name: 'Invoice', is_system: false, sort_order: 20, archived_at: null }, { id: 'c2', name: 'Drawing', is_system: true, sort_order: 10, archived_at: null }])
      : select([{ category_id: 'c1', role: 'Finance' }, { category_id: 'c1', role: 'Admin' }]));
    const list = await dal.listDocumentCategories();
    expect(list.find((c) => c.id === 'c1')?.roles).toEqual(['Finance', 'Admin']);
    expect(list.find((c) => c.id === 'c2')?.roles).toEqual([]);
  });

  it('AC-DCV-020 sends the replaced set of roles to the management function, never an org id', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await dal.setCategoryRoles('c1', ['Admin', 'Executive']);
    expect(rpc).toHaveBeenCalledWith('set_document_category_roles', { p_id: 'c1', p_roles: ['Admin', 'Executive'] });
  });

  it('creates, renames, archives, restores, reorders and re-files through the functions', async () => {
    rpc.mockResolvedValue({ data: 'x', error: null });
    await dal.createCategory('  Invoice ', ['Finance']);
    await dal.renameCategory('c1', ' Bills ');
    await dal.archiveCategory('c1');
    await dal.restoreCategory('c1');
    await dal.reorderCategories(['c2', 'c1']);
    await dal.refileLineage('d1', 'c1');
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['create_document_category', 'rename_document_category', 'archive_document_category', 'restore_document_category', 'reorder_document_categories', 'refile_document_lineage']);
    expect(rpc.mock.calls[0][1]).toEqual({ p_name: 'Invoice', p_roles: ['Finance'] });
    expect(rpc.mock.calls[1][1]).toEqual({ p_id: 'c1', p_name: 'Bills' });
    expect(rpc.mock.calls[5][1]).toEqual({ p_document_id: 'd1', p_category_id: 'c1' });
  });

  it('throws an AppError that keeps the Postgres code and detail', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'A category with this name already exists', code: '23505', details: 'category-name-taken' } });
    await expect(dal.createCategory('Invoice', ['Admin'])).rejects.toMatchObject({ code: '23505', details: 'category-name-taken' });
    await expect(dal.createCategory('Invoice', ['Admin'])).rejects.toBeInstanceOf(AppError);
  });
});
