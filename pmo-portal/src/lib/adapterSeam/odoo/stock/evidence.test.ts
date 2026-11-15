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

  it('AC-OSP-007: cancelled picking holds with STK_EVIDENCE_CANCELLED', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 10,
        state: 'cancel',
        company_id: 1,
        location_id: 6,
        location_dest_id: 2,
        write_date: '2026-11-14 10:00:00',
      },
      moves: [],
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_CANCELLED:/);
  });

  it('AC-OSP-007: move line with invalid product reference holds with STK_EVIDENCE_LINES', () => {
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
          product_id: null as unknown as number,
          quantity: 8,
          state: 'done',
          value: 800,
        },
      ],
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_LINES: move line has invalid product reference/);
  });

  it('AC-OSP-007: move line with unreadable quantity holds with STK_EVIDENCE_QUANTITY', () => {
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
          quantity: 'invalid' as unknown as number,
          state: 'done',
          value: 800,
        },
      ],
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_QUANTITY:/);
  });

  it('AC-OSP-007: intent line missing from moves holds with STK_EVIDENCE_LINES', () => {
    const intent: PmoStockIntent = {
      ...baseTransferIntent,
      lines: [
        { productId: 101, quantity: 8 },
        { productId: 102, quantity: 4 },
      ],
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
          quantity: 8,
          state: 'done',
          value: 800,
        },
      ],
    };

    const verdict = evaluateStockEvidence(intent, evidence);
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_LINES: product 102 is missing from ERP moves/);
  });

  it('AC-OSP-007: unexpected product in moves holds with STK_EVIDENCE_LINES', () => {
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
        { id: 100, product_id: 101, quantity: 8, state: 'done', value: 800 },
        { id: 101, product_id: 999, quantity: 1, state: 'done', value: 100 },
      ],
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_LINES: unexpected product 999 in ERP moves/);
  });

  it('AC-OSP-007: issue with unreadable valuation on analytic line holds', () => {
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
        { id: 100, product_id: 101, quantity: 2, state: 'done', value: 200 },
      ],
      analyticLines: [
        { id: 501, amount: null as unknown as number },
      ],
    };

    const verdict = evaluateStockEvidence(baseIssueIntent, evidence);
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_VALUATION: unreadable valuation on native project cost line/);
  });

  it('AC-OSP-007: missing source write timestamp holds with STK_EVIDENCE_TIMESTAMP', () => {
    const evidence: OdooStockEvidenceRead = {
      picking: {
        id: 10,
        state: 'done',
        company_id: 1,
        location_id: 6,
        location_dest_id: 2,
        write_date: null,
      },
      moves: [
        { id: 100, product_id: 101, quantity: 8, state: 'done', value: 800 },
      ],
    };

    const verdict = evaluateStockEvidence(baseTransferIntent, evidence);
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_TIMESTAMP:/);
  });
});

describe('evaluateStockEvidence issue with N moves (AC-OSP-007; bed 7.0: one cost line per move)', () => {
  const intent: PmoStockIntent = {
    documentId: '15120000-0000-0000-0000-000000003003',
    kind: 'issue',
    companyId: 1,
    sourceLocationId: 6,
    destinationLocationId: 2,
    projectId: 42,
    lines: [{ productId: 101, quantity: 8 }, { productId: 102, quantity: 3 }],
  };
  const line = (id: number, product: number, amount: number) => ({ id, amount, category: 'picking_entry', product_id: product, account_id: 42 });
  const read = (analyticLines: OdooStockEvidenceRead['analyticLines']): OdooStockEvidenceRead => ({
    picking: { id: 12, state: 'done', company_id: 1, location_id: 6, location_dest_id: 2, write_date: '2026-11-14 11:30:00' },
    moves: [
      { id: 1, product_id: 101, quantity: 8, state: 'done', value: -800 },
      { id: 2, product_id: 102, quantity: 3, state: 'done', value: -300 },
    ],
    analyticLines,
    currency: 'IDR',
  });

  it('AC-OSP-007 an issue with N moves confirms on N picking_entry lines, one per product', () => {
    const verdict = evaluateStockEvidence(intent, read([line(1, 101, -800), line(2, 102, -300)]));
    expect(verdict).toMatchObject({ state: 'confirmed', completedQuantity: 11, completedValue: -1100, exception: null });
  });

  it('AC-OSP-007 a second line for the same product is held as duplicate', () => {
    const verdict = evaluateStockEvidence(intent, read([line(1, 101, -800), line(2, 101, -300)]));
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_PROJECT_COST: duplicate/);
  });

  it('AC-OSP-007 more lines than moves is held as duplicate', () => {
    const verdict = evaluateStockEvidence(intent, read([line(1, 101, -800), line(2, 102, -300), line(3, 102, -1)]));
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_PROJECT_COST: duplicate/);
  });

  it('AC-OSP-007 fewer lines than moves is held as missing, never confirmed on a partial cost', () => {
    const verdict = evaluateStockEvidence(intent, read([line(1, 101, -800)]));
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_PROJECT_COST: missing/);
  });

  it('AC-OSP-007 a line for a product that is not on a move is held', () => {
    const verdict = evaluateStockEvidence(intent, read([line(1, 101, -800), line(2, 555, -300)]));
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_PROJECT_COST: .*555/);
  });
});


describe('evaluateStockEvidence against the bed facts (AC-OSP-007, Round 7.0)', () => {
  const picking = { id: 13, state: 'done', company_id: 1, location_id: 6, location_dest_id: 2, write_date: '2026-11-15 09:00:00' };
  const transfer: PmoStockIntent = { documentId: '15120000-0000-0000-0000-000000003005', kind: 'transfer', companyId: 1, sourceLocationId: 6, destinationLocationId: 2, lines: [{ productId: 101, quantity: 3 }, { productId: 102, quantity: 2 }] };

  it('AC-OSP-007 an internal transfer Odoo does not value (value 0, is_valued false) confirms with its quantity and no value change', () => {
    const verdict = evaluateStockEvidence(transfer, { picking, moves: [
      { id: 1, product_id: 101, quantity: 3, state: 'done', value: 0, is_valued: false },
      { id: 2, product_id: 102, quantity: 2, state: 'done', value: 0, is_valued: false },
    ], currency: 'IDR' });
    expect(verdict).toMatchObject({ state: 'confirmed', completedQuantity: 5, completedValue: 0, exception: null });
  });

  it('AC-OSP-007 a move not valued confirms even when its value reads empty', () => {
    const verdict = evaluateStockEvidence(transfer, { picking, moves: [
      { id: 1, product_id: 101, quantity: 3, state: 'done', value: null, is_valued: false },
      { id: 2, product_id: 102, quantity: 2, state: 'done', value: null, is_valued: false },
    ] });
    expect(verdict).toMatchObject({ state: 'confirmed', completedValue: 0 });
  });

  it('AC-OSP-007 a valued move with no number is held, never confirmed on a guess', () => {
    const verdict = evaluateStockEvidence(transfer, { picking, moves: [
      { id: 1, product_id: 101, quantity: 3, state: 'done', value: -30, is_valued: true },
      { id: 2, product_id: 102, quantity: 2, state: 'done', value: null, is_valued: true },
    ] });
    expect(verdict.state).toBe('held');
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_VALUATION:/);
  });

  it('AC-OSP-007 one item on two lines confirms on its two moves and two cost lines', () => {
    const issue: PmoStockIntent = { documentId: '15120000-0000-0000-0000-000000003006', kind: 'issue', companyId: 1, sourceLocationId: 6, destinationLocationId: 2, projectId: 42, lines: [{ productId: 205, quantity: 2 }, { productId: 205, quantity: 3 }] };
    const verdict = evaluateStockEvidence(issue, { picking, moves: [
      { id: 1, product_id: 205, quantity: 2, state: 'done', value: -20, is_valued: true },
      { id: 2, product_id: 205, quantity: 3, state: 'done', value: -30, is_valued: true },
    ], analyticLines: [
      { id: 1, amount: -20, category: 'picking_entry', product_id: 205, account_id: 42 },
      { id: 2, amount: -30, category: 'picking_entry', product_id: 205, account_id: 42 },
    ] });
    expect(verdict).toMatchObject({ state: 'confirmed', completedQuantity: 5, completedValue: -50 });
  });

  it('AC-OSP-007 one item on two lines with a third cost line is held as duplicate', () => {
    const issue: PmoStockIntent = { documentId: '15120000-0000-0000-0000-000000003007', kind: 'issue', companyId: 1, sourceLocationId: 6, destinationLocationId: 2, projectId: 42, lines: [{ productId: 205, quantity: 2 }, { productId: 205, quantity: 3 }] };
    const verdict = evaluateStockEvidence(issue, { picking, moves: [
      { id: 1, product_id: 205, quantity: 2, state: 'done', value: -20, is_valued: true },
      { id: 2, product_id: 205, quantity: 3, state: 'done', value: -30, is_valued: true },
    ], analyticLines: [
      { id: 1, amount: -20, category: 'picking_entry', product_id: 205, account_id: 42 },
      { id: 2, amount: -30, category: 'picking_entry', product_id: 205, account_id: 42 },
      { id: 3, amount: -5, category: 'picking_entry', product_id: 205, account_id: 42 },
    ] });
    expect(verdict.exception).toMatch(/^STK_EVIDENCE_PROJECT_COST: duplicate/);
  });
  describe('AC-OSP-007 every held verdict carries the cause its rule names, and the transfer reference', () => {
    const baseTransferIntent: PmoStockIntent = { documentId: 'd', kind: 'transfer', companyId: 1, sourceLocationId: 6, destinationLocationId: 2, lines: [{ productId: 101, quantity: 8 }] };
    const baseIssueIntent: PmoStockIntent = { ...baseTransferIntent, kind: 'issue', projectId: 42, lines: [{ productId: 101, quantity: 2 }] };
    const base = { id: 10, state: 'done', company_id: 1, location_id: 6, location_dest_id: 2, write_date: '2026-11-14 10:00:00', name: 'WH/INT/00010' };
    const move = { product_id: 101, quantity: 8, state: 'done', value: 800, is_valued: true };
    const issueMove = { ...move, quantity: 2 };
    const cost = { id: 1, amount: -20, category: 'picking_entry', product_id: 101, account_id: 42 };
    const cases: Array<[string, PmoStockIntent, OdooStockEvidenceRead, string]> = [
      ['other company', baseTransferIntent, { picking: { ...base, company_id: 99 }, moves: [move] }, 'other-company'],
      ['other locations', baseTransferIntent, { picking: { ...base, location_id: 999 }, moves: [move] }, 'locations-differ'],
      ['cancelled', baseTransferIntent, { picking: { ...base, state: 'cancel' }, moves: [move] }, 'cancelled'],
      ['no moves', baseTransferIntent, { picking: base, moves: [] }, 'lines-differ'],
      ['a product missing from the moves', baseTransferIntent, { picking: base, moves: [{ ...move, product_id: 102 }] }, 'lines-differ'],
      ['a different quantity', baseTransferIntent, { picking: base, moves: [{ ...move, quantity: 7 }] }, 'quantity-differs'],
      ['no project cost', baseIssueIntent, { picking: base, moves: [issueMove], analyticLines: [] }, 'no-project-cost'],
      ['duplicate project cost', baseIssueIntent, { picking: base, moves: [issueMove], analyticLines: [cost, { ...cost, id: 2 }] }, 'no-project-cost'],
      ['an unreadable cost', baseIssueIntent, { picking: base, moves: [issueMove], analyticLines: [{ ...cost, amount: Number.NaN }] }, 'no-value'],
      ['an unreadable transfer value', baseTransferIntent, { picking: base, moves: [{ ...move, value: null }] }, 'no-value'],
      ['no source timestamp', baseTransferIntent, { picking: { ...base, write_date: null }, moves: [move] }, 'not-checked'],
    ];
    it.each(cases)('%s', (_label, intent, evidence, cause) => {
      const verdict = evaluateStockEvidence(intent, evidence);
      expect(verdict).toMatchObject({ state: 'held', holdCause: cause, externalId: '10', externalReference: 'WH/INT/00010' });
    });

    it('a confirmed verdict names the transfer and holds no cause', () => {
      expect(evaluateStockEvidence(baseTransferIntent, { picking: base, moves: [move] })).toMatchObject({ state: 'confirmed', holdCause: null, externalReference: 'WH/INT/00010', exception: null });
    });
  });
});
