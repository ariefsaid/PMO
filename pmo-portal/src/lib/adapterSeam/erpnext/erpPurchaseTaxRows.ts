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
import { ErpError, erpnextRequest, getDoc, listDocsByFilters, type ErpClientDeps } from './client.ts';

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

/** A withholding row's ledger account; a missing (404) or unreadable (403) one reads as unknown, so the caller refuses it
 *  neutrally — ERPNext's own error text names the account. Anything else (5xx, network) propagates as before. */
async function readAccount(deps: ErpClientDeps, account: string): Promise<{ root_type?: unknown } | null> {
  try {
    return (await getDoc(deps, 'Account', account)) as { root_type?: unknown } | null;
  } catch (err) {
    if (err instanceof ErpError && (err.status === 404 || err.status === 403)) return null;
    throw err;
  }
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
  const notUsable = `The purchase tax template "${templateName}" is not an enabled Purchase Taxes and Charges Template for this company in ERPNext. Pick another template (or enter the tax amounts), then record the invoice again.`;
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
      const ledger = await readAccount(deps, account);
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

// ── #876 slice 2 (OD-VWH-1, DD-VWH-13/22, ADR-0084): tax AMOUNTS entered in PMO, sent as fixed `Actual` rows ──────

/** The vendor-bill tax accounts an Admin set in Administration → Accounting (organizations, migration 0272). */
export interface VendorTaxAccounts {
  inputVat: string | null;
  pph23: string | null;
  pph4_2: string | null;
}

/** The tax entered on the bill. `pphType` is null exactly when nothing is withheld. */
export interface EnteredPurchaseTax {
  vatAmount: number;
  withheldAmount: number;
  pphType: 'pph23' | 'pph4_2' | null;
}

export interface ErpActualTaxRow {
  charge_type: 'Actual';
  account_head: string;
  description: string;
  tax_amount: number;
  category: 'Total';
  add_deduct_tax: 'Add' | 'Deduct';
  included_in_print_rate: 0;
}

export const ENTERED_TAX_AND_TEMPLATE = 'Choose an ERPNext tax template or enter the tax amounts — not both.';
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const PPH_LABEL = { pph23: 'PPh 23', pph4_2: 'PPh 4(2)' } as const;
const SETTING_LABEL = { inputVat: 'Input VAT account', pph23: 'PPh 23 payable account', pph4_2: 'PPh 4(2) payable account' } as const;

/**
 * The command's entered amounts, shape-checked with NO reads, so a malformed one is refused before any ERP call.
 * Null when the command carries none of `vatAmount` / `withheldAmount` / `pphType` (template or ERPNext-default path).
 */
export function parseEnteredPurchaseTax(record: Record<string, unknown>): EnteredPurchaseTax | null {
  if (!('vatAmount' in record) && !('withheldAmount' in record) && !('pphType' in record)) return null;
  const money = (value: unknown, label: string): number => {
    if (typeof value !== 'number' || !MONEY.test(String(value))) {
      throw new AdapterError('commit-rejected', `The vendor invoice's ${label} must be zero or a positive amount with at most two decimals.`);
    }
    return value;
  };
  const vatAmount = money(record.vatAmount ?? 0, 'VAT amount');
  const withheldAmount = money(record.withheldAmount ?? 0, 'tax withheld');
  const type = record.pphType ?? null;
  if (type !== null && type !== 'pph23' && type !== 'pph4_2') {
    throw new AdapterError('commit-rejected', 'The withholding type must be PPh 23 or PPh 4(2).');
  }
  if (withheldAmount > 0 && type === null) {
    throw new AdapterError('commit-rejected', 'Say whether the tax withheld is PPh 23 or PPh 4(2).');
  }
  return { vatAmount, withheldAmount, pphType: withheldAmount > 0 ? type : null };
}

/**
 * The setting's account, when it is a non-group account of the binding's company (a PPh account: a Liability). The
 * refusal names the SETTING, never the account or the company (ADR-0072).
 */
async function usableAccount(
  deps: ErpClientDeps, company: string, name: string | null, setting: keyof typeof SETTING_LABEL, liability: boolean,
): Promise<string> {
  const label = SETTING_LABEL[setting];
  const account = name?.trim() ?? '';
  if (!account) {
    throw new AppError(`Set the ${label} in Administration → Accounting before recording this tax on a vendor invoice.`, 'config-rejected');
  }
  const doc = (await readAccount(deps, account)) as { company?: unknown; is_group?: unknown; root_type?: unknown } | null;
  if (!doc || doc.company !== company || Number(doc.is_group) !== 0 || (liability && doc.root_type !== 'Liability')) {
    throw new AppError(
      `The ${label} in Administration → Accounting is not a usable ${liability ? 'tax-payable (liability) ' : ''}account of this organization's ERPNext company. Correct it, then record the invoice again.`,
      'config-rejected',
    );
  }
  return account;
}

/**
 * The fixed rows for the entered amounts: VAT `Add` on the input-VAT account, PPh `Deduct` on the type's payable
 * account; a zero amount sends no row. Withholding above the items total is refused FIRST, before any read — ERPNext
 * would accept it and the mirror's `withheld ≤ amount` bound would then refuse every replay (DD-VWH-22).
 */
export async function buildEnteredPurchaseTaxRows(
  deps: ErpClientDeps, company: string, entered: EnteredPurchaseTax, accounts: VendorTaxAccounts, itemsTotal: number | null,
): Promise<ErpActualTaxRow[]> {
  if (itemsTotal !== null && Math.round(entered.withheldAmount * 100) > Math.round(itemsTotal * 100)) {
    throw new AdapterError('commit-rejected', "The tax withheld is larger than the invoice's items total before tax. Check the PPh amount on the vendor's invoice.");
  }
  const rows: ErpActualTaxRow[] = [];
  if (entered.vatAmount > 0) {
    rows.push({
      charge_type: 'Actual', account_head: await usableAccount(deps, company, accounts.inputVat, 'inputVat', false),
      description: 'VAT', tax_amount: entered.vatAmount, category: 'Total', add_deduct_tax: 'Add', included_in_print_rate: 0,
    });
  }
  if (entered.withheldAmount > 0 && entered.pphType) {
    rows.push({
      charge_type: 'Actual', account_head: await usableAccount(deps, company, accounts[entered.pphType], entered.pphType, true),
      description: PPH_LABEL[entered.pphType], tax_amount: entered.withheldAmount, category: 'Total', add_deduct_tax: 'Deduct',
      included_in_print_rate: 0,
    });
  }
  return rows;
}
