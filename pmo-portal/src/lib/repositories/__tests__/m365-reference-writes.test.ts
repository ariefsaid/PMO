import { describe, expect, it } from 'vitest';
import {
  assertMicrosoftReference,
  itemKind,
  validMicrosoftBrowserUrl,
} from '../../../../../supabase/functions/_shared/microsoftDocumentReference';

describe('Microsoft document reference validation', () => {
  it('AC-M365DOC-062 accepts only credential-free HTTPS browser URLs', () => {
    expect(validMicrosoftBrowserUrl('https://example.invalid/document')).toBe(true);
    expect(validMicrosoftBrowserUrl('http://example.invalid/document')).toBe(false);
    expect(validMicrosoftBrowserUrl('https://user:pass@example.invalid/document')).toBe(false);
    expect(validMicrosoftBrowserUrl('https://example.invalid/a b')).toBe(false);
    expect(validMicrosoftBrowserUrl('not a URL')).toBe(false);
    expect(validMicrosoftBrowserUrl('https://example.invalid/\u0001')).toBe(false);
  });

  it('AC-M365DOC-062 determines kind from one and only one Graph facet', () => {
    expect(itemKind({ name: 'folder.PDF', folder: {} })).toBe('folder');
    expect(itemKind({ name: 'document', file: {} })).toBe('file');
    expect(itemKind({ file: {}, folder: {} })).toBeNull();
    expect(itemKind({ name: 'document.PDF' })).toBeNull();
  });

  it('AC-M365DOC-062 refuses incomplete or unsafe references without echoing input', () => {
    const ref = {
      drive_id: 'synthetic-drive',
      item_id: 'synthetic-item',
      web_url: 'https://example.invalid/document',
      name: 'Synthetic document',
      item_kind: 'file' as const,
    };
    expect(() => assertMicrosoftReference(ref)).not.toThrow();
    expect(() => assertMicrosoftReference({ ...ref, web_url: 'https://user:pass@example.invalid/x' }))
      .toThrowError('Invalid Microsoft reference');
    expect(() => assertMicrosoftReference({ ...ref, name: '  ' }))
      .toThrowError('Invalid Microsoft reference');
    expect(() => assertMicrosoftReference({ ...ref, item_kind: 'other' as never }))
      .toThrowError('Invalid Microsoft reference');
  });
});
