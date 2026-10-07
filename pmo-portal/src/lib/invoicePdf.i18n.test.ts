import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';

type Tree = { [key: string]: string | Tree };
const invoicePdf = (catalogue: unknown): Record<string, string> =>
  (((catalogue as Tree).financeCopy as Tree)?.invoicePdf ?? {}) as Record<string, string>;
const SOURCES = ['pages/SalesInvoices.tsx', 'src/hooks/useInvoicePdfDownload.ts'];

describe('invoice PDF strings', () => {
  it('AC-PDF-014 every financeCopy.invoicePdf key exists, non-empty, in English and Indonesian', () => {
    const english = invoicePdf(en);
    const indonesian = invoicePdf(id);
    expect(Object.keys(english).sort()).toEqual([
      'documentMissing', 'download', 'failed', 'forbidden', 'notConnected',
      'notErpInvoice', 'notFound', 'notPermitted', 'notSubmitted', 'preparing',
      'sessionExpired', 'unreachable',
    ]);
    expect(Object.keys(indonesian).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of [...Object.entries(english), ...Object.entries(indonesian)]) {
      expect(typeof value === 'string' && value.trim() !== '', key).toBe(true);
    }
  });

  it('AC-PDF-014 every invoicePdf key the code uses is in the catalogue', () => {
    const english = invoicePdf(en);
    const used = SOURCES.flatMap((file) => [...readFileSync(join(process.cwd(), file), 'utf8')
      .matchAll(/'financeCopy\.invoicePdf\.([A-Za-z]+)'/g)].map((m) => m[1]));
    expect(new Set(used).size).toBe(12);
    expect(used.filter((key) => !(key in english))).toEqual([]);
  });
});
