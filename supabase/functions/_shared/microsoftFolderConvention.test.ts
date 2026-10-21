import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { folderNameMatchesCode, folderSearchRequest, parseFolderSearchNext } from './microsoftFolderConvention.ts';

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
