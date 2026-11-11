import { describe, it, expect } from 'vitest';
import { validateFile, validateFileSignature } from './validateFile';
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

const bytes = (name: string, ...b: number[]) => new File([new Uint8Array(b)], name);
const PK = [0x50, 0x4b, 0x03, 0x04];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('validateFileSignature', () => {
  it.each([
    ['a.pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ['a.png', PNG],
    ['a.jpg', [0xff, 0xd8, 0xff, 0xe0]],
    ['a.jpeg', [0xff, 0xd8, 0xff]],
    ['a.docx', PK],
    ['a.xlsx', PK],
    ['a.pptx', PK],
  ])('accepts %s with matching bytes', async (name, b) => {
    expect(await validateFileSignature(bytes(name, ...b))).toEqual({ ok: true });
  });

  it.each([
    ['a.pdf', PNG],
    ['a.png', [0xff, 0xd8, 0xff]],
    ['a.jpg', PNG],
    ['a.docx', [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ['a.xlsx', [0x4d, 0x5a, 0x90, 0x00]],
    ['a.pptx', [0x50, 0x4b]],
    ['a.pdf', []],
  ])('rejects renamed %s whose bytes do not match', async (name, b) => {
    expect(await validateFileSignature(bytes(name, ...b))).toEqual({
      ok: false,
      message: 'File content does not match its type',
    });
  });

  it('is case-insensitive on the extension', async () => {
    expect(await validateFileSignature(bytes('A.PDF', 0x25, 0x50, 0x44, 0x46, 0x2d))).toEqual({ ok: true });
  });

  it('leaves types without a signature rule to the name check', async () => {
    expect(await validateFileSignature(bytes('a.csv', 1, 2, 3))).toEqual({ ok: true });
  });
});
