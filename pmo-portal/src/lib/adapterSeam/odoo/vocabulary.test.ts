/** AC-ODC-083 (NFR-ODC-009) — Odoo model names stay below the adapter contract. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PORTAL = new URL('../../../../', import.meta.url).pathname;
const ODOO_VOCABULARY = [
  'res.partner', 'res.company', 'product.product', 'product.template', 'uom.uom', 'stock.warehouse', 'stock.location',
  'account.account', 'account.tax', 'account.analytic.account', 'account.analytic.plan', 'purchase.order', 'account.move',
  'account.move.line', 'account.payment', 'account.payment.register', 'account.journal', 'l10n_id_efaktur_coretax.document',
  'move_type', 'invoice_line_ids', 'invoice_date_due', 'payment_state', 'reversed_entry_id',
  'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual', 'analytic_distribution', 'tax_ids', 'product_id',
  'price_unit', 'journal_id', 'partner_type', 'destination_account_id',
  'payment_method_line_id', 'inbound_payment_method_line_id', 'l10n_id_kode_transaksi', 'l10n_id_coretax_efaktur_available',
  'l10n_id_coretax_document', 'l10n_id_add_info_07', 'l10n_id_add_info_08', 'l10n_id_facility_info_07',
  'l10n_id_facility_info_08', 'l10n_id_custom_doc', 'l10n_id_custom_doc_month_year',
];

/** A model named in code is a string literal (`account.account` alone is also a JS property access). */
const literals = (models: readonly string[]) => models.flatMap((m) => ["'", '"', '`'].flatMap((q) => ['-e', `${q}${m}${q}`]));

function outsideTheOdooAdapter(vocabulary: readonly string[], paths = ['src', 'pages']): string[] {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '--untracked', '-n', '-F', ...literals(vocabulary), '--', ...paths], { cwd: PORTAL, encoding: 'utf8' });
  } catch (e) {
    if ((e as { status?: number }).status !== 1) throw e; // 1 = no match; anything else is a broken guard, not a pass
  }
  return out.split('\n').filter(Boolean).filter((l) => !l.startsWith('src/lib/adapterSeam/odoo/'));
}

describe('AC-ODC-083 Odoo model names stay below the adapter contract', () => {
  it('appear in pmo-portal/src and pages only under adapterSeam/odoo/', () => {
    expect(outsideTheOdooAdapter(ODOO_VOCABULARY)).toEqual([]);
  });

  it('the scan finds the adapter\'s own model literals, so an empty result above is not a blind scan', () => {
    const inAdapter = execFileSync('git', ['grep', '-l', '-F', ...literals(ODOO_VOCABULARY), '--', 'src/lib/adapterSeam/odoo'], { cwd: PORTAL, encoding: 'utf8' });
    expect(inAdapter).toMatch(/connectAdapter\.ts/);
  });

  it('AC-OCI-093 catches model, revenue-field and tax-document vocabulary outside the adapter', () => {
    const probeDir = mkdtempSync(`${PORTAL}/src/odoo-vocabulary-probe-`);
    const probeFile = `${probeDir}/probe.ts`;
    writeFileSync(probeFile, [
      "export const model = 'account.move';",
      "export const revenueField = 'amount_total';",
      "export const taxField = 'l10n_id_coretax_document';",
    ].join('\n'));
    try {
      const result = outsideTheOdooAdapter(ODOO_VOCABULARY, [relative(PORTAL, probeFile)]);
      expect(result).toHaveLength(3);
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });
});
