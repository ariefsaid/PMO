import { describe, expect, it } from 'vitest';
import { safePdfFilename } from './invoicePdfFilename';

describe('safePdfFilename', () => {
  it('AC-PDF-012 keeps an ordinary ERP invoice number as-is', () => {
    expect(safePdfFilename('ACC-SINV-2026-00001')).toBe('ACC-SINV-2026-00001.pdf');
  });

  it('AC-PDF-012 replaces every unsafe character run with one hyphen and trims the ends', () => {
    expect(safePdfFilename('INV/2026 "x"\r\n;evil')).toBe('INV-2026-x-evil.pdf');
    expect(safePdfFilename('../../etc/passwd')).toBe('etc-passwd.pdf');
  });

  it('AC-PDF-012 falls back to invoice.pdf when nothing safe is left', () => {
    expect(safePdfFilename('')).toBe('invoice.pdf');
    expect(safePdfFilename('///')).toBe('invoice.pdf');
  });

  it('AC-PDF-012 caps the name at 104 characters and only ever emits the safe alphabet', () => {
    const name = safePdfFilename('A'.repeat(300));
    expect(name).toHaveLength(104);
    expect(name).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
  });
});
