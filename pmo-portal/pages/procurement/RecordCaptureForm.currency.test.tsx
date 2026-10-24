/**
 * RecordCaptureForm — the amount is entered in the PURCHASE's currency (the server stamps the record with it, 0373),
 * so the amount field names that currency. No conversion happens; a purchase in USD takes its amount in USD.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const orgDefault = vi.hoisted(() => ({ value: 'exclusive' as string | undefined }));
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => orgDefault.value };
});

import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { RecordCaptureForm } from './RecordCaptureForm';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

beforeEach(() => setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }));
afterEach(() => resetActiveLocale());

function renderForm(kind: React.ComponentProps<typeof RecordCaptureForm>['kind'], currency?: string | null) {
  render(
    <ToastProvider>
      <RecordCaptureForm kind={kind} currency={currency} onCreate={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()} onStage={vi.fn()} />
    </ToastProvider>,
  );
}

describe('RecordCaptureForm — the amount names the purchase currency', () => {
  it.each(['purchase_order', 'payment', 'vendor_invoice'] as const)('a %s on a USD purchase asks for the amount in USD', (kind) => {
    renderForm(kind, 'USD');
    expect(screen.getByLabelText(/^Amount \(optional\) · USD$/)).toBeInTheDocument();
  });

  it('without a known currency the label is unchanged', () => {
    renderForm('purchase_order', null);
    expect(screen.getByLabelText(/^Amount \(optional\)$/)).toBeInTheDocument();
  });
});
