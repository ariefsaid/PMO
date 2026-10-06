/**
 * #520 — the user-chosen ERPNext "Purchase Taxes and Charges Template" for a vendor invoice on a flipped org. Same
 * mechanism as the sales side (`erpSalesTaxRows.ts`, DD-PBL-12b): ERPNext does NOT expand a template named over REST,
 * so the dispatch reads the chosen template and sends its rows itself, alongside the template name.
 *
 * The choice is validated here, server-side: it must be an ENABLED template of the binding's company. A choice that is
 * not is refused (config-rejected) — never silently replaced by the default, and never sent untaxed.
 */
import { AppError } from '../../appError.ts';
import { AdapterError } from '../contract.ts';
import { getDoc, listDocsByFilters, type ErpClientDeps } from './client.ts';

export interface ErpPurchaseTaxRow {
  charge_type: 'On Net Total';
  account_head: string;
  description: string;
  rate: number;
  category: 'Total' | 'Valuation' | 'Valuation and Total';
  add_deduct_tax: 'Add' | 'Deduct';
}

const TEMPLATE = 'Purchase Taxes and Charges Template';
const CATEGORIES = ['Total', 'Valuation', 'Valuation and Total'] as const;
const ADD_DEDUCT = ['Add', 'Deduct'] as const;

/** The picker's options: the company's enabled purchase tax templates (names only). */
export async function listPurchaseTaxTemplates(deps: ErpClientDeps, company: string): Promise<Array<{ name: string }>> {
  const rows = await listDocsByFilters(deps, TEMPLATE, [['company', '=', company], ['disabled', '=', 0]], ['name'], 200);
  return rows.map((row) => ({ name: String(row.name) }));
}

export async function resolvePurchaseTaxRows(deps: ErpClientDeps, company: string, templateName: string): Promise<ErpPurchaseTaxRow[]> {
  const notUsable = `The purchase tax template "${templateName}" is not an enabled Purchase Taxes and Charges Template of ${company} in ERPNext. Pick another template (or ERPNext default), then record the invoice again.`;
  const found = await listDocsByFilters(deps, TEMPLATE, [['name', '=', templateName], ['company', '=', company], ['disabled', '=', 0]], ['name'], 2);
  if (found.length !== 1) throw new AppError(notUsable, 'config-rejected');
  const template = (await getDoc(deps, TEMPLATE, templateName)) as { company?: unknown; disabled?: unknown; taxes?: Array<Record<string, unknown>> } | null;
  if (!template || template.company !== company || Number(template.disabled) !== 0) throw new AppError(notUsable, 'config-rejected');
  const rows: ErpPurchaseTaxRow[] = [];
  for (const row of template.taxes ?? []) {
    if (row.charge_type !== 'On Net Total') {
      throw new AdapterError('commit-rejected', `The purchase tax template "${templateName}" has a "${String(row.charge_type)}" row; only "On Net Total" rows can be sent for a vendor invoice`);
    }
    const account = typeof row.account_head === 'string' ? row.account_head : '';
    const rate = Number(row.rate);
    const category = row.category ?? 'Total';
    const addDeduct = row.add_deduct_tax ?? 'Add';
    if (!account || !Number.isFinite(rate)
        || !(CATEGORIES as readonly unknown[]).includes(category) || !(ADD_DEDUCT as readonly unknown[]).includes(addDeduct)) {
      throw new AdapterError('commit-rejected', `The purchase tax template "${templateName}" has an incomplete row`);
    }
    rows.push({
      charge_type: 'On Net Total', account_head: account,
      description: typeof row.description === 'string' && row.description ? row.description : account,
      rate, category: category as ErpPurchaseTaxRow['category'], add_deduct_tax: addDeduct as ErpPurchaseTaxRow['add_deduct_tax'],
    });
  }
  if (rows.length === 0) {
    throw new AppError(`The purchase tax template "${templateName}" has no tax rows in ERPNext. Add its rows in ERPNext (or pick another template), then record the invoice again.`, 'config-rejected');
  }
  return rows;
}
