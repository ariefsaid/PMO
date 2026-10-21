import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { folderChildrenRequest, folderNameMatchesCode, folderSearchRequest, parseFolderSearchNext } from './microsoftFolderConvention.ts';

Deno.test('builds escaped bounded folder search and pins continuation', () => {
  const request = folderSearchRequest('synthetic-drive', "O'Brien");
  assertEquals(request.query?.$top, '100');
  assertEquals(decodeURIComponent(request.path).includes("O''Brien"), true);
  assertEquals(request.path.includes('%27%27'), true);
  const valid = parseFolderSearchNext(`https://graph.microsoft.com/v1.0${request.path}?$top=100&$skiptoken=abc`, request);
  assertEquals(valid?.path, request.path);
  assertEquals(valid?.query?.$skiptoken, 'abc');
  for (const link of [
    `https://graph.microsoft.com/v1.0${request.path}?$top=50`,
    `https://graph.microsoft.com/v1.0${request.path}?$top=100&$top=100`,
    `https://graph.microsoft.com/v1.0${request.path}?$top=100&foreign=x`,
    `https://evil.invalid${request.path}?$top=100`,
    `https://user:pass@graph.microsoft.com/v1.0${request.path}?$top=100`,
    `https://graph.microsoft.com/v1.0${request.path}?$top=100#frag`,
  ]) assertEquals(parseFolderSearchNext(link, request), null);
});

Deno.test('AC-M365DOC-069 strict code match: exact or code + separator, never a longer code', () => {
  for (const name of ['P-1', 'p-1', 'P-1 Alpha', 'p-1-alpha', 'P-1_x', 'P-1.x']) assertEquals(folderNameMatchesCode(name, 'P-1'), true, name);
  for (const name of ['P-10 Alpha', 'P-1a', 'XP-1', '', 'P-']) assertEquals(folderNameMatchesCode(name, 'P-1'), false, name);
  assertEquals(folderNameMatchesCode('anything', ''), false);
});

Deno.test('AC-M365DOC-069 continuation links compare DECODED paths: a literal or %27-encoded apostrophe both validate', () => {
  const request = folderSearchRequest('synthetic-drive', "O'Brien");
  // Shaped like a real Graph next link: apostrophes literal, parentheses literal, skiptoken appended.
  const literal = "https://graph.microsoft.com/v1.0/drives/synthetic-drive/root/search(q='O''Brien')?$top=100&$skiptoken=abc";
  const encoded = "https://graph.microsoft.com/v1.0/drives/synthetic-drive/root/search(q=%27O%27%27Brien%27)?$top=100&$skiptoken=abc";
  const mixed = "https://graph.microsoft.com/v1.0/drives/synthetic-drive/root/search(q=%27O''Brien%27)?$top=100&$skiptoken=abc";
  for (const link of [literal, encoded, mixed]) {
    const parsed = parseFolderSearchNext(link, request);
    assertEquals(parsed?.path, request.path, link);
    assertEquals(parsed?.query?.$skiptoken, 'abc', link);
  }
  // A different decoded query term, or an encoded slash / dot-dot, is still refused.
  assertEquals(parseFolderSearchNext("https://graph.microsoft.com/v1.0/drives/synthetic-drive/root/search(q='Other')?$top=100", request), null);
  assertEquals(parseFolderSearchNext("https://graph.microsoft.com/v1.0/drives/synthetic-drive/root/search(q='O%2FBrien')?$top=100", request), null);
});

Deno.test('AC-M365DOC-069 site ids with commas validate whether Graph sends them literal or encoded', () => {
  const initial = { path: `/sites/${encodeURIComponent('host.example.invalid,site-guid,web-guid')}/drives`, query: { $top: '100', $select: 'id' } };
  for (const segment of ['host.example.invalid,site-guid,web-guid', 'host.example.invalid%2Csite-guid%2Cweb-guid']) {
    const parsed = parseFolderSearchNext(`https://graph.microsoft.com/v1.0/sites/${segment}/drives?$top=100&$select=id&$skiptoken=t`, initial);
    assertEquals(parsed?.path, initial.path, segment);
  }
});

Deno.test('AC-M365DOC-069 children listing request is folder-id addressed, bounded, and its continuation keeps the pinned page size and select', () => {
  const request = folderChildrenRequest('synthetic-drive', 'abc=def');
  assertEquals(request.path, '/drives/synthetic-drive/items/abc%3Ddef/children');
  assertEquals(request.query?.$top, '200');
  assertEquals(request.query?.$select, 'id,name,webUrl,parentReference,folder,file');
  const base = `https://graph.microsoft.com/v1.0/drives/synthetic-drive/items/abc%3Ddef/children`;
  assertEquals(parseFolderSearchNext(`${base}?$top=200&$skiptoken=n2`, request)?.query?.$skiptoken, 'n2');
  assertEquals(parseFolderSearchNext(`${base}?$skiptoken=n2`, request)?.query?.$top, '200');
  for (const link of [
    `${base}?$top=100&$skiptoken=n2`,
    `${base}?$top=200&$select=id,name,permissions&$skiptoken=n2`,
    `https://graph.microsoft.com/v1.0/drives/synthetic-drive/items/other/children?$top=200`,
  ]) assertEquals(parseFolderSearchNext(link, request), null, link);
});

Deno.test('AC-M365DOC-069 an NFD-named existing folder still matches an NFC code', () => {
  assertEquals(folderNameMatchesCode('Caf\u0065\u0301-1 Alpha', 'Caf\u00e9-1'), true);
  assertEquals(folderNameMatchesCode('Caf\u00e9-10', 'Caf\u0065\u0301-1'), false);
});
