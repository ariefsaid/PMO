import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { clearOwnershipCache, setDomainOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import { LedgerCaptureRow } from './LedgerCaptureRow';

afterEach(() => clearOwnershipCache());

const renderRow = (isApprover: boolean) => render(
  <LedgerCaptureRow
    status="Vendor Invoiced"
    existingTypes={new Set()}
    onCreate={async () => undefined}
    canWrite
    isApprover={isApprover}
  />,
);

describe('vendor payment SoD affordance', () => {
  it('disables payment for the approver on an ERP-owned procurement with the reason', () => {
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    renderRow(true);
    expect(screen.getByRole('button', { name: 'Capture Payment' })).toBeDisabled();
    expect(screen.getByText('Separation of duties: the approver cannot pay their own procurement.')).toBeInTheDocument();
  });

  it('keeps payment available to a non-approver payer', () => {
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    renderRow(false);
    expect(screen.getByRole('button', { name: 'Capture Payment' })).toBeEnabled();
  });
});
