/**
 * #520 — the user-chosen ERPNext "Purchase Taxes and Charges Template" for a vendor invoice on a flipped org. Same
 * mechanism as the sales side (`erpSalesTaxRows.ts`, DD-PBL-12b): ERPNext does NOT expand a template named over REST,
 * so the dispatch reads the chosen template and sends its rows itself, alongside the template name.
 *
 * The choice is validated here, server-side: it must be an ENABLED template of the binding's company. A choice that is
 * not is refused (config-rejected) — never silently replaced by the default, and never sent untaxed. Each row is copied
 * with every field ERPNext computes it from (including `included_in_print_rate`), so the invoice totals exactly as the
 * template would.
 *
 * #876 (DD-VWH-4, ADR-0082): withholding (PPh) rows — `add_deduct_tax: 'Deduct'` — are sent when well-formed, because
 * the vendor-invoice mirror records them (`withheld_amount`, 0266). A malformed one is refused before any ERP write: a
 * negative rate anywhere (a negative Add row is withholding ERPNext would not count as deducted), a rate above 100%, a
 * Deduct row not counted in the Total only, a Deduct row included in the item price, a Deduct row whose account is not
 * a Liability, or Deduct rates adding up to 100% or more. Messages name the template, never the company or an account.
 */
import { AppError } from '../../appError.ts';
import { AdapterError } from '../contract.ts';
import { erpnextRequest, getDoc, listDocsByFilters, type ErpClientDeps } from './client.ts';

export interface ErpPurchaseTaxRow {
  charge_type: 'On Net Total';
  account_head: string;
  description: string;
  rate: number;
  category: 'Total' | 'Valuation' | 'Valuation and Total';
  add_deduct_tax: 'Add' | 'Deduct';
  included_in_print_rate: 0 | 1;
  cost_center?: string;
}

const TEMPLATE = 'Purchase Taxes and Charges Template';
const CATEGORIES = ['Total', 'Valuation', 'Valuation and Total'] as const;
const ADD_DEDUCT = ['Add', 'Deduct'] as const;
const PAGE = 200;
function malformedWithholding(templateName: string, reason: string): AppError {
  return new AppError(
    `The purchase tax template "${templateName}" withholds tax in a way PMO cannot record: ${reason}. Ask your ERP administrator to correct the template (or pick another), then record the invoice again.`,
    'config-rejected',
  );
}

/** The picker's options: the company's enabled purchase tax templates (names only), paged to the end. */
export async function listPurchaseTaxTemplates(deps: ErpClientDeps, company: string): Promise<Array<{ name: string }>> {
  const out: Array<{ name: string }> = [];
  for (let start = 0; ; start += PAGE) {
    const params = new URLSearchParams({
      filters: JSON.stringify([['company', '=', company], ['disabled', '=', 0]]), fields: JSON.stringify(['name']),
      order_by: 'name asc', limit_start: String(start), limit_page_length: String(PAGE),
    });
    const res = await erpnextRequest(deps, { method: 'GET', path: `/api/resource/${encodeURIComponent(TEMPLATE)}?${params}` });
    const data = (res as { data?: Array<Record<string, unknown>> } | null)?.data ?? [];
    out.push(...data.map((row) => ({ name: String(row.name) })));
    if (data.length < PAGE) return out;
  }
}

export async function resolvePurchaseTaxRows(deps: ErpClientDeps, company: string, templateName: string): Promise<ErpPurchaseTaxRow[]> {
  const notUsable = `The purchase tax template "${templateName}" is not an enabled Purchase Taxes and Charges Template for this company in ERPNext. Pick another template (or ERPNext default), then record the invoice again.`;
  const found = await listDocsByFilters(deps, TEMPLATE, [['name', '=', templateName], ['company', '=', company], ['disabled', '=', 0]], ['name'], 2);
  if (found.length !== 1) throw new AppError(notUsable, 'config-rejected');
  const template = (await getDoc(deps, TEMPLATE, templateName)) as { company?: unknown; disabled?: unknown; taxes?: Array<Record<string, unknown>> } | null;
  if (!template || template.company !== company || Number(template.disabled) !== 0) throw new AppError(notUsable, 'config-rejected');
  const rows: ErpPurchaseTaxRow[] = [];
  let withheldRate = 0;
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
    if (rate < 0) throw malformedWithholding(templateName, 'a row has a negative rate');
    if (rate > 100) throw malformedWithholding(templateName, 'a row has a rate above 100%');
    const included: 0 | 1 = Number(row.included_in_print_rate) === 1 ? 1 : 0;
    if (addDeduct === 'Deduct') {
      if (category !== 'Total') throw malformedWithholding(templateName, 'a withholding row must count toward the invoice total only');
      if (included === 1) throw malformedWithholding(templateName, 'a withholding row cannot be included in the item price');
      const ledger = (await getDoc(deps, 'Account', account)) as { root_type?: unknown } | null;
      if (ledger?.root_type !== 'Liability') {
        throw malformedWithholding(templateName, 'a withholding row must post to a tax-payable (liability) account');
      }
      withheldRate += rate;
    }
    const costCenter = typeof row.cost_center === 'string' && row.cost_center ? row.cost_center : '';
    rows.push({
      charge_type: 'On Net Total', account_head: account,
      description: typeof row.description === 'string' && row.description ? row.description : account,
      rate, category: category as ErpPurchaseTaxRow['category'],
      add_deduct_tax: addDeduct as ErpPurchaseTaxRow['add_deduct_tax'],
      included_in_print_rate: included,
      ...(costCenter ? { cost_center: costCenter } : {}),
    });
  }
  if (withheldRate >= 100) throw malformedWithholding(templateName, 'its withholding rates add up to 100% or more');
  if (rows.length === 0) {
    throw new AppError(`The purchase tax template "${templateName}" has no tax rows in ERPNext. Add its rows in ERPNext (or pick another template), then record the invoice again.`, 'config-rejected');
  }
  return rows;
}
