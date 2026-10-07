/**
 * Purchase Invoice `toBody`/`fromDoc` — R9 §1 frozen. `toBody` sends exactly `{supplier, items:
 * [{item_code, qty, rate, description?, project?}], project?, bill_no?, bill_date?, taxes_and_charges?, taxes?}` (#520). ERPNext server-defaults
 * `credit_to`, `posting_date`/`due_date`, and all totals (docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md §1). `fromDoc` mirrors the header
 * `grand_total`/`outstanding_amount` as the money ORACLE (ADR-0048) — never a Σ of the lines.
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';
import { requireItems } from './shared.ts';

/** #876: adds two `mirrorMoney` decimal strings (`-?\d+\.\d{2}`) exactly, in integer cents — never a float. */
function addMoney(a: string, b: string): string {
  const sum = BigInt(a.replace('.', '')) + BigInt(b.replace('.', ''));
  const abs = sum < 0n ? -sum : sum;
  return `${sum < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export function piToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const items = requireItems(rec, 'Purchase Invoice');
  const reference = rec.referenceNumber ?? rec.reference_number;
  const date = rec.invoiceDate ?? rec.invoice_date;
  return {
    supplier: ctx.refs.supplier,
    ...(ctx.refs.project ? { project: ctx.refs.project } : {}),
    items: items.map((i) => ({
      item_code: i.item_code, qty: i.qty, rate: i.rate,
      ...(ctx.refs.project ? { project: ctx.refs.project } : {}),
      ...(i.description ? { description: i.description } : {}),
    })),
    ...(typeof reference === 'string' && reference.trim() ? { bill_no: reference.trim() } : {}),
    ...(typeof date === 'string' && date.trim() ? { bill_date: date.trim() } : {}),
    // #520: the user-chosen template, sent WITH its server-resolved rows (ERPNext does not expand a template named over REST).
    ...(Array.isArray(rec.taxes) && rec.taxes.length > 0 && typeof rec.taxTemplate === 'string'
      ? { taxes_and_charges: rec.taxTemplate, taxes: rec.taxes } : {}),
  };
}

export function piFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  const grandTotal = mirrorMoney(d.grand_total);
  const totalTaxes = mirrorMoney(d.total_taxes_and_charges);
  // #876 (DD-VWH-2, ADR-0082): with a withholding (Deduct) row ERPNext's grand_total is the NET payable and
  // total_taxes_and_charges is VAT − withheld. PMO keeps the GROSS bill in `amount` and VAT alone in `tax_amount`, adding
  // the header's own `taxes_and_charges_deducted` back — two figures ERPNext states, summed in cents (ADR-0048 holds:
  // nothing is computed from lines). Deducted 0 ⇒ byte-identical to the pre-#876 mirror. A payload that does not carry
  // the field leaves withholding UNKNOWN: today's figures and no `withheld_amount` key, so no writer can record a guess.
  const deducted = mirrorMoney(d.taxes_and_charges_deducted);
  const headerComplete = deducted !== null && grandTotal !== null && totalTaxes !== null;
  return {
    id: String(d.name),
    vi_number: String(d.name),
    // The vendor invoice date is distinct from the ERP ledger's posting date. Legacy docs may
    // carry only posting_date; preserve that fallback while preferring the actual bill_date.
    invoice_date: typeof d.bill_date === 'string' && d.bill_date.trim()
      ? d.bill_date
      : (d.posting_date as string | null) ?? null,
    reference_number: (d.bill_no as string | null) ?? null,
    amount: headerComplete ? addMoney(grandTotal, deducted) : grandTotal,
    erp_outstanding_amount: mirrorMoney(d.outstanding_amount),
    // #505 / DD-XING-4: the header tax facts. `tax_rate` is deliberately NOT derived (the per-rate breakdown lives on
    // the `taxes` CHILD table the list endpoint cannot return).
    tax_amount: headerComplete ? addMoney(totalTaxes, deducted) : totalTaxes,
    ...(headerComplete ? { withheld_amount: deducted } : {}),
    tax_template: (d.taxes_and_charges as string | null) ?? null,
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}

/**
 * The list-endpoint fields `piFromDoc` actually READS (Luna BLOCK 6). The modified-poll sweep builds its
 * `fields=[…]` request from this, so an adopted/updated mirror row is never written with NULLs for
 * data the ERP doc carries. Co-located with the mapper so the two cannot drift apart.
 */
export const PI_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'posting_date', 'bill_no', 'bill_date', 'grand_total', 'outstanding_amount', 'total_taxes_and_charges', 'taxes_and_charges_deducted', 'taxes_and_charges'] as const;
