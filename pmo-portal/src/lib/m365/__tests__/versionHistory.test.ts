import { describe, expect, it } from 'vitest';
import { buildVersionHistoryUrl } from '../reference';
import type { GraphItem } from '../graphClient';

const item = (siteUrl: string | null, listId: string | null, listItemId: string | null): GraphItem => ({
  drive_id: 'synthetic-drive', item_id: 'synthetic-item', web_url: 'https://example.invalid/sites/synthetic/file',
  name: 'Synthetic file', item_kind: 'file', parent_path: null, content_tag: null,
  sharepoint_ids: siteUrl && listId && listItemId
    ? { site_url: siteUrl, list_id: listId, list_item_id: listItemId }
    : null,
});

const listId = 'aabbccdd-1122-3344-5566-778899aabbcc';

describe('SharePoint version history navigation', () => {
  it('AC-M365DOC-065 builds the version-history page from returned SharePoint identifiers', () => {
    expect(buildVersionHistoryUrl(item('https://example.invalid/sites/synthetic', listId, '12')))
      .toBe(`https://example.invalid/sites/synthetic/_layouts/15/Versions.aspx?list=%7B${listId}%7D&ID=12`);
  });

  it('AC-M365DOC-065 refuses guessed origins and malformed SharePoint identifiers', () => {
    expect(buildVersionHistoryUrl(item('https://other.invalid/sites/synthetic', listId, '12'))).toBeNull();
    expect(buildVersionHistoryUrl(item('https://example.invalid/sites/synthetic', 'not-a-uuid', '12'))).toBeNull();
    expect(buildVersionHistoryUrl(item('https://example.invalid/sites/synthetic', listId, '0'))).toBeNull();
    expect(buildVersionHistoryUrl(item('https://example.invalid/sites/synthetic', listId, '12/../content'))).toBeNull();
    expect(buildVersionHistoryUrl({ ...item(null, null, null), sharepoint_ids: null })).toBeNull();
  });
});
