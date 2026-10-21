import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { sanitizeRecordFolderName } from './microsoftRecordFolder.ts';

Deno.test('sanitizes SharePoint record folder names without adding a convention', () => {
  for (const character of ['"', '*', ':', '<', '>', '?', '/', '\\', '|']) {
    assertEquals(sanitizeRecordFolderName(`A${character}B`), 'A B');
  }
  assertEquals(sanitizeRecordFolderName('A*/B'), 'A  B');
  assertEquals(sanitizeRecordFolderName('  . ..  '), '');
  assertEquals(sanitizeRecordFolderName(' Interior  dots.name '), 'Interior  dots.name');
  assertEquals(sanitizeRecordFolderName('x'.repeat(121)), 'x'.repeat(120));
  assertEquals(Array.from(sanitizeRecordFolderName(`${'x'.repeat(119)}😀z`)).length, 120);
  assertEquals(sanitizeRecordFolderName(`${'x'.repeat(119)}.z`).endsWith('.'), false);
  assertEquals(sanitizeRecordFolderName(''), '');
});
