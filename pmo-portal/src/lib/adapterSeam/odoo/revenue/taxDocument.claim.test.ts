import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: vi.fn() } }));
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: h.dispatch }));

import { ODOO_WORKFLOWS } from '../workflowDeclarations.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { type InvoiceMaps, type PmoInvoice } from './invoiceBody.ts';
import { bindCall } from '../client.ts';
import { createOdooRevenueAdapter } from '../revenueAdapter.ts';
import type { AdapterCommand } from '../../contract.ts';
import { repositories } from '@/src/lib/repositories';
import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';

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
    const odooGeneratedClaim = /(?=.*odoo)(?=.*(tax\s*doc|dokumen\s*pajak|efaktur|e-faktur|faktur\s*pajak|coretax)).*(generat|issu|terbit|dibuat|dihasilkan|unduh|download|export|ekspor|mirrored|tersedia di odoo|held by odoo|provided by odoo)/i;

    // The honest unavailable/none line is not a claim.
    const negated = /tidak\s+(tersedia|dibuat|ada)|unavailable|not\s+available|no\s+tax|none|tanpa/i;
    const violatingStrings = allStrings.filter(
      (item) => !negated.test(item.value) && (odooGeneratedClaim.test(item.value) || odooGeneratedClaim.test(item.path)),
    );

    expect(violatingStrings).toEqual([]);
  });
});

describe('AC-OCI-084 e-Faktur flows: no call to a tax authority and no Odoo tax-document field written', () => {
  it('hand-recording e-Faktur on an Odoo-owned org stays in PMO, and the invoice push writes no tax-document field', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    const taxAuthorityCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      taxAuthorityCalls.push(String(input instanceof Request ? input.url : input));
      throw new Error('no network expected');
    }) as typeof fetch;
    h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    h.dispatch.mockReset();
    clearOwnershipCache();
    setTaskOwnership([{ domain: 'revenue', externalTier: 'odoo' }]);

    try {
      // 1. Shipped hand-record path (EfakturModal -> useRevenue.setEfaktur -> repository -> DD-EFK-1 RPC).
      await repositories.revenue.setEfaktur('77777777-7777-4777-8777-777777777777', {
        efakturNumber: '010.001-26.12345678',
        efakturDate: '2026-11-03',
      });
      expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(['set_sales_invoice_efaktur']);
      expect(h.dispatch).not.toHaveBeenCalled();
      expect(fake.calls).toEqual([]);

      // 2. Shipped invoice push, carrying the hand-recorded facts on the command.
      const maps: InvoiceMaps = {
        companyCurrency: 'IDR',
        partners: { 'cust-1': 41 },
        items: { 'item-a': { productId: 71, incomeAccountId: 149 } },
        units: { km: 11 },
        costAccountId: 101,
        taxIds: [5],
      };
      const input: PmoInvoice = {
        id: '77777777-7777-4777-8777-777777777777',
        customerId: 'cust-1',
        invoiceDate: '2026-11-03',
        currency: 'IDR',
        referenceNumber: 'PO-77',
        lines: [{ itemId: 'item-a', description: 'Survey', quantity: 1, unitPrice: 1000, unit: 'km' }],
      };
      fake.seed('account.tax', [{ id: 5, name: 'PPN 11%', amount: 11 }]);
      fake.seed('product.product', [{ id: 71, name: 'Survey', taxes_id: [5], income_account_id: 149 }]);
      fake.seed('res.partner', [{ id: 41, name: 'Client' }]);
      const adapter = createOdooRevenueAdapter({
        call: bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch }),
        resolveInvoice: async () => ({ input, maps, expect: { total: '1110.00', costAccountId: 101 } }),
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
          efaktur_number: '010.001-26.12345678',
          efaktur_date: '2026-11-03',
        },
      };
      await adapter.commit(cmd);

      // Recorded AFTER both actions: the push reached Odoo, and nothing touched a tax authority or tax-document field.
      expect(fake.calls.length).toBeGreaterThan(0);
      expect(taxAuthorityCalls).toEqual([]);
      const taxField = /tax_doc|efaktur|coretax|l10n_id/i;
      expect(fake.calls.filter((c) => taxField.test(c.method) || taxField.test(c.model))).toEqual([]);
      for (const row of [...fake.rows('account.move'), ...fake.rows('account.move.line')]) {
        expect(Object.keys(row).filter((k) => taxField.test(k))).toEqual([]);
      }
    } finally {
      globalThis.fetch = originalFetch;
      clearOwnershipCache();
    }
  });
});
