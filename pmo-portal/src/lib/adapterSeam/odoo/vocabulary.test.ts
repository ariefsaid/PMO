/** AC-ODC-083 (NFR-ODC-009) — Odoo model names stay below the adapter contract. */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const PORTAL = new URL('../../../../', import.meta.url).pathname;
const ODOO_VOCABULARY = [
  'res.partner', 'res.company', 'product.product', 'product.template', 'uom.uom', 'stock.warehouse', 'stock.location',
  'account.account', 'account.tax', 'account.analytic.account', 'account.analytic.plan', 'purchase.order', 'purchase.order.line',
  'stock.picking', 'stock.move', 'stock.backorder.confirmation', 'account.move', 'account.move.line', 'account.payment',
  'account.payment.register', 'ir.model.data', 'amount_untaxed', 'amount_tax', 'amount_residual', 'invoice_origin',
  'picking_type_code', 'purchase_line_id', 'reconciled_bill_ids', 'outbound_payment_method_line_ids',
];

/** A model named in code is a string literal (`account.account` alone is also a JS property access). */
const literals = (models: readonly string[]) => models.flatMap((m) => ["'", '"', '`'].flatMap((q) => ['-e', `${q}${m}${q}`]));

function outsideTheOdooAdapter(models: readonly string[]): string[] {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '--untracked', '-n', '-F', ...literals(models), '--', 'src', 'pages'], { cwd: PORTAL, encoding: 'utf8' });
  } catch (e) {
    if ((e as { status?: number }).status !== 1) throw e; // 1 = no match; anything else is a broken guard, not a pass
  }
  return out.split('\n').filter(Boolean).filter((l) => !l.startsWith('src/lib/adapterSeam/odoo/'));
}

describe('AC-ODC-083 Odoo model names stay below the adapter contract', () => {
  it('AC-OPP-083 keeps procurement vocabulary in the Odoo adapter seam', () => {
    expect(outsideTheOdooAdapter(ODOO_VOCABULARY)).toEqual([]);
  });

  it('the scan finds the adapter\'s own model literals, so an empty result above is not a blind scan', () => {
    const inAdapter = execFileSync('git', ['grep', '-l', '-F', ...literals(ODOO_VOCABULARY), '--', 'src/lib/adapterSeam/odoo'], { cwd: PORTAL, encoding: 'utf8' });
    expect(inAdapter).toMatch(/connectAdapter\.ts/);
  });
});
