import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke } } }));

import { browseOneDrive, listSites, listDrives, getPersonalDrive, listChildren, parseNextLink } from '../graphClient';
import { scopeCoversPath } from '../../../../../supabase/functions/m365-token-custody/proxy';

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

  it('AC-M365DOC-054 builds site, library and child GETs accepted by the shipped scope gate', async () => {
    invoke.mockImplementation((_name, options?: { body?: { path?: string } }) => Promise.resolve(
      options?.body?.path === '/me/drive'
        ? { data: { id: 'personal-drive', name: 'OneDrive', webUrl: 'https://example.invalid/drive' }, error: null }
        : { data: { value: [] }, error: null },
    ));
    await listSites();
    await listDrives('site-id');
    await listChildren('drive-id');
    await listChildren('drive-id', 'folder-id');
    await getPersonalDrive();
    const bodies = invoke.mock.calls.map((call) => call[1].body as { method: string; path: string; query?: Record<string, string> });
    expect(bodies).toEqual([
      { action: 'graph_proxy', method: 'GET', path: '/sites', query: { search: '*', '$top': '100' } },
      { action: 'graph_proxy', method: 'GET', path: '/sites/site-id/drives', query: { '$top': '100' } },
      { action: 'graph_proxy', method: 'GET', path: '/drives/drive-id/root/children', query: { '$top': '100' } },
      { action: 'graph_proxy', method: 'GET', path: '/drives/drive-id/items/folder-id/children', query: { '$top': '100' } },
      { action: 'graph_proxy', method: 'GET', path: '/me/drive' },
    ]);
    for (const request of bodies) {
      expect(scopeCoversPath(['Files.Read', 'Files.Read.All', 'Sites.Read.All'], 'GET', request.path)).toBe(true);
      expect(scopeCoversPath(['Files.Read', 'Files.Read.All', 'Sites.Read.All'], 'POST', request.path)).toBe(false);
      expect(request.path).not.toMatch(/mail|content/i);
    }
    expect(scopeCoversPath(['Files.Read', 'Files.Read.All', 'Sites.Read.All'], 'GET', '/me/messages')).toBe(false);
    expect(() => listDrives('../mail')).toThrow();
    expect(() => listChildren('drive%2Fmail')).toThrow();
  });

  it('AC-M365DOC-067 parses only same-resource Graph cursors and pins the page size', () => {
    const initial = { path: '/drives/synthetic-drive/root/children', query: { '$top': '100' } };
    expect(parseNextLink('https://graph.microsoft.com/v1.0/drives/synthetic-drive/root/children?$top=100&$skiptoken=opaque', initial))
      .toEqual({ path: initial.path, query: { '$top': '100', '$skiptoken': 'opaque' } });
    for (const unsafe of [
      'https://example.invalid/v1.0/drives/synthetic-drive/root/children?$top=100',
      'https://graph.microsoft.com/v1.0/drives/other/root/children?$top=100',
      'https://user:pass@graph.microsoft.com/v1.0/drives/synthetic-drive/root/children?$top=100',
      'https://graph.microsoft.com/v1.0/drives/synthetic-drive/root/children/content?$top=100',
      'https://graph.microsoft.com/v1.0/drives/synthetic-drive/root/children?$top=101',
      'https://graph.microsoft.com/v1.0/drives/synthetic-drive/root/children?$top=100&download=1',
    ]) expect(() => parseNextLink(unsafe, initial)).toThrow();
  });

  it('AC-M365DOC-067 rejects server pages larger than the bounded 100 entries', async () => {
    invoke.mockResolvedValue({ data: { value: Array(101).fill({}) }, error: null });
    await expect(browseOneDrive({ path: '/me/drive/root/children' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses malformed successful envelopes with reviewed safe copy', async () => {
    invoke.mockResolvedValue({ data: { value: 'not-an-array', secret: 'synthetic-secret' }, error: null });
    await expect(browseOneDrive({ path: '/me/drive/root/children' })).rejects.toMatchObject({
      code: 'BAD_REQUEST', message: 'Microsoft could not load these items. Please try again.',
    });
  });
});
