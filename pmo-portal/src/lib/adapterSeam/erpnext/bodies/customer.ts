/**
 * erpnext/bodies/customer.ts (task 3.3, R9 §0, FR-ENA-090/092/094) — the `toBody`/`fromDoc` pair for
 * the `customer` `ErpDocKind`. Create/update body is the minimal `{customer_name}` (no invented
 * fields, mirrors `supplier.ts`); `fromDoc` maps the ERP `Customer` doc into the PMO `companies`
 * canonical shape (`type='Client'`). No Customer write beyond party create/update is ever introduced
 * (OQ-4) — no sales-document body lives here or anywhere in this adapter.
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { deriveErpPaymentTermsDays } from '../partyAdopt.ts';

interface CustomerDoc {
  name: string;
  customer_name?: string;
  tax_id?: string | null;
}

export const customerToBody = (rec: PmoRecord, _ctx: ErpCtx): object => ({
  customer_name: rec.name,
});

/**
 * `paymentTermsDays` is a pre-resolved `Payment Terms Template Detail.credit_days` (FR-ENA-094) —
 * resolving the template itself is a separate ERP fetch the caller performs (the dispatch
 * factory/onboarding fn), kept out of this pure, synchronous `fromDoc` signature. Absent -> the
 * FR-ENA-094 default of 30.
 */
export const customerFromDoc = (doc: unknown, paymentTermsDays?: number | null): PmoRecord => {
  const d = doc as CustomerDoc;
  const name = d.customer_name ?? d.name;
  return {
    id: 'placeholder',
    name,
    type: 'Client',
    erp_party_type: 'Client',
    erp_customer_name: name,
    erp_tax_id: d.tax_id ?? null,
    erp_payment_terms_days: deriveErpPaymentTermsDays(paymentTermsDays),
  };
};

/**
 * The list-endpoint fields `customerFromDoc` actually READS (Luna BLOCK 6). The modified-poll sweep builds its
 * `fields=[…]` request from this, so an adopted/updated mirror row is never written with NULLs for
 * data the ERP doc carries. Co-located with the mapper so the two cannot drift apart.
 */
export const CUSTOMER_FROM_DOC_FIELDS = ['name', 'modified', 'customer_name', 'tax_id'] as const;
