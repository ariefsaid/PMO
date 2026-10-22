import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke } } }));

import {
  browseOneDrive, listSites, listDrives, getPersonalDrive, listChildren, browseSites, browseDrives,
  parseNextLink, searchDrive, listVersions, getItem, issueMicrosoftDocument,
  checkMicrosoftDocuments, refreshMicrosoftReferences,
} from '../graphClient';
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

  it('AC-M365DOC-057 escapes OData search terms and encodes opaque drive ids once', async () => {
    invoke.mockResolvedValue({ data: { value: [] }, error: null });
    await searchDrive('drive=opaque!id', "O'Brien");
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: {
      action: 'graph_proxy', method: 'GET', path: "/drives/drive%3Dopaque!id/root/search(q=%27O%27%27Brien%27)",
      query: { '$top': '100' },
    } });
  });

  it('validates drive segments before a metadata search', () => {
    invoke.mockResolvedValue({ data: { value: [] }, error: null });
    expect(() => searchDrive('../outside', 'drawing')).toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('continues site and library metadata pages through typed decoders', async () => {
    invoke.mockResolvedValueOnce({ data: { value: [{ id: 'site-1', name: 'Site', webUrl: 'https://example.invalid/site' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sites?$skiptoken=next' }, error: null });
    invoke.mockResolvedValueOnce({ data: { value: [{ id: 'site-2', name: 'Next', webUrl: 'https://example.invalid/next' }] }, error: null });
    const firstSites = await browseSites();
    expect(firstSites.value).toEqual([{ id: 'site-1', name: 'Site', web_url: 'https://example.invalid/site' }]);
    expect(firstSites.next).not.toBeNull();
    await browseSites(undefined, firstSites.next!);
    expect(invoke.mock.calls[1][1].body.path).toBe('/sites');
    expect(invoke.mock.calls[1][1].body.query).toEqual({ '$top': '100', '$skiptoken': 'next' });

    invoke.mockReset();
    invoke.mockResolvedValue({ data: { value: [{ id: 'drive-1', name: 'Library', webUrl: 'https://example.invalid/library' }] }, error: null });
    expect((await browseDrives('site-1')).value).toEqual([{ id: 'drive-1', name: 'Library', web_url: 'https://example.invalid/library' }]);
  });

  it('AC-M365DOC-065 reads metadata versions and item facets without requesting bytes', async () => {
    const ref = { drive_id: 'drive-id', item_id: 'item-id', web_url: 'https://example.invalid/item', name: 'Item', item_kind: 'file' as const };
    invoke.mockResolvedValueOnce({ data: { value: [{ id: '2.0', lastModifiedDateTime: '2026-10-14T00:00:00Z' }] }, error: null });
    await expect(listVersions(ref)).resolves.toMatchObject({
      value: [{ id: '2.0', modified_at: '2026-10-14T00:00:00Z' }],
    });
    expect(invoke).toHaveBeenLastCalledWith('m365-token-custody', { body: {
      action: 'graph_proxy', method: 'GET', path: '/drives/drive-id/items/item-id/versions',
      query: { '$top': '100', '$select': 'id,lastModifiedDateTime' },
    } });
    invoke.mockResolvedValueOnce({ data: {
      id: 'item-id', name: 'Item', webUrl: ref.web_url,
      parentReference: { driveId: 'drive-id' }, file: {}, cTag: 'ctag',
      sharepointIds: { siteUrl: 'https://example.invalid/sites/synthetic', listId: 'list-id', listItemId: '12' },
      downloadUrl: 'https://example.invalid/content',
    }, error: null });
    await getItem(ref);
    expect(invoke).toHaveBeenLastCalledWith('m365-token-custody', { body: {
      action: 'graph_proxy', method: 'GET', path: '/drives/drive-id/items/item-id',
      query: { '$select': 'id,name,webUrl,parentReference,file,folder,cTag,sharepointIds' },
    } });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/content|download/);
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

  it('AC-M365DOC-064 sends Issue without caller-authored transition or verification fields', async () => {
    invoke.mockResolvedValue({ data: { issued: true, verification: 'available' }, error: null });
    await issueMicrosoftDocument('10200000-0000-0000-0000-000000000301');
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: {
      action: 'issue_document', document_id: '10200000-0000-0000-0000-000000000301',
    } });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/baseline|actor|p_to|content_tag/);
  });

  it('AC-M365DOC-064 chunks checks at twenty and awaits each request sequentially', async () => {
    invoke.mockResolvedValue({ data: { checked: 1 }, error: null });
    const ids = Array.from({ length: 41 }, (_, index) =>
      `10200000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`
    );
    await checkMicrosoftDocuments(ids);
    expect(invoke.mock.calls.map(([, options]) => options.body.document_ids.length)).toEqual([20, 20, 1]);
    expect(invoke.mock.calls.every(([, options]) => options.body.action === 'check_documents')).toBe(true);
  });

  it('AC-M365DOC-062 refreshes with exactly one typed parent and identity pairs only', async () => {
    invoke.mockResolvedValue({ data: { refreshed: 1, checked: 0 }, error: null });
    await refreshMicrosoftReferences({
      project_id: '10200000-0000-0000-0000-000000000201',
      items: [{ drive_id: 'synthetic-drive', item_id: 'synthetic-item' }],
    });
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: {
      action: 'refresh_references', project_id: '10200000-0000-0000-0000-000000000201',
      items: [{ drive_id: 'synthetic-drive', item_id: 'synthetic-item' }],
    } });
    await expect(refreshMicrosoftReferences({
      project_id: '10200000-0000-0000-0000-000000000201',
      procurement_id: '10200000-0000-0000-0000-000000000202', items: [],
    } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
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
