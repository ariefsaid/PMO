/**
 * Unit tests for LedgerCaptureRow's nextExpectedType mapping.
 *
 * AC-PR-S4-003: nextExpectedType returns the correct pre-selected capture kind
 * for each procurement status — now DATA-DRIVEN: it offers a kind only if it is
 * (a) unlocked by the current status AND (b) not already present in the ledger.
 *
 * The function is exported from ./ledgerCapture (the sibling logic module) and
 * tested directly (no mirror — the source IS the spec, eliminating drift).
 *
 * Over-prompt bug (IxD Change 2): at Requested a PR record already exists in the
 * ledger (status Submitted), so offering "Capture Purchase Request" was wrong —
 * the only valid forward move is the approval decision. The data-driven gate now
 * returns null when the unlocked kind already exists.
 *
 * M4 (design-review fix): Ordered and Received return null so the ledger capture
 * row is hidden at those stages — GR/VI capture is handled by the action-zone
 * inline forms.
 */
import { describe, it, expect } from 'vitest';

import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { RecordType } from '@/src/lib/db/procurementLedger';
import type { RecordKind } from './RecordCaptureForm';
import { nextExpectedType } from './ledgerCapture';

// ---------------------------------------------------------------------------
// AC-PR-S4-003: per-status mapping with an EMPTY ledger (no records present yet).
// This is the "status unlocks a kind" axis in isolation.
// ---------------------------------------------------------------------------

describe('AC-PR-S4-003: nextExpectedType — status-unlock axis (empty ledger)', () => {
  const NONE = new Set<RecordType>();
  const CASES: [ProcurementStatus, RecordKind | null][] = [
    // Draft with NO PR yet → offer PR (the case spine has not been captured).
    ['Draft', 'purchase_request'],
    // Requested with NO PR present (degenerate) → PR is still the unlocked kind.
    ['Requested', 'purchase_request'],
    ['Approved', 'rfq'],
    ['Vendor Quoted', 'rfq'],
    ['Quote Selected', 'purchase_order'],
    // M4: Ordered/Received → null (ledger defers to action-zone for GR/VI)
    ['Ordered', null],
    ['Received', null],
    ['Vendor Invoiced', 'payment'],
    // Terminal statuses → null (capture hidden)
    ['Paid', null],
    ['Cancelled', null],
    ['Rejected', null],
  ];

  CASES.forEach(([status, expected]) => {
    it(`${status} (empty ledger) → ${expected ?? 'null (capture deferred or terminal)'}`, () => {
      expect(nextExpectedType(status, NONE)).toBe(expected);
    });
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-CAPTURE-001 (the over-prompt bug fix): a kind already present in
// the ledger is NOT offered, even when the status would otherwise unlock it.
// ---------------------------------------------------------------------------

describe('AC-IXD-PROC-CAPTURE-001: data-driven — never offer a kind that already exists', () => {
  it('Requested + PR already in ledger ⇒ no capture offered (await approval)', () => {
    // The canonical over-prompt: a submitted PR exists, the only forward move is
    // the approval decision — the ledger must offer nothing.
    expect(nextExpectedType('Requested', new Set<RecordType>(['PR']))).toBeNull();
  });

  it('Draft + PR already in ledger ⇒ no PR re-offer (the case spine exists)', () => {
    expect(nextExpectedType('Draft', new Set<RecordType>(['PR']))).toBeNull();
  });

  it('Approved + RFQ already in ledger ⇒ no RFQ re-offer', () => {
    expect(nextExpectedType('Approved', new Set<RecordType>(['PR', 'RFQ']))).toBeNull();
  });

  it('Vendor Quoted + RFQ already in ledger ⇒ no RFQ re-offer', () => {
    expect(nextExpectedType('Vendor Quoted', new Set<RecordType>(['RFQ']))).toBeNull();
  });

  it('Quote Selected + PO already in ledger ⇒ no PO re-offer', () => {
    expect(nextExpectedType('Quote Selected', new Set<RecordType>(['PO']))).toBeNull();
  });

  it('Vendor Invoiced + Payment already in ledger ⇒ no payment re-offer', () => {
    expect(nextExpectedType('Vendor Invoiced', new Set<RecordType>(['Payment']))).toBeNull();
  });

  it('offers the absent kind when an UNRELATED kind exists', () => {
    // Approved with only a PR present (no RFQ) ⇒ RFQ is still the right next offer.
    expect(nextExpectedType('Approved', new Set<RecordType>(['PR']))).toBe('rfq');
    // Quote Selected with PR+RFQ present but no PO ⇒ offer PO.
    expect(
      nextExpectedType('Quote Selected', new Set<RecordType>(['PR', 'RFQ'])),
    ).toBe('purchase_order');
  });
});

// ---------------------------------------------------------------------------
// AC-PR-S4-004 (edge case): null contracts preserved.
// ---------------------------------------------------------------------------

describe('AC-PR-S4-003: null-capture contract', () => {
  const NONE = new Set<RecordType>();

  it('returns null for all terminal statuses (Paid / Cancelled / Rejected)', () => {
    const terminals: ProcurementStatus[] = ['Paid', 'Cancelled', 'Rejected'];
    terminals.forEach((s) => {
      expect(nextExpectedType(s, NONE)).toBeNull();
    });
  });

  it('M4: returns null for Ordered and Received (capture deferred to action zone)', () => {
    expect(nextExpectedType('Ordered', NONE)).toBeNull();
    expect(nextExpectedType('Received', NONE)).toBeNull();
  });

  it('returns a non-null kind for the non-deferred, non-terminal statuses when the kind is absent', () => {
    const activeCaptureStatuses: ProcurementStatus[] = [
      'Draft', 'Requested', 'Approved', 'Vendor Quoted',
      'Quote Selected', 'Vendor Invoiced',
    ];
    activeCaptureStatuses.forEach((s) => {
      expect(nextExpectedType(s, NONE)).not.toBeNull();
    });
  });
});
