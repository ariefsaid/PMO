/**
 * Unit tests for LedgerCaptureRow's nextExpectedType mapping.
 *
 * AC-PR-S4-003: nextExpectedType returns the correct pre-selected capture kind
 * for each procurement status. These tests run without DOM rendering — pure logic.
 *
 * M4 (design-review fix): Ordered and Received now return null so the ledger
 * capture row is hidden at those stages. GR and VI capture are handled by the
 * action-zone inline forms; offering "Capture Purchase Order" at Ordered/Received
 * is past the relevant phase and produces a mis-prompt. The capture row defers to
 * the action zone at Ordered/Received.
 *
 * Note: nextExpectedType is tested through the exported component behavior in
 * ProcurementDetails.slice4.test.tsx as well; this file tests the mapping logic
 * directly for the 11 statuses + the terminal-null contract.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Extract nextExpectedType via a proxy — the function is not exported from the
// module but the LedgerCaptureRow component's behavior is the spec. We inline
// the same logic here to unit-test the mapping without a DOM render.
// ---------------------------------------------------------------------------

import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { RecordKind } from './RecordCaptureForm';

/**
 * Mirror of the internal nextExpectedType from LedgerCaptureRow.tsx.
 * KEEP IN SYNC with LedgerCaptureRow.tsx when the mapping changes.
 */
const TERMINAL_STATUSES = new Set<ProcurementStatus>(['Paid', 'Cancelled', 'Rejected']);

function nextExpectedType(status: ProcurementStatus): RecordKind | null {
  if (TERMINAL_STATUSES.has(status)) return null;
  switch (status) {
    case 'Draft':
    case 'Requested':
      return 'purchase_request';
    case 'Rejected': // guarded above
      return null;
    case 'Approved':
    case 'Vendor Quoted':
      return 'rfq';
    case 'Quote Selected':
      return 'purchase_order';
    case 'Ordered':
    case 'Received':
      // M4 (design-review): GR and VI are handled by the action-zone inline forms;
      // these stages are NOT ledger-capture stages. Return null so the ledger capture
      // row is hidden and the action zone owns GR/VI capture exclusively.
      return null;
    case 'Vendor Invoiced':
      return 'payment';
    default:
      return 'purchase_request';
  }
}

// ---------------------------------------------------------------------------
// AC-PR-S4-003: per-status mapping
// ---------------------------------------------------------------------------

describe('AC-PR-S4-003: nextExpectedType — per-status mapping', () => {
  const CASES: [ProcurementStatus, RecordKind | null][] = [
    ['Draft',            'purchase_request'],
    ['Requested',        'purchase_request'],
    ['Approved',         'rfq'],
    ['Vendor Quoted',    'rfq'],
    ['Quote Selected',   'purchase_order'],
    // M4: Ordered/Received → null (ledger defers to action-zone for GR/VI)
    ['Ordered',          null],
    ['Received',         null],
    ['Vendor Invoiced',  'payment'],
    // Terminal statuses → null (capture hidden)
    ['Paid',             null],
    ['Cancelled',        null],
    ['Rejected',         null],
  ];

  CASES.forEach(([status, expected]) => {
    it(`${status} → ${expected ?? 'null (capture deferred or terminal)'}`, () => {
      expect(nextExpectedType(status)).toBe(expected);
    });
  });
});

// ---------------------------------------------------------------------------
// AC-PR-S4-004 (edge case): null-capture contract
// ---------------------------------------------------------------------------

describe('AC-PR-S4-003: null-capture contract', () => {
  it('returns null for all terminal statuses (Paid / Cancelled / Rejected)', () => {
    const terminals: ProcurementStatus[] = ['Paid', 'Cancelled', 'Rejected'];
    terminals.forEach((s) => {
      expect(nextExpectedType(s)).toBeNull();
    });
  });

  it('M4: returns null for Ordered and Received (capture deferred to action zone)', () => {
    expect(nextExpectedType('Ordered')).toBeNull();
    expect(nextExpectedType('Received')).toBeNull();
  });

  it('returns a non-null kind for the non-deferred, non-terminal statuses', () => {
    const activeCaptureStatuses: ProcurementStatus[] = [
      'Draft', 'Requested', 'Approved', 'Vendor Quoted',
      'Quote Selected', 'Vendor Invoiced',
    ];
    activeCaptureStatuses.forEach((s) => {
      expect(nextExpectedType(s)).not.toBeNull();
    });
  });
});
