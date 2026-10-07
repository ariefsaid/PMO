/**
 * task 3.3 (FR-ENA-090/092/094/095) — Supplier/Customer/Contact `toBody`/`fromDoc` mappings. New file
 * (not `bodies.test.ts`, which is the money-doc R9 fixture set) so the existing money-doc test file
 * stays untouched.
 */
import { describe, expect, it } from 'vitest';
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { supplierToBody, supplierFromDoc } from './supplier.ts';
import { customerToBody, customerFromDoc } from './customer.ts';
import { contactFromDoc } from './contact.ts';

const CTX: ErpCtx = { refs: {}, config: {} };
function rec(fields: Record<string, unknown>): PmoRecord {
  return { id: 'pmo-1', ...fields };
}

describe('erpnext/bodies/supplier.ts (R9 §0 minimal, FR-ENA-090/092)', () => {
  it('supplierToBody sends only {supplier_name}', () => {
    expect(supplierToBody(rec({ name: 'Acme Co' }), CTX)).toEqual({ supplier_name: 'Acme Co' });
  });

  it('supplierFromDoc maps supplier_name -> name, type=Vendor, erp_supplier_name, erp_tax_id', () => {
    const canonical = supplierFromDoc({ name: 'Acme Co', supplier_name: 'Acme Co', tax_id: 'TAX-1' });
    expect(canonical).toMatchObject({
      name: 'Acme Co',
      type: 'Vendor',
      erp_party_type: 'Vendor',
      erp_supplier_name: 'Acme Co',
      erp_tax_id: 'TAX-1',
    });
  });

  it('supplierFromDoc falls back to ERP `name` when supplier_name is absent', () => {
    const canonical = supplierFromDoc({ name: 'Acme Co' });
    expect(canonical.name).toBe('Acme Co');
    expect(canonical.erp_tax_id).toBeNull();
  });

  // #935: the sweep keys external_refs on this id — 'placeholder' collapsed every sweep-adopted
  // party onto ONE external_refs row. Must be the doctype-encoded ERP doc NAME (the same shape
  // `partyAdopt.externalIdFor` / the webhook's `externalIdForKind` stamp), never the display name.
  it('supplierFromDoc keys the external id as `Supplier:<docname>` — the doc name, never the display name (#935)', () => {
    expect(supplierFromDoc({ name: 'S-000001', supplier_name: 'Acme Co' }).id).toBe('Supplier:S-000001');
    expect(supplierFromDoc({ name: 'S-000001' }).id).toBe('Supplier:S-000001');
  });
});

describe('erpnext/bodies/customer.ts (FR-ENA-090/092/094)', () => {
  it('customerToBody sends only {customer_name}', () => {
    expect(customerToBody(rec({ name: 'Acme Co' }), CTX)).toEqual({ customer_name: 'Acme Co' });
  });

  it('customerFromDoc maps customer_name -> name, type=Client, erp_customer_name', () => {
    const canonical = customerFromDoc({ name: 'Acme Co', customer_name: 'Acme Co', tax_id: null });
    expect(canonical).toMatchObject({
      name: 'Acme Co',
      type: 'Client',
      erp_party_type: 'Client',
      erp_customer_name: 'Acme Co',
      erp_tax_id: null,
    });
  });

  it('customerFromDoc defaults erp_payment_terms_days to 30 absent a resolved template (FR-ENA-094)', () => {
    const canonical = customerFromDoc({ name: 'Acme Co' });
    expect(canonical.erp_payment_terms_days).toBe(30);
  });

  it('customerFromDoc carries a pre-resolved payment-terms credit_days through unchanged', () => {
    const canonical = customerFromDoc({ name: 'Acme Co' }, 45);
    expect(canonical.erp_payment_terms_days).toBe(45);
  });

  // #935 — mirror of the supplier id contract above (Customer:<docname>, the doc name).
  it('customerFromDoc keys the external id as `Customer:<docname>` — the doc name, never the display name (#935)', () => {
    expect(customerFromDoc({ name: 'C-000001', customer_name: 'Acme Co' }, 30).id).toBe('Customer:C-000001');
    expect(customerFromDoc({ name: 'C-000001' }).id).toBe('Customer:C-000001');
  });
});

describe('erpnext/bodies/contact.ts (FR-ENA-095, read-only mirror mapping)', () => {
  it('maps first_name+last_name -> full_name, email_id -> email, phone -> phone', () => {
    expect(contactFromDoc({ first_name: 'Jane', last_name: 'Doe', email_id: 'jane@acme.test', phone: '+62-800' })).toEqual({
      full_name: 'Jane Doe',
      email: 'jane@acme.test',
      phone: '+62-800',
    });
  });

  it('handles a missing last_name / absent email/phone gracefully', () => {
    expect(contactFromDoc({ first_name: 'Jane' })).toEqual({ full_name: 'Jane', email: null, phone: null });
  });
});
