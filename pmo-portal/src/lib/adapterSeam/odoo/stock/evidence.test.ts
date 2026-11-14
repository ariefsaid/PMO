import { describe, it, expect } from 'vitest';
import {
  evaluateStockEvidence,
  type PmoStockIntent,
  type OdooStockEvidenceRead,
} from './evidence.ts';

describe('evaluateStockEvidence (AC-OSP-007)', () => {
  const baseTransferIntent: PmoStockIntent = {
    documentId: '15120000-0000-0000-0000-000000003001',
    kind: 'transfer',
    companyId: 1,
    sourceLocationId: 6,
    destinationLocationId: 2,
    lines: [{ productId: 101, quantity: 8 }],
  };

  const baseIssueIntent: PmoStockIntent = {
    documentId: '15120000-0000-0000-0000-000000003002',
    kind: 'issue',
    companyId: 1,
    sourceLocationId: 6,
    destinationLocationId: 2,
    projectId: 42,
    lines: [{ productId: 101, quantity: 2 }],
  };

  it('AC-OSP-007: complete matching transfer produces confirmed verdict with Odoo numbers', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 10,
        state: 'done',
        company_id: [1, 'PT Test Company'],
        location_id: [6, 'WH/Stock'],
        location_dest_id: [2, 'Customers'],
        write_date: '2026-11-14 10:00:00',
      },
      moves: [
        {
          id: 100,
          product_id: [101, 'Item 101'],
          quantity: 8,
          state: 'done',
          value: 800.0,
        },
      ],
      currency: 'IDR',
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);

    expect(verdict.state).toBe('confirmed');
    expect(verdict.externalModel).toBe('stock.picking');
    expect(verdict.externalId).toBe('10');
    expect(verdict.completedQuantity).toBe(8);
    expect(verdict.completedValue).toBe(800.0);
    expect(verdict.currency).toBe('IDR');
    expect(verdict.sourceWrittenAt).toBe('2026-11-14 10:00:00');
    expect(verdict.exception).toBeNull();
  });

  it('AC-OSP-007: complete matching issue produces confirmed verdict with native project cost', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 12,
        state: 'done',
        company_id: 1,
        location_id: 6,
        location_dest_id: 2,
        write_date: '2026-11-14 11:30:00',
      },
      moves: [
        {
          id: 102,
          product_id: 101,
          quantity: 2,
          state: 'done',
          value: -240.0,
        },
      ],
      analyticLines: [
        {
          id: 501,
          name: 'WH/OUT/00004',
          amount: -240.0,
          unit_amount: 2,
          category: 'picking_entry',
          product_id: [101, 'Item 101'],
          account_id: [42, 'Project Plan Alpha'],
        },
      ],
      currency: 'IDR',
    };

    const verdict = evaluateStockEvidence(baseIssueIntent, evidence);

    expect(verdict.state).toBe('confirmed');
    expect(verdict.externalModel).toBe('stock.picking');
    expect(verdict.externalId).toBe('12');
    expect(verdict.completedQuantity).toBe(2);
    expect(verdict.completedValue).toBe(-240.0);
    expect(verdict.currency).toBe('IDR');
    expect(verdict.sourceWrittenAt).toBe('2026-11-14 11:30:00');
    expect(verdict.exception).toBeNull();
  });

  it('AC-OSP-007: partial quantity holds with short exception and actual completed quantity', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 10,
        state: 'done',
        company_id: 1,
        location_id: 6,
        location_dest_id: 2,
        write_date: '2026-11-14 10:00:00',
      },
      moves: [
        {
          id: 100,
          product_id: 101,
          quantity: 6, // PMO sent 8
          state: 'done',
          value: 600.0,
        },
      ],
      currency: 'IDR',
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);

    expect(verdict.state).toBe('held');
    expect(verdict.completedQuantity).toBe(6);
    expect(verdict.completedValue).toBe(600.0);
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_QUANTITY:/);
  });

  it('AC-OSP-007: two analytic lines for one issue holds as duplicate project cost', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 12,
        state: 'done',
        company_id: 1,
        location_id: 6,
        location_dest_id: 2,
        write_date: '2026-11-14 11:30:00',
      },
      moves: [
        {
          id: 102,
          product_id: 101,
          quantity: 2,
          state: 'done',
          value: -240.0,
        },
      ],
      analyticLines: [
        {
          id: 501,
          name: 'WH/OUT/00004',
          amount: -240.0,
          unit_amount: 2,
          category: 'picking_entry',
          product_id: [101, 'Item 101'],
          account_id: [42, 'Project Plan Alpha'],
        },
        {
          id: 502,
          name: 'WH/OUT/00004-dup',
          amount: -240.0,
          unit_amount: 2,
          category: 'picking_entry',
          product_id: [101, 'Item 101'],
          account_id: [42, 'Project Plan Alpha'],
        },
      ],
      currency: 'IDR',
    };

    const verdict = evaluateStockEvidence(baseIssueIntent, evidence);

    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_PROJECT_COST: duplicate/);
  });

  it('AC-OSP-007: value present but picking not done yields pending with null value and quantity', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 10,
        state: 'assigned', // not 'done'
        company_id: 1,
        location_id: 6,
        location_dest_id: 2,
        write_date: '2026-11-14 10:00:00',
      },
      moves: [
        {
          id: 100,
          product_id: 101,
          quantity: 8,
          state: 'assigned',
          value: 800.0, // value present in Odoo
        },
      ],
      currency: 'IDR',
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);

    expect(verdict.state).toBe('pending');
    expect(verdict.externalModel).toBe('stock.picking');
    expect(verdict.externalId).toBe('10');
    expect(verdict.completedQuantity).toBeNull();
    expect(verdict.completedValue).toBeNull();
    expect(verdict.currency).toBeNull();
    expect(verdict.exception).toBeNull();
  });

  it('AC-OSP-007: verdict never contains numbers from PMO inputs', () => {
    const intentWithDifferentQuantity: PmoStockIntent = {
      documentId: '15120000-0000-0000-0000-000000003001',
      kind: 'transfer',
      companyId: 1,
      sourceLocationId: 6,
      destinationLocationId: 2,
      lines: [{ productId: 101, quantity: 15 }], // PMO says 15
    };

    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 10,
        state: 'done',
        company_id: 1,
        location_id: 6,
        location_dest_id: 2,
        write_date: '2026-11-14 10:00:00',
      },
      moves: [
        {
          id: 100,
          product_id: 101,
          quantity: 7.5, // Odoo says 7.5
          state: 'done',
          value: 750.25, // Odoo says 750.25
        },
      ],
      currency: 'IDR',
    };

    const verdict = evaluateStockEvidence(intentWithDifferentQuantity, evidence);

    expect(verdict.state).toBe('held');
    expect(verdict.completedQuantity).toBe(7.5);
    expect(verdict.completedQuantity).not.toBe(15);
    expect(verdict.completedValue).toBe(750.25);
  });

  it('AC-OSP-007: wrong company holds with exception', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 10,
        state: 'done',
        company_id: 99, // Intent company is 1
        location_id: 6,
        location_dest_id: 2,
        write_date: '2026-11-14 10:00:00',
      },
      moves: [{ product_id: 101, quantity: 8, state: 'done', value: 800.0 }],
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);

    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_COMPANY:/);
  });

  it('AC-OSP-007: mismatched locations hold with exception', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 10,
        state: 'done',
        company_id: 1,
        location_id: 999, // Intent source location is 6
        location_dest_id: 2,
        write_date: '2026-11-14 10:00:00',
      },
      moves: [{ product_id: 101, quantity: 8, state: 'done', value: 800.0 }],
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);

    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_LOCATION:/);
  });

  it('AC-OSP-007: missing lines hold with exception', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 10,
        state: 'done',
        company_id: 1,
        location_id: 6,
        location_dest_id: 2,
        write_date: '2026-11-14 10:00:00',
      },
      moves: [], // No moves
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);

    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_LINES:/);
  });

  it('AC-OSP-007: issue with missing native project cost holds with exception', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 12,
        state: 'done',
        company_id: 1,
        location_id: 6,
        location_dest_id: 2,
        write_date: '2026-11-14 11:30:00',
      },
      moves: [{ product_id: 101, quantity: 2, state: 'done', value: -240.0 }],
      analyticLines: [], // No analytic lines
    };

    const verdict = evaluateStockEvidence(baseIssueIntent, evidence);

    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_PROJECT_COST: missing/);
  });

  it('AC-OSP-007: unreadable valuation holds with exception', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 10,
        state: 'done',
        company_id: 1,
        location_id: 6,
        location_dest_id: 2,
        write_date: '2026-11-14 10:00:00',
      },
      moves: [
        {
          id: 100,
          product_id: 101,
          quantity: 8,
          state: 'done',
          value: null, // Unreadable valuation
        },
      ],
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);

    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_VALUATION:/);
  });

  it('AC-OSP-007: missing picking returns pending', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: null,
      moves: [],
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);

    expect(verdict.state).toBe('pending');
    expect(verdict.externalModel).toBeNull();
    expect(verdict.externalId).toBeNull();
    expect(verdict.completedQuantity).toBeNull();
    expect(verdict.completedValue).toBeNull();
  });
});
