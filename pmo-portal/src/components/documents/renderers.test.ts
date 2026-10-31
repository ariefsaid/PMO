import { describe, expect, it } from 'vitest';
import { ALLOWED_FILE_TYPES, VIEWABLE_EXTENSIONS } from '@/src/lib/fileConstants';
import { officeViewerUrl, selectRenderer } from './renderers';

describe('document-preview AC-005 selectRenderer matrix', () => {
  it.each([
    ['a.pdf', 'native-pdf'],
    ['A.PDF', 'native-pdf'],
    ['a.png', 'native-image'],
    ['a.JPG', 'native-image'],
    ['a.jpeg', 'native-image'],
    ['a.webp', 'native-image'],
    ['a.docx', 'office-online'],
    ['a.xlsx', 'office-online'],
    ['a.pptx', 'office-online'],
    ['a.doc', 'office-online'],
    ['a.xls', 'office-online'],
    ['a.ppt', 'office-online'],
    ['a.csv', 'unsupported'],
    ['a.txt', 'unsupported'],
    ['a.dwg', 'unsupported'],
    ['a.dxf', 'unsupported'],
    ['a.zip', 'unsupported'],
    ['readme', 'unsupported'],
    ['', 'unsupported'],
    ['a/b.pdf', 'native-pdf'],
    ['dir.pdf/readme', 'unsupported'],
  ] as const)('private %s -> %s', (name, expected) => {
    expect(selectRenderer({ name, source: 'private' })).toBe(expected);
  });

  it('a Microsoft source always asks Microsoft, whatever the name', () => {
    for (const name of ['a.pdf', 'a.dwg', 'noext', '']) expect(selectRenderer({ name, source: 'microsoft' })).toBe('microsoft');
  });

  it('preview support never widens upload acceptance (NFR-006)', () => {
    expect(ALLOWED_FILE_TYPES).toEqual(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.docx', '.xlsx', '.pptx', '.dwg', '.dxf', '.csv', '.txt']);
    expect(VIEWABLE_EXTENSIONS).toEqual(expect.arrayContaining(['.pdf', '.docx', '.xlsx', '.pptx', '.png']));
  });

  it('wraps a fresh signed URL for the public Office viewer, encoded', () => {
    expect(officeViewerUrl('https://s.test/a.docx?token=x&y=1')).toBe(
      `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent('https://s.test/a.docx?token=x&y=1')}`,
    );
  });
});
