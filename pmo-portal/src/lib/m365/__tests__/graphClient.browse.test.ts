import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke } } }));

import { browseOneDrive } from '../graphClient';

describe('Graph metadata browse transport', () => {
  beforeEach(() => invoke.mockReset());

  it('AC-M365DOC-013 requests metadata through graph_proxy and returns only allowlisted entries', async () => {
    invoke.mockResolvedValue({ data: { value: [{
      id: 'synthetic-item', name: 'Synthetic item', webUrl: 'https://example.invalid/item',
      parentReference: { driveId: 'synthetic-drive', path: '/drive/root:/Folder' },
      file: { mimeType: 'application/pdf', hashes: { quickXorHash: 'secret' } },
      cTag: 'synthetic-ctag', downloadUrl: 'https://example.invalid/download?secret',
      access_token: 'synthetic-token',
    }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=x' }, error: null });

    const page = await browseOneDrive({ path: '/me/drive/root/children' });
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: {
      action: 'graph_proxy', method: 'GET', path: '/me/drive/root/children',
      query: { '$top': '100' },
    } });
    expect(page.value).toEqual([{
      drive_id: 'synthetic-drive', item_id: 'synthetic-item',
      web_url: 'https://example.invalid/item', name: 'Synthetic item', item_kind: 'file',
      parent_path: '/drive/root:/Folder', content_tag: 'synthetic-ctag', sharepoint_ids: null,
    }]);
    expect(page.unsupported_count).toBe(0);
    expect(JSON.stringify(page)).not.toMatch(/downloadUrl|secret|access_token|synthetic-token/);
  });

  it('refuses malformed successful envelopes with reviewed safe copy', async () => {
    invoke.mockResolvedValue({ data: { value: 'not-an-array', secret: 'synthetic-secret' }, error: null });
    await expect(browseOneDrive({ path: '/me/drive/root/children' })).rejects.toMatchObject({
      code: 'BAD_REQUEST', message: 'Microsoft could not load these items. Please try again.',
    });
  });
});
