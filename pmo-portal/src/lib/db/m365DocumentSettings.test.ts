import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, select, maybeSingle, upsert, single } = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(), upsert: vi.fn(), single: vi.fn(),
}));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));

import { getDefaultLibrary, setDefaultLibrary } from './m365DocumentSettings';

const library = {
  site_id: 'synthetic-site', site_name: 'Synthetic site',
  drive_id: 'synthetic-drive', drive_name: 'Synthetic library',
};

describe('organization Microsoft document settings DAL', () => {
  beforeEach(() => {
    from.mockReset(); select.mockReset(); maybeSingle.mockReset(); upsert.mockReset(); single.mockReset();
    const query = { select, maybeSingle, upsert, single };
    from.mockReturnValue(query);
    select.mockReturnValue(query);
    upsert.mockReturnValue(query);
  });

  it('reads the complete default tuple or returns null when no default is set', async () => {
    maybeSingle.mockResolvedValue({ data: {
      default_site_id: library.site_id, default_site_name: library.site_name,
      default_drive_id: library.drive_id, default_drive_name: library.drive_name,
    }, error: null });
    await expect(getDefaultLibrary()).resolves.toEqual(library);
    expect(from).toHaveBeenCalledWith('org_m365_document_settings');
    expect(select).toHaveBeenCalledWith('default_site_id,default_site_name,default_drive_id,default_drive_name');
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getDefaultLibrary()).resolves.toBeNull();
  });

  it('sets and clears by upserting only the tuple, letting RLS stamp org and actor', async () => {
    const thenable = Promise.resolve({ data: [{ org_id: 'synthetic-org' }], error: null });
    upsert.mockReturnValue({ select: vi.fn().mockReturnValue(thenable) });
    await setDefaultLibrary(library);
    expect(upsert).toHaveBeenNthCalledWith(1, {
      default_site_id: library.site_id, default_site_name: library.site_name,
      default_drive_id: library.drive_id, default_drive_name: library.drive_name,
    }, { onConflict: 'org_id' });
    expect(JSON.stringify(upsert.mock.calls[0][0])).not.toMatch(/org_id|updated_by|updated_at/);
    await setDefaultLibrary(null);
    expect(upsert).toHaveBeenNthCalledWith(2, {
      default_site_id: null, default_site_name: null, default_drive_id: null, default_drive_name: null,
    }, { onConflict: 'org_id' });
  });
});
