/**
 * erpnext/bodies/supplier.ts (task 3.3, R9 §0, FR-ENA-090/092) — the `toBody`/`fromDoc` pair for the
 * `supplier` `ErpDocKind`. Create/update body is the R9-frozen minimal `{supplier_name}` (no invented
 * fields); `fromDoc` maps the ERP `Supplier` doc into the PMO `companies` canonical shape
 * (`type='Vendor'` per FR-ENA-090's discriminator).
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';

interface SupplierDoc {
  name: string;
  supplier_name?: string;
  tax_id?: string | null;
}

export const supplierToBody = (rec: PmoRecord, _ctx: ErpCtx): object => ({
  supplier_name: rec.name,
});

export const supplierFromDoc = (doc: unknown): PmoRecord => {
  const d = doc as SupplierDoc;
  const name = d.supplier_name ?? d.name;
  return {
    id: 'placeholder',
    name,
    type: 'Vendor',
    erp_party_type: 'Vendor',
    erp_supplier_name: name,
    erp_tax_id: d.tax_id ?? null,
  };
};
