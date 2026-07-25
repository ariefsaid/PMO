/**
 * erpnext/partyAdopt.test.ts (task 3.1, AC-ENA-041/042). Pure-function proof of the pull-adopt
 * mapping + ambiguous-match + Supplier/Customer collision rule (FR-ENA-090/091/093) — the DB-level
 * exactly-once-under-concurrency proof (the unique `(org_id,domain,external_record_id)` constraint)
 * is 1.9's `external_refs_adopt_unique.test.sql`; this file proves `adoptParty` itself is a
 * deterministic, idempotent function of its inputs (same source + same existing-candidate state ⇒
 * the identical canonical + externalRecordId every call) — the onboarding fn (3.9) composes this
 * with real `external_refs` idempotency to prove the full "adopted twice ⇒ exactly one mirror" path.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../appError.ts';
import { adoptParty, externalIdFor, deriveErpPaymentTermsDays } from './partyAdopt.ts';

describe('erpnext/partyAdopt — externalIdFor (the doctype-encoded external id, FR-ENA-091)', () => {
  it('encodes the ERP doctype into the external id so Supplier/Customer never collide', () => {
    expect(externalIdFor('Supplier', 'Acme')).toBe('Supplier:Acme');
    expect(externalIdFor('Customer', 'Acme')).toBe('Customer:Acme');
  });
});

describe('erpnext/partyAdopt — adoptParty (task 3.2, FR-ENA-090/093)', () => {
  it('AC-ENA-041 no existing PMO candidate -> mints a new pmoRecordId, maps type=Vendor for a Supplier', async () => {
    const result = await adoptParty(
      { doctype: 'Supplier', name: 'Acme Co', taxId: 'TAX-1' },
      { findCandidates: async () => [] },
    );
    expect(result.externalRecordId).toBe('Supplier:Acme Co');
    expect(result.canonical).toMatchObject({
      name: 'Acme Co',
      type: 'Vendor',
      erp_party_type: 'Vendor',
      erp_supplier_name: 'Acme Co',
      erp_tax_id: 'TAX-1',
    });
    expect(typeof result.canonical.id).toBe('string');
    expect(result.canonical.id.length).toBeGreaterThan(0);
  });

  it('a Customer source maps type=Client and defaults erp_payment_terms_days to 30 absent a template', async () => {
    const result = await adoptParty(
      { doctype: 'Customer', name: 'Acme Co', taxId: null },
      { findCandidates: async () => [] },
    );
    expect(result.externalRecordId).toBe('Customer:Acme Co');
    expect(result.canonical).toMatchObject({
      name: 'Acme Co',
      type: 'Client',
      erp_party_type: 'Client',
      erp_customer_name: 'Acme Co',
      erp_payment_terms_days: 30,
    });
  });

  it('re-adopting the SAME source against the same existing-candidate state is idempotent (same pmoRecordId + externalRecordId)', async () => {
    const first = await adoptParty({ doctype: 'Supplier', name: 'Acme Co', taxId: 'TAX-1' }, { findCandidates: async () => [] });
    // Simulate the second run seeing the mirror row the first run would have written.
    const second = await adoptParty(
      { doctype: 'Supplier', name: 'Acme Co', taxId: 'TAX-1' },
      { findCandidates: async () => [{ pmoRecordId: first.canonical.id, taxId: 'TAX-1' }] },
    );
    expect(second.canonical.id).toBe(first.canonical.id);
    expect(second.externalRecordId).toBe(first.externalRecordId);
  });

  it('exactly one existing PMO candidate -> adopts (links) that row deterministically, regardless of tax id agreement', async () => {
    const result = await adoptParty(
      { doctype: 'Supplier', name: 'Acme Co', taxId: undefined },
      { findCandidates: async () => [{ pmoRecordId: 'pmo-existing-1', taxId: null }] },
    );
    expect(result.canonical.id).toBe('pmo-existing-1');
  });

  it('AC-ENA-041 ambiguous match (same name, differing tax id across candidates) -> action-required, never auto-merged', async () => {
    await expect(
      adoptParty(
        { doctype: 'Supplier', name: 'Acme Co', taxId: 'TAX-1' },
        { findCandidates: async () => [{ pmoRecordId: 'pmo-a', taxId: 'TAX-1' }, { pmoRecordId: 'pmo-b', taxId: 'TAX-2' }] },
      ),
    ).rejects.toMatchObject({ code: 'action-required' } satisfies Partial<AppError>);
  });

  it('AC-ENA-041 ambiguous match (multiple candidates, source tax id absent) -> action-required', async () => {
    await expect(
      adoptParty(
        { doctype: 'Supplier', name: 'Acme Co', taxId: undefined },
        { findCandidates: async () => [{ pmoRecordId: 'pmo-a', taxId: null }, { pmoRecordId: 'pmo-b', taxId: null }] },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('AC-ENA-042 Supplier + Customer sharing the same name never merge: two distinct external ids/types', async () => {
    const supplier = await adoptParty({ doctype: 'Supplier', name: 'Acme Co' }, { findCandidates: async () => [] });
    const customer = await adoptParty({ doctype: 'Customer', name: 'Acme Co' }, { findCandidates: async () => [] });
    expect(supplier.externalRecordId).not.toBe(customer.externalRecordId);
    expect(supplier.canonical.type).toBe('Vendor');
    expect(customer.canonical.type).toBe('Client');
  });

  it('task 3.11 (FR-ENA-090/091) an Internal-shaped source is never ERP-flipped -> config-rejected', async () => {
    await expect(
      adoptParty({ doctype: 'Supplier', name: 'PMO Smoke Co', isInternal: true }, { findCandidates: async () => [] }),
    ).rejects.toMatchObject({ code: 'config-rejected' });
  });
});

describe('erpnext/partyAdopt — deriveErpPaymentTermsDays (FR-ENA-094)', () => {
  it('maps a resolved Payment Terms Template credit_days through unchanged', () => {
    expect(deriveErpPaymentTermsDays(45)).toBe(45);
  });
  it('defaults to 30 when no template is set (FR-ENA-094 default)', () => {
    expect(deriveErpPaymentTermsDays(null)).toBe(30);
    expect(deriveErpPaymentTermsDays(undefined)).toBe(30);
  });
});
