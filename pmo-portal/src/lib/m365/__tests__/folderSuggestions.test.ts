import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchDrive, browseOneDrive } = vi.hoisted(() => ({ searchDrive: vi.fn(), browseOneDrive: vi.fn() }));
vi.mock('../graphClient', () => ({ searchDrive, browseOneDrive }));

import { suggestFolders } from '../folderSuggestions';
import type { GraphItem, GraphPage } from '../graphClient';

const library = { site_id: 'site-1', site_name: 'Synthetic site', drive_id: 'drive-1', drive_name: 'Synthetic library' };
const folder = (name: string, path: string, driveId = library.drive_id, kind: 'folder' | 'file' = 'folder'): GraphItem => ({
  drive_id: driveId, item_id: `${name}-id`, web_url: 'https://example.invalid/item', name,
  item_kind: kind, parent_path: path, content_tag: null, sharepoint_ids: null,
});
const page = (value: GraphItem[], next: GraphPage<GraphItem>['next'] = null): GraphPage<GraphItem> => ({ value, next });

beforeEach(() => { searchDrive.mockReset(); browseOneDrive.mockReset(); });

describe('bounded convention folder suggestions', () => {
  it('AC-M365DOC-057 filters by full prefix, folder facet, matching drive and exact convention path', async () => {
    searchDrive.mockResolvedValue(page([
      folder('PRJ-A Design', '/drives/drive-1/root:/Projects'),
      folder('XPRJ-A substring', '/drives/drive-1/root:/Projects'),
      folder('PRJ-A deeper', '/drives/drive-1/root:/Projects/Archive'),
      folder('PRJ-A other drive', '/drives/drive-1/root:/Projects', 'drive-2'),
      folder('PRJ-A file', '/drives/drive-1/root:/Projects', library.drive_id, 'file'),
    ]));
    await expect(suggestFolders(library, { kind: 'project', code: 'prj-a' }))
      .resolves.toEqual([folder('PRJ-A Design', '/drives/drive-1/root:/Projects')]);
    expect(searchDrive).toHaveBeenCalledWith('drive-1', 'prj-a');
  });

  it('AC-M365DOC-057 uses the procurement UTC year at the date boundary', async () => {
    const context = { kind: 'procurement' as const, request_number: 'REQ-26', created_at: '2027-01-01T00:30:00+02:00' };
    const expected = folder('REQ-26 Main', '/drives/drive-1/root:/Procurement/2026');
    searchDrive.mockResolvedValue(page([
      expected,
      folder('REQ-26 Wrong local year', '/drives/drive-1/root:/Procurement/2027'),
    ]));
    await expect(suggestFolders(library, context)).resolves.toEqual([expected]);
    expect(searchDrive).toHaveBeenCalledWith('drive-1', 'REQ-26');
  });

  it('AC-M365DOC-057 stops safely at three incomplete pages', async () => {
    const cursor = { path: '/drives/drive-1/root/search', query: { '$top': '100', '$skiptoken': 'cursor' } };
    searchDrive.mockResolvedValueOnce(page([], cursor));
    browseOneDrive.mockResolvedValueOnce(page([], cursor)).mockResolvedValueOnce(page([], cursor));
    await expect(suggestFolders(library, { kind: 'project', code: 'A' })).resolves.toEqual([]);
    expect(browseOneDrive).toHaveBeenCalledTimes(2);
  });

  it('AC-M365DOC-057 returns no suggestions after an incomplete three-page search and bypasses budget search', async () => {
    const cursor = { path: '/drives/drive-1/root/search', query: { '$top': '100', '$skiptoken': 'cursor' } };
    searchDrive.mockResolvedValueOnce(page([], cursor));
    browseOneDrive.mockResolvedValueOnce(page([], cursor)).mockResolvedValueOnce(page([], cursor));
    await expect(suggestFolders(library, { kind: 'project', code: 'A' })).resolves.toEqual([]);
    expect(searchDrive).toHaveBeenCalledTimes(1);
    searchDrive.mockClear();
    await expect(suggestFolders(library, { kind: 'budget' })).resolves.toEqual([]);
    expect(searchDrive).not.toHaveBeenCalled();
  });
});
