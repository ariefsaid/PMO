import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ODOO_WORKFLOWS } from '../workflowDeclarations.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { buildInvoiceBody, type InvoiceMaps, type PmoInvoice } from './invoiceBody.ts';
import { bindCall } from '../client.ts';
import { createOdooRevenueAdapter } from '../revenueAdapter.ts';
import type { AdapterCommand } from '../../contract.ts';

/**
 * Scan all JSON files in a directory and extract every leaf string value.
 */
function scanLocaleStrings(dir: string): Array<{ file: string; path: string; value: string }> {
  const results: Array<{ file: string; path: string; value: string }> = [];

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = resolve(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith('.json')) {
        const content = JSON.parse(readFileSync(fullPath, 'utf-8'));
        extract(content, entry.replace('.json', ''));
      }
    }
  }

  function extract(obj: unknown, prefix: string) {
    if (typeof obj === 'string') {
      results.push({ file: prefix.split('.')[0] ?? '', path: prefix, value: obj });
    } else if (Array.isArray(obj)) {
      obj.forEach((item, index) => extract(item, `${prefix}[${index}]`));
    } else if (obj && typeof obj === 'object') {
      for (const [key, val] of Object.entries(obj)) {
        extract(val, `${prefix}.${key}`);
      }
    }
  }

  walk(dir);
  return results;
}

describe('AC-OCI-080 Odoo tax document capability declaration', () => {
  it('declares tax-document.read unavailable with a plain reason', () => {
    const declaration = ODOO_WORKFLOWS['tax-document.read'];
    expect(declaration.status).toBe('unavailable');
    expect(declaration.version).toBe(1);
    expect(declaration).toHaveProperty('reason');
    const reason = (declaration as { reason: string }).reason;
    expect(typeof reason).toBe('string');
    expect(reason.trim().length).toBeGreaterThan(0);
  });

  it('scans public/locales/en and public/locales/id and finds no label claiming an Odoo-generated tax document', () => {
    const localesBase = resolve(import.meta.dirname, '../../../../../public/locales');
    const enStrings = scanLocaleStrings(resolve(localesBase, 'en'));
    const idStrings = scanLocaleStrings(resolve(localesBase, 'id'));
    const allStrings = [...enStrings, ...idStrings];

    expect(allStrings.length).toBeGreaterThan(50);

    // Any label claiming Odoo generates, exports, or provides an Odoo tax document
    const odooGeneratedClaim = /(?=.*odoo)(?=.*(tax\s*doc|efaktur|e-faktur|faktur\s*pajak|coretax)).*(generat|issu|terbit|unduh|download|export|ekspor|mirrored|tersedia di odoo|held by odoo|provided by odoo)/i;

    const violatingStrings = allStrings.filter(
      (item) => odooGeneratedClaim.test(item.value) || odooGeneratedClaim.test(item.path),
    );

    expect(violatingStrings).toEqual([]);
  });
});

describe('AC-OCI-084 e-Faktur flows: no call to a tax authority and no Odoo tax-document field written', () => {
  it('makes no call to a tax authority and writes no tax-document field when recording sales or procurement e-Faktur', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    const taxAuthorityCalls: string[] = [];

    // Track any network call
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (/pajak|coretax|djp|tax-authority/i.test(url)) {
        taxAuthorityCalls.push(url);
      }
      if (url.includes('example.test') || url.includes('/json/2/')) {
        return fake.fetch(input, init);
      }
      return originalFetch(input, init);
    });
    globalThis.fetch = fetchSpy;

    try {
      // 1. Shipped e-Faktur flow: hand-recording e-Faktur on sales invoice or vendor bill
      // Both flows use PMO-native storage (DD-EFK-1); they do not touch Odoo or external tax authorities.
      const siEfakturPayload = { efakturNumber: '010.001-26.12345678', efakturDate: '2026-11-03' };
      const _viEfakturPayload = { efakturNumber: '010.002-26.87654321', efakturDate: '2026-11-04' };

      // Assert no calls reached tax authority during hand-recording
      expect(taxAuthorityCalls).toEqual([]);
      // Assert no calls reached Odoo during hand-recording
      expect(fake.calls).toEqual([]);

      // 2. Shipped e-Faktur flow: pushing an invoice that carries hand-recorded e-Faktur facts
      const maps: InvoiceMaps = {
        companyCurrency: 'IDR',
        partners: { 'cust-1': 41 },
        items: { 'item-a': { productId: 71, incomeAccountId: 149 } },
        units: { km: 11 },
        costAccountId: 101,
        taxIds: [5],
      };
      const input: PmoInvoice & { efaktur_number?: string; efaktur_date?: string } = {
        id: '77777777-7777-4777-8777-777777777777',
        customerId: 'cust-1',
        invoiceDate: '2026-11-03',
        currency: 'IDR',
        referenceNumber: 'PO-77',
        lines: [{ itemId: 'item-a', description: 'Survey', quantity: 1, unitPrice: 1000, unit: 'km' }],
        efaktur_number: siEfakturPayload.efakturNumber,
        efaktur_date: siEfakturPayload.efakturDate,
      };

      // Build invoice body: e-Faktur facts are PMO-only and excluded from Odoo payload
      const bodyResult = buildInvoiceBody(input, maps);
      expect(bodyResult.outcome).toBe('ready');
      if (bodyResult.outcome === 'ready') {
        const bodyStr = JSON.stringify(bodyResult.body);
        expect(bodyStr).not.toContain('efaktur');
        expect(bodyStr).not.toContain('coretax');
        expect(bodyStr).not.toContain('l10n_id');
        expect(bodyResult.body).not.toHaveProperty('l10n_id_coretax_document');
        expect(bodyResult.body).not.toHaveProperty('efaktur_number');
      }

      // Seed fake Odoo and push through Odoo revenue adapter
      fake.seed('account.tax', [{ id: 5, name: 'PPN 11%', amount: 11 }]);
      fake.seed('product.product', [{ id: 71, name: 'Survey', taxes_id: [5], income_account_id: 149 }]);
      fake.seed('res.partner', [{ id: 41, name: 'Client' }]);

      const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
      const adapter = createOdooRevenueAdapter({
        call,
        resolveInvoice: async () => ({
          input,
          maps,
          expect: { total: '1110.00', costAccountId: 101 },
        }),
      });

      const cmd: AdapterCommand = {
        domain: 'revenue',
        operation: 'transition',
        idempotencyKey: 'k-efaktur-test',
        record: {
          id: input.id,
          erp_doc_kind: 'sales-invoice',
          verb: 'submit',
          customerId: 'cust-1',
          efaktur_number: siEfakturPayload.efakturNumber,
          efaktur_date: siEfakturPayload.efakturDate,
        },
      };

      await adapter.commit(cmd);

      // Verify no call went to any tax authority
      expect(taxAuthorityCalls).toEqual([]);

      // Verify all Odoo calls: none went to a tax-document model or method
      const taxDocCalls = fake.calls.filter(
        (c) => /tax_doc|efaktur|coretax|download_efaktur/i.test(c.method) || /tax_doc|efaktur|coretax/i.test(c.model),
      );
      expect(taxDocCalls).toEqual([]);

      // Verify no tax-document field was written to account.move or lines
      const moves = fake.rows('account.move');
      expect(moves.length).toBeGreaterThan(0);
      for (const move of moves) {
        expect(move).not.toHaveProperty('l10n_id_coretax_document');
        expect(move).not.toHaveProperty('l10n_id_efaktur_coretax');
        expect(move).not.toHaveProperty('efaktur_number');
        expect(move).not.toHaveProperty('efaktur_date');
      }

      const moveLines = fake.rows('account.move.line');
      for (const line of moveLines) {
        expect(line).not.toHaveProperty('l10n_id_coretax_document');
        expect(line).not.toHaveProperty('efaktur_number');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
