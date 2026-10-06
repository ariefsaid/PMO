/**
 * Explicit `taxes` rows for a billing-claim Sales Invoice (#766 / DD-PBL-12b). ERPNext does NOT expand a tax template
 * named over REST (spike 2026-10-06), so the dispatch reads the company's default Sales Taxes and Charges template and
 * sends its rows itself: `On Net Total`, so tax lands on the net total AFTER the down-payment recovery line.
 * An org with no default template gets no rows (tax-free), exactly as an ordinary invoice does.
 *
 * `fraction` is the contract's reduced tax base (#798/0227 tax_base_numerator/denominator): the row rate is scaled by it,
 * so ERP taxes the same reduced base PMO records.
 */
import { AdapterError } from '../contract.ts';
import { getDoc, listDocsByFilters, type ErpClientDeps } from './client.ts';

export interface ErpTaxRow { charge_type: 'On Net Total'; account_head: string; description: string; rate: number }

const TEMPLATE = 'Sales Taxes and Charges Template';

export async function resolveSalesTaxRows(
  deps: ErpClientDeps,
  company: string,
  fraction: { numerator: number; denominator: number } = { numerator: 1, denominator: 1 },
): Promise<ErpTaxRow[]> {
  const found = await listDocsByFilters(deps, TEMPLATE, [['company', '=', company], ['is_default', '=', 1], ['disabled', '=', 0]], ['name'], 2);
  if (found.length === 0) return [];
  const template = (await getDoc(deps, TEMPLATE, String(found[0].name))) as { taxes?: Array<Record<string, unknown>> } | null;
  const rows: ErpTaxRow[] = [];
  for (const row of template?.taxes ?? []) {
    if (row.charge_type !== 'On Net Total') {
      throw new AdapterError('commit-rejected', `The default sales tax template "${String(found[0].name)}" has a "${String(row.charge_type)}" row; only "On Net Total" rows can be sent for a billing claim`);
    }
    const account = typeof row.account_head === 'string' ? row.account_head : '';
    const rate = Number(row.rate);
    if (!account || !Number.isFinite(rate)) throw new AdapterError('commit-rejected', `The default sales tax template "${String(found[0].name)}" has an incomplete row`);
    const scaled = Math.round(rate * fraction.numerator / fraction.denominator * 1e6) / 1e6;
    rows.push({ charge_type: 'On Net Total', account_head: account, description: typeof row.description === 'string' && row.description ? row.description : account, rate: scaled });
  }
  return rows;
}
