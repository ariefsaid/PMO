import { beforeEach, describe, expect, it, vi } from 'vitest';

const { update, eq, select, from, storage, functions } = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
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
    storage.from.mockReset();
    functions.invoke.mockReset();
    const query = { update, eq, select };
    update.mockReturnValue(query);
    eq.mockReturnValue(query);
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

  it('refuses malformed references before any database call', async () => {
    await expect(repositories.document.linkMicrosoftDocument('document-1', {
      ...reference,
      web_url: 'https://user:pass@example.invalid/document',
    })).rejects.toMatchObject({ code: '23514', details: 'm365-reference-invalid' });
    expect(from).not.toHaveBeenCalled();
  });
});
