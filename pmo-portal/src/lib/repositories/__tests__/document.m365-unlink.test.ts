import { beforeEach, describe, expect, it, vi } from 'vitest';

const { update, eq, select, from, storage, functions } = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  storage: { from: vi.fn() },
  functions: { invoke: vi.fn() },
}));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from, storage, functions } }));

import { repositories } from '../index';

describe('document repository Microsoft unlink', () => {
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
    select.mockResolvedValue({ data: [{ id: 'document-1' }], error: null });
  });

  it('AC-M365DOC-041 clears the complete client-writable reference block in one update', async () => {
    await repositories.document.unlinkMicrosoftDocument('document-1');
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('project_documents');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      source: null,
      ms_drive_id: null,
      ms_item_id: null,
      ms_web_url: null,
      ms_item_name: null,
      ms_item_kind: null,
    });
    expect(eq).toHaveBeenCalledWith('id', 'document-1');
    expect(select).toHaveBeenCalledWith('id');
    expect(storage.from).not.toHaveBeenCalled();
    expect(functions.invoke).not.toHaveBeenCalled();
  });
});
