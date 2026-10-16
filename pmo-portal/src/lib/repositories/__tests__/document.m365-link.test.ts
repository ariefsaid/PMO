import { beforeEach, describe, expect, it, vi } from 'vitest';

const { update, eq, select, from, storage, functions, insert, single } = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
  storage: { from: vi.fn() },
  functions: { invoke: vi.fn() },
}));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
    storage,
    functions,
  },
}));

import { repositories } from '../index';
import { AppError } from '@/src/lib/appError';

const reference = {
  drive_id: 'synthetic-drive',
  item_id: 'synthetic-item',
  web_url: 'https://example.invalid/document',
  name: 'Synthetic document',
  item_kind: 'file' as const,
};

describe('document repository Microsoft linking', () => {
  beforeEach(() => {
    update.mockReset();
    eq.mockReset();
    select.mockReset();
    from.mockReset();
    insert.mockReset();
    single.mockReset();
    storage.from.mockReset();
    functions.invoke.mockReset();
    const query = { update, insert, eq, select, single };
    update.mockReturnValue(query);
    insert.mockReturnValue(query);
    eq.mockReturnValue(query);
    select.mockReturnValue(query);
    from.mockReturnValue(query);
  });

  it('AC-M365DOC-010 performs one RLS UPDATE with only the selected reference fields', async () => {
    select.mockResolvedValue({ data: [{ id: 'document-1' }], error: null });
    await repositories.document.linkMicrosoftDocument('document-1', reference);

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('project_documents');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      source: 'onedrive',
      ms_drive_id: reference.drive_id,
      ms_item_id: reference.item_id,
      ms_web_url: reference.web_url,
      ms_item_name: reference.name,
      ms_item_kind: reference.item_kind,
    });
    expect(eq).toHaveBeenCalledWith('id', 'document-1');
    expect(select).toHaveBeenCalledWith('id');
    expect(storage.from).not.toHaveBeenCalled();
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-010 preserves a database source-collision code and DETAIL', async () => {
    select.mockResolvedValue({
      data: null,
      error: { message: 'Cannot link this item.', code: '23514', details: 'm365-source-collision' },
    });

    const write = repositories.document.linkMicrosoftDocument('document-1', reference);
    await expect(write).rejects.toMatchObject({ code: '23514', details: 'm365-source-collision' });
    await expect(write).rejects.toBeInstanceOf(AppError);
  });

  it('AC-M365DOC-011 creates a linked Draft with one INSERT and server-owned stamps', async () => {
    const row = { id: 'document-1', status: 'Draft', file_path: null, author_id: 'actor-1' };
    single.mockResolvedValue({ data: row, error: null });

    await expect(repositories.document.create('project-1', {
      title: 'Evidence', category: 'Specification', code: '', revision: 'A', doc_date: '',
      source: 'onedrive', microsoft: reference,
    }, 'actor-1')).resolves.toMatchObject(row);

    expect(from).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      project_id: 'project-1', code: null, category: 'Specification', title: 'Evidence',
      revision: 'A', doc_date: null, author_id: 'actor-1', source: 'onedrive',
      ms_drive_id: reference.drive_id, ms_item_id: reference.item_id,
      ms_web_url: reference.web_url, ms_item_name: reference.name, ms_item_kind: 'file',
    });
    expect(insert.mock.calls[0][0]).not.toHaveProperty('ms_linked_by');
    expect(insert.mock.calls[0][0]).not.toHaveProperty('ms_linked_at');
    expect(update).not.toHaveBeenCalled();
    expect(storage.from).not.toHaveBeenCalled();
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it('rejects inconsistent source/reference input before insertion', async () => {
    await expect(repositories.document.create('project-1', {
      title: 'Evidence', category: 'Specification', code: '', revision: 'A', doc_date: '',
      source: 'onedrive',
    }, 'actor-1')).rejects.toMatchObject({ code: '23514', details: 'm365-reference-invalid' });
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses malformed references before any database call', async () => {
    await expect(repositories.document.linkMicrosoftDocument('document-1', {
      ...reference,
      web_url: 'https://user:pass@example.invalid/document',
    })).rejects.toMatchObject({ code: '23514', details: 'm365-reference-invalid' });
    expect(from).not.toHaveBeenCalled();
  });
});
