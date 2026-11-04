import { describe, expect, it } from 'vitest';
import { readOdooProgressClaim } from '../../../../../../supabase/functions/_shared/odooProgressClaim.ts';

type QueryResult = { data: unknown; error: null };

class Query {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  limit() { return Promise.resolve(this.result); }
}

function serviceClient(rows: Record<string, unknown>) {
  return {
    from(table: string) {
      return new Query({ data: rows[table] ?? null, error: null });
    },
  } as never;
}

const sharedClaim = {
  id: 'claim-1', project_id: 'project-1', work_order_id: null, currency: 'IDR',
  down_payment_amount: null, dp_recovery_amount: '0.00', dp_item_code: null, withdrawn_at: null,
};

describe('readOdooProgressClaim', () => {
  it('AC-OCI-024 loads only signed T&M lines and preserves the approved unit and amount', async () => {
    const result = await readOdooProgressClaim(serviceClient({
      progress_claims: { ...sharedClaim, kind: 'time_materials', gross_amount: '6000000.00' },
      projects: { client_id: 'client-1' },
      progress_claim_evidence: [{ id: 'evidence-1' }],
      tm_claims: { status: 'SignedOff', confirmed_by: 'approver-1', gross_amount: '6000000.00' },
      tm_claim_lines: [{
        line_key: 'line-1', rate_version: 1, kind: 'labour', label: 'Field labour', unit: 'hour',
        units: '120.00', rate: '50000.00', amount: '6000000.00',
      }],
    }), 'org-1', 'claim-1');

    expect(result).toMatchObject({
      customerId: 'client-1', timeMaterials: true,
      items: [{ item_code: 'Field labour', description: 'Field labour (hour)', qty: 120, rate: 50000, amount: 6000000, unit: 'hour' }],
    });
  });

  it('keeps the signed progress-claim amount and unit when resolving BoQ lines', async () => {
    const result = await readOdooProgressClaim(serviceClient({
      progress_claims: { ...sharedClaim, kind: 'progress' },
      projects: { client_id: 'client-1' },
      progress_claim_evidence: [{ id: 'evidence-1' }],
      progress_claim_lines: [{ item_code: 'BOQ-1', description: 'Roadworks', unit: 'km', quantity: '0.333', rate: '1000.01', amount: '333.00' }],
    }), 'org-1', 'claim-1');

    expect(result).toMatchObject({
      customerId: 'client-1', timeMaterials: false,
      items: [{ item_code: 'BOQ-1', description: 'Roadworks (km)', qty: 0.333, rate: 1000.01, amount: 333, unit: 'km' }],
    });
  });

  it('refuses T&M lines unless their signed total agrees with both claim headers', async () => {
    await expect(readOdooProgressClaim(serviceClient({
      progress_claims: { ...sharedClaim, kind: 'time_materials', gross_amount: '6000000.00' },
      projects: { client_id: 'client-1' },
      progress_claim_evidence: [{ id: 'evidence-1' }],
      tm_claims: { status: 'SignedOff', confirmed_by: 'approver-1', gross_amount: '6000000.00' },
      tm_claim_lines: [{
        line_key: 'line-1', rate_version: 1, kind: 'labour', label: 'Field labour', unit: 'hour',
        units: '120.00', rate: '50000.00', amount: '5999999.99',
      }],
    }), 'org-1', 'claim-1')).rejects.toThrow('The signed time-and-materials claim header does not match its line amounts');
  });
});
