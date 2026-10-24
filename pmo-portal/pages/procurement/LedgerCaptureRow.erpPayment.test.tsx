/** An ERP-owned purchase takes a payment only against a PMO bill; with none, the row points at the supported route. */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { clearOwnershipCache, setDomainOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import { FIRST_DOCUMENT_ORDER } from './firstDocument';
import { LedgerCaptureRow } from './LedgerCaptureRow';

afterEach(() => clearOwnershipCache());

const LINE = 'Record the payment in ERPNext; it links here on the next sync.';
const bill = [{ id: 'inv-1', reference_number: 'INV-1', vi_number: 'VI-1', invoice_date: '2026-01-02' }] as never;
const erpOwned = () => setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);

describe('payment doorway on an ERP-owned purchase', () => {
  it('a purchase with only linked ERP documents (no PMO bill) shows one line and no Capture Payment', () => {
    erpOwned();
    render(<LedgerCaptureRow status="Vendor Invoiced" existingTypes={new Set()} onCreate={async () => undefined} canWrite invoices={[]} />);
    expect(screen.getByText(LINE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Capture Payment/ })).toBeNull();
  });

  it('choosing Payment first on an empty ERP-owned purchase shows the line instead of an empty bill selector', async () => {
    erpOwned();
    render(<LedgerCaptureRow status="Draft" existingTypes={new Set()} onCreate={async () => undefined} canWrite
      firstDocumentKinds={[...FIRST_DOCUMENT_ORDER]} />);
    await userEvent.selectOptions(screen.getByLabelText('Record the first document'), 'payment');
    expect(screen.getByText(LINE)).toBeInTheDocument();
    expect(screen.queryByTestId('ledger-capture-open')).toBeNull();
    // Another first document is still capturable from the same chooser.
    await userEvent.selectOptions(screen.getByLabelText('Record the first document'), 'purchase_order');
    expect(screen.queryByText(LINE)).toBeNull();
    expect(screen.getByTestId('ledger-capture-open')).toBeEnabled();
  });

  it('with a PMO bill on file the payment capture stays, unchanged', () => {
    erpOwned();
    render(<LedgerCaptureRow status="Vendor Invoiced" existingTypes={new Set()} onCreate={async () => undefined} canWrite invoices={bill} />);
    expect(screen.queryByText(LINE)).toBeNull();
    expect(screen.getByRole('button', { name: 'Capture Payment' })).toBeEnabled();
  });

  it('a PMO-native purchase keeps the optional-bill payment capture', () => {
    render(<LedgerCaptureRow status="Vendor Invoiced" existingTypes={new Set()} onCreate={async () => undefined} canWrite invoices={[]} />);
    expect(screen.queryByText(LINE)).toBeNull();
    expect(screen.getByRole('button', { name: 'Capture Payment' })).toBeEnabled();
  });
});
