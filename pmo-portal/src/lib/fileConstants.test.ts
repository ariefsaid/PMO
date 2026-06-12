import { describe, it, expect } from 'vitest';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  ALLOWED_FILE_TYPES,
  SIGNED_URL_EXPIRY_SECONDS,
  PREVIEWABLE_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  FILE_MIME_BY_EXT,
} from './fileConstants';

describe('fileConstants', () => {
  it('AC-DOC-030: MAX_FILE_SIZE_BYTES = 5 MB (5,242,880 bytes)', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_FILE_SIZE_MB).toBe(5);
  });

  it('AC-DOC-031: ALLOWED_FILE_TYPES contains exactly the OD-DOC-5 list', () => {
    expect(ALLOWED_FILE_TYPES).toEqual([
      '.pdf', '.png', '.jpg', '.jpeg', '.webp',
      '.docx', '.xlsx', '.pptx',
      '.dwg', '.dxf',
      '.csv', '.txt',
    ]);
  });

  it('AC-DOC-031: zip and executables are NOT in the allowlist', () => {
    const exts = new Set(ALLOWED_FILE_TYPES);
    expect(exts.has('.zip')).toBe(false);
    expect(exts.has('.exe')).toBe(false);
    expect(exts.has('.bat')).toBe(false);
    expect(exts.has('.sh')).toBe(false);
  });

  it('AC-DOC-032: ALLOWED_MIME_TYPES matches ALLOWED_FILE_TYPES coverage', () => {
    expect(ALLOWED_MIME_TYPES.length).toBeGreaterThan(0);
    expect(ALLOWED_MIME_TYPES).toContain('application/pdf');
    expect(ALLOWED_MIME_TYPES).toContain('image/png');
    expect(ALLOWED_MIME_TYPES).toContain('text/plain');
    // DWG MIME coverage
    expect(ALLOWED_MIME_TYPES).toContain('application/acad');
  });

  it('AC-DOC-032: FILE_MIME_BY_EXT maps every allowed extension to a MIME type', () => {
    for (const ext of ALLOWED_FILE_TYPES) {
      expect(FILE_MIME_BY_EXT[ext]).toBeDefined();
      expect(typeof FILE_MIME_BY_EXT[ext]).toBe('string');
    }
  });

  it('FILE_MIME_BY_EXT: .dwg maps to application/acad (not octet-stream)', () => {
    expect(FILE_MIME_BY_EXT['.dwg']).toBe('application/acad');
    // application/octet-stream must NOT be in the bucket MIME list
    expect(ALLOWED_MIME_TYPES).not.toContain('application/octet-stream');
  });

  it('AC-DOC-011: SIGNED_URL_EXPIRY_SECONDS = 3600 (60 minutes)', () => {
    expect(SIGNED_URL_EXPIRY_SECONDS).toBe(3600);
  });

  it('PREVIEWABLE_EXTENSIONS = pdf, png, jpg, jpeg, webp', () => {
    expect(PREVIEWABLE_EXTENSIONS).toEqual(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);
  });
});