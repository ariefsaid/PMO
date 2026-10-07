/**
 * #520 — on a flipped (ERPNext-owned) org the vendor-invoice capture lets the user choose the ERPNext
 * Purchase Taxes and Charges Template; the choice is staged through the confirm to the dispatch.
 * "Enter the tax amounts" is the pre-selected option (#876 slice 2, DD-VWH-15) — RecordCaptureForm.vendorTax.test.tsx
 * owns it. A PMO-owned org never sees the picker (it authors its own tax).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const templates = vi.hoisted(() => ({ list: vi.fn(async () => [{ name: 'Input VAT 11' }, { name: 'Input VAT 0' }]) }));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = (await orig()) as { repositories: Record<string, unknown> };
  return {
    ...actual,
    repositories: {
      ...actual.repositories,
      integrations: { listPurchaseTaxTemplates: templates.list },
    },
  };
});
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => undefined };
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { RecordCaptureForm } from './RecordCaptureForm';
import { queryClient } from '@/src/lib/queryClient';
import * as ownership from '@/src/lib/adapterSeam/ownershipCache';

function renderVI(onStage = vi.fn()) {
  render(
    <ToastProvider>
      <RecordCaptureForm kind="vendor_invoice" onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} />
    </ToastProvider>,
  );
  return onStage;
}

beforeEach(() => {
  queryClient.clear();
  templates.list.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('RecordCaptureForm — ERPNext purchase tax template (#520)', () => {
  it('AC-520-9 a flipped org offers the ERP templates and stages the chosen one', async () => {
    vi.spyOn(ownership, 'routeDomainWrite').mockReturnValue('external');
    const onStage = renderVI();
    const select = (await screen.findByTestId('vi-tax-template-select')) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'Input VAT 11', 'Input VAT 0']));
    expect(select.value).toBe('');
    await userEvent.selectOptions(select, 'Input VAT 11');
    // #876 slice 2 (OQ-VWH-8): a flipped org's bill amount is no longer asked — ERPNext totals the items.
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'createVI', taxTemplate: 'Input VAT 11' }));
  });

  it('AC-520-9 a PMO-owned org shows no template picker and reads no ERP templates', () => {
    vi.spyOn(ownership, 'routeDomainWrite').mockReturnValue('pmo');
    renderVI();
    expect(screen.queryByTestId('vi-tax-template-select')).not.toBeInTheDocument();
    expect(templates.list).not.toHaveBeenCalled();
  });
});
