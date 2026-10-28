/**
 * D2 review C1/C2 — every kind the ledger capture row can offer must reach a REAL write, and the form must never
 * report "recorded" for one that wrote nothing. Goods receipt and supplier invoice used to open a form whose save
 * went nowhere (the page toasted success; the ledger stayed empty). They now hand off to the page's confirm
 * (`onStage`); the other four write through `onCreate`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';
import { LedgerCaptureRow } from './LedgerCaptureRow';
import { nextExpectedType } from './ledgerCapture';
import { FIRST_DOCUMENT_ORDER } from './firstDocument';
import type { RecordKind } from './RecordCaptureForm';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { RecordType } from '@/src/lib/db/procurementLedger';

afterEach(() => clearOwnershipCache());

const SAVE_TEST_ID: Record<RecordKind, string> = {
  purchase_request: 'purchase_request-save-btn',
  rfq: 'rfq-save-btn',
  purchase_order: 'purchase_order-save-btn',
  payment: 'payment-save-btn',
  goods_receipt: 'btn-save-gr',
  vendor_invoice: 'btn-save-vi',
};
const STAGED_KINDS: ReadonlySet<RecordKind> = new Set(['goods_receipt', 'vendor_invoice']);

const STATUSES: ProcurementStatus[] = ['Draft', 'Requested', 'Approved', 'Vendor Quoted', 'Quote Selected', 'Ordered', 'Received', 'Vendor Invoiced', 'Paid', 'Cancelled', 'Rejected'];
const LEDGER_TYPES: RecordType[] = ['PR', 'RFQ', 'Quote', 'PO', 'GR', 'Invoice', 'Payment'];

function reachableKinds(): Set<RecordKind> {
  const kinds = new Set<RecordKind>();
  for (const status of STATUSES) {
    for (const startAt of [null, ...FIRST_DOCUMENT_ORDER]) {
      for (const existing of [new Set<RecordType>(), ...LEDGER_TYPES.map((t) => new Set<RecordType>([t]))]) {
        const kind = nextExpectedType(status, existing, startAt);
        if (kind) kinds.add(kind);
      }
    }
  }
  return kinds;
}

describe('every kind the ledger capture row can offer is wired to a write', () => {
  it('the kinds under test are exactly the kinds nextExpectedType can return (a new kind must be added here)', () => {
    expect([...reachableKinds()].sort()).toEqual([...FIRST_DOCUMENT_ORDER].sort());
  });

  it.each(FIRST_DOCUMENT_ORDER)('%s: saving writes (onCreate) or stages the page confirm (onStage), and never claims success otherwise', async (kind) => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onStage = vi.fn();
    render(
      <ToastProvider>
        <LedgerCaptureRow
          status="Draft" existingTypes={new Set()} canWrite onCreate={onCreate} onStage={onStage}
          firstDocumentKinds={[...FIRST_DOCUMENT_ORDER]}
        />
      </ToastProvider>,
    );
    await userEvent.selectOptions(screen.getByLabelText('Record the first document'), kind);
    await userEvent.click(screen.getByTestId('ledger-capture-open'));
    if (kind === 'vendor_invoice') {
      await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
      await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    }
    await userEvent.click(screen.getByTestId(SAVE_TEST_ID[kind]));

    if (STAGED_KINDS.has(kind)) {
      expect(onStage).toHaveBeenCalledTimes(1);
      expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ kind: kind === 'goods_receipt' ? 'createGR' : 'createVI' }));
      expect(onCreate).not.toHaveBeenCalled();
      // Staging is not a write: nothing is toasted as recorded until the page's confirm commits it.
      expect(screen.queryByText(/(Goods Receipt|Supplier Invoice) recorded/i)).toBeNull();
    } else {
      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
      expect(onCreate).toHaveBeenCalledWith(kind, expect.anything());
      expect(onStage).not.toHaveBeenCalled();
    }
  });
});
