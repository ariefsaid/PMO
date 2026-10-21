import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { safeRecordFolderName, sanitizeRecordFolderName } from './microsoftRecordFolder.ts';

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

Deno.test('AC-M365DOC-070 SharePoint-illegal prefixes and fragments are made safe, idempotently', () => {
  assertEquals(sanitizeRecordFolderName('~$Budget'), '~-Budget');
  assertEquals(sanitizeRecordFolderName('A_vti_B'), 'A_vti-B');
  assertEquals(sanitizeRecordFolderName('a_VTI_b'), 'a_vti-b');
  assertEquals(sanitizeRecordFolderName('~ not special'), '~ not special');
  assertEquals(sanitizeRecordFolderName(sanitizeRecordFolderName('~$x_vti_')), sanitizeRecordFolderName('~$x_vti_'));
});

Deno.test('AC-M365DOC-070 a name that IS a Windows device name gets a fixed suffix; longer names are untouched', () => {
  for (const name of ['CON', 'con', 'Prn', 'AUX', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9']) {
    assertEquals(safeRecordFolderName(name), `${name} folder`, name);
    assertEquals(safeRecordFolderName(safeRecordFolderName(name)), `${name} folder`, `${name} idempotent`);
  }
  for (const name of ['CONSOLE', 'CON x', 'COM10', 'LPT', 'P-1 Alpha', '']) {
    assertEquals(safeRecordFolderName(name), name, name);
  }
});

Deno.test('AC-M365DOC-070 names are NFC-normalised so an NFD-named folder matches and no duplicate is made', () => {
  const nfd = 'Caf\u0065\u0301 P-1'; // "Cafe" + combining acute
  const nfc = 'Caf\u00e9 P-1';
  assertEquals(sanitizeRecordFolderName(nfd), nfc);
  assertEquals(sanitizeRecordFolderName(nfc), nfc);
});

Deno.test('AC-M365DOC-070 bidi, zero-width, C1 and line-separator characters are replaced like reserved characters', () => {
  const rtl = 'P-1 \u202Egnp.exe\u202C name'; // right-to-left override
  assertEquals(sanitizeRecordFolderName(rtl), 'P-1  gnp.exe  name');
  for (const ch of ['\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069', '\u200E', '\u200F',
    '\u200B', '\u200C', '\u200D', '\uFEFF', '\u0080', '\u009F', '\u2028', '\u2029']) {
    assertEquals(sanitizeRecordFolderName(`A${ch}B`), 'A B', `U+${ch.codePointAt(0)!.toString(16)}`);
  }
});
