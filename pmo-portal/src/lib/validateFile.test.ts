import { describe, it, expect } from 'vitest';
import { validateFile } from './validateFile';
import { MAX_FILE_SIZE_BYTES } from './fileConstants';

describe('validateFile', () => {
  it('AC-DOC-090: rejects file exceeding 5 MB with the approved copy', () => {
    const file = new File(['oversize'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: MAX_FILE_SIZE_BYTES + 1 });

    expect(validateFile(file)).toEqual({
      ok: false,
      message: 'File exceeds 5 MB limit',
    });
  });

  it('AC-DOC-031 AC-DOC-091: rejects disallowed .zip files with the approved copy', () => {
    const file = new File(['content'], 'archive.zip', { type: 'application/zip' });

    expect(validateFile(file)).toEqual({
      ok: false,
      message: 'File type not allowed (.zip)',
    });
  });

  it('AC-DOC-031 AC-DOC-091: rejects disallowed .exe files with the approved copy', () => {
    const file = new File(['content'], 'program.exe', { type: 'application/octet-stream' });

    expect(validateFile(file)).toEqual({
      ok: false,
      message: 'File type not allowed (.exe)',
    });
  });

  it('accepts allowed files within the shared limits', () => {
    const file = new File(['content'], 'drawing.pdf', { type: 'application/pdf' });

    expect(validateFile(file)).toEqual({ ok: true });
  });
});
