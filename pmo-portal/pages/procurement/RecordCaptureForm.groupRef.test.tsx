/**
 * AC-EXT-001 (#769) — the capture form carries the parent group's number for PR / PO / vendor
 * invoice only, trimmed, and hands it to the create path as `externalRef`.
 */
import { describe, it, expect, vi } from 'vitest';

// The VI branch of the form reads the org tax default; stub only that READ (as the grvi spec does).
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { RecordCaptureForm } from './RecordCaptureForm';

function renderForm(kind: React.ComponentProps<typeof RecordCaptureForm>['kind']) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <RecordCaptureForm kind={kind} onCreate={onCreate} onClose={vi.fn()} />
    </ToastProvider>,
  );
  return onCreate;
}

describe('AC-EXT-001 RecordCaptureForm group reference', () => {
  it('a purchase order passes the trimmed group ref as externalRef', async () => {
    const onCreate = renderForm('purchase_order');
    await userEvent.type(screen.getByTestId('purchase_order-group-ref-input'), '  PRO-0026100002 ');
    await userEvent.click(screen.getByTestId('purchase_order-save-btn'));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ externalRef: 'PRO-0026100002' });
  });

  it('an empty group ref sends no externalRef', async () => {
    const onCreate = renderForm('purchase_request');
    await userEvent.click(screen.getByTestId('purchase_request-save-btn'));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).not.toHaveProperty('externalRef');
  });

  it('RFQ and payment forms do not offer the field', () => {
    renderForm('rfq');
    expect(screen.queryByTestId('rfq-group-ref-input')).not.toBeInTheDocument();
  });
});
