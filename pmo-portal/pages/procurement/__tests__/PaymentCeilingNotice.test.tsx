import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { PaymentCeilingNotice } from '../PaymentCeilingNotice';
import { formatCurrency } from '@/src/lib/format';

const OVER = { ok: false, reason: 'vendor bill exceeds approved amount', billedNet: 1200, approvedAmount: 1000 };

describe('PaymentCeilingNotice', () => {
  it('AC-SEC-220: explains the overage in one sentence and offers no action to an ineligible viewer', () => {
    render(<PaymentCeilingNotice ceiling={OVER} currency="USD" canApprove={false} onApprove={vi.fn()} />);
    expect(screen.getByTestId('payment-ceiling-note')).toHaveTextContent(
      `Billed amount exceeds the approved amount by ${formatCurrency(200, 'USD')}. An approver must approve the higher amount.`,
    );
    expect(screen.queryByRole('button', { name: 'Approve higher amount' })).toBeNull();
  });

  it.each([
    ['bill_recorder', 'The person who recorded the bill cannot approve the higher amount.'],
    ['quote_selector', 'The person who selected the quote cannot approve the higher amount.'],
    ['requester', 'The requester cannot approve the higher amount.'],
    ['routing', 'A designated approver must approve the higher amount.'],
    ['unavailable', 'Approval eligibility is unavailable. Refresh this page and try again.'],
  ])('explains the server decision %s', (eligibilityReason, message) => {
    render(<PaymentCeilingNotice ceiling={OVER} currency="USD" canApprove={false} eligibilityReason={eligibilityReason} onApprove={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Approve higher amount' })).toBeNull();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('AC-SEC-220: an eligible approver confirms and approves the billed amount', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<PaymentCeilingNotice ceiling={OVER} currency="USD" canApprove onApprove={onApprove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve higher amount' }));
    // Confirm-before-write: nothing is approved until the dialog is confirmed.
    expect(onApprove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(formatCurrency(1200, 'USD'));
    expect(dialog).toHaveTextContent(formatCurrency(1000, 'USD'));
    expect(dialog).toHaveTextContent('You will not be able to pay this procurement yourself.');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith(1200));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('AC-SEC-220: cancelling the confirmation approves nothing', async () => {
    const onApprove = vi.fn();
    render(<PaymentCeilingNotice ceiling={OVER} currency="USD" canApprove onApprove={onApprove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve higher amount' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onApprove).not.toHaveBeenCalled();
  });

  it.each([
    ['no ceiling was read', null],
    ['the bill is within the approved amount', { ok: true, reason: null, billedNet: 900, approvedAmount: 1000 }],
    ['the refusal is not an overage', { ok: false, reason: 'bill currency differs from procurement currency', billedNet: null, approvedAmount: 1000 }],
    ['no approved amount is recorded', { ok: false, reason: 'approved amount is missing', billedNet: 900, approvedAmount: null }],
  ])('AC-SEC-220: renders nothing when %s', (_label, ceiling) => {
    const { container } = render(<PaymentCeilingNotice ceiling={ceiling} currency="USD" canApprove onApprove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
