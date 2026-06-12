import { describe, it, expect } from 'vitest';
import { sanitizeFilename, buildStoragePath } from './storageKey';

describe('sanitizeFilename', () => {
  it('preserves alphanumeric, dots, hyphens, underscores', () => {
    expect(sanitizeFilename('Foundation-GA_rev.A.pdf')).toBe('foundation-ga-rev.a.pdf');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitizeFilename('foundation ga rev A.pdf')).toBe('foundation-ga-rev-a.pdf');
  });

  it('strips path separators and special chars', () => {
    expect(sanitizeFilename('../../etc/passwd.pdf')).toBe('etcpasswd.pdf');
    expect(sanitizeFilename('file<name>.pdf')).toBe('filename.pdf');
  });

  it('lowercases the result to prevent case-sensitivity collisions', () => {
    expect(sanitizeFilename('File.PDF')).toBe('file.pdf');
  });

  it('lowercases the full output including letters and extension', () => {
    expect(sanitizeFilename('Drawing-REV-C.DWG')).toBe('drawing-rev-c.dwg');
  });

  it('collapses consecutive hyphens into one', () => {
    expect(sanitizeFilename('A---B.pdf')).toBe('a-b.pdf');
  });

  it('returns a fallback name when fully stripped', () => {
    expect(sanitizeFilename('!!!')).toBe('file');
  });
});

describe('buildStoragePath', () => {
  it('produces lowercased {org_id}/{project_id}/{doc_id}/{filename}', () => {
    const result = buildStoragePath(
      'org-1', 'proj-1', 'doc-1', 'Drawing A.pdf',
    );
    expect(result).toBe('org-1/proj-1/doc-1/drawing-a.pdf');
  });
});