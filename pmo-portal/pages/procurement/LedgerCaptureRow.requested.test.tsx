import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { LedgerCaptureRow } from './LedgerCaptureRow';

const renderRow = (status: 'Requested' | 'Draft') => render(
  <LedgerCaptureRow status={status} existingTypes={new Set()} onCreate={async () => undefined} canWrite firstDocumentKinds={['purchase_request', 'vendor_invoice']} />,
);

describe('LedgerCaptureRow on a purchase awaiting approval (ADR-0093)', () => {
  it('offers no record action on a Requested purchase and says it is waiting for approval', () => {
    renderRow('Requested');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Waiting for approval. Documents can be recorded once it is approved.')).toBeInTheDocument();
  });
  it('says the same when the submitted request is already in the ledger', () => {
    render(<LedgerCaptureRow status="Requested" existingTypes={new Set(['PR'] as never)} onCreate={async () => undefined} canWrite />);
    expect(screen.getByTestId('ledger-awaiting-approval')).toBeInTheDocument();
  });
  it('shows nothing to a viewer who cannot record documents', () => {
    render(<LedgerCaptureRow status="Requested" existingTypes={new Set()} onCreate={async () => undefined} canWrite={false} />);
    expect(screen.queryByTestId('ledger-awaiting-approval')).toBeNull();
  });
  it('AC-PFE-010: choosing Vendor invoice as the first document of a Draft offers the vendor invoice capture', () => {
    renderRow('Draft');
    fireEvent.change(screen.getByLabelText('Record the first document'), { target: { value: 'vendor_invoice' } });
    expect(screen.getByRole('button', { name: 'Capture Supplier invoice' })).toBeInTheDocument();
  });
});
