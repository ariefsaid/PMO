/**
 * #694 — the create-project form's money inputs carried a literal `$` adornment, so an Admin in an
 * IDR organization typed an amount beside a dollar sign. The adornment is the ORG's currency (a new
 * project takes the org default, migration 0187), through the shared `currencySymbol` helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { currencySymbol } from '@/src/lib/format';

const org = vi.hoisted(() => ({ currency: 'IDR' }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => org.currency }));
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [{ id: 'c9', name: 'Asset Owner', type: 'Client' }], isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));

vi.mock('@/src/hooks/useProjectNumberProposal', () => ({
  useProjectNumberProposal: () => ({ status: 'success', number: 'PMO-TEST-0001', error: null }),
}));

import ProjectFormModal from './ProjectFormModal';

function renderModal() {
  render(
    <ToastProvider>
      <ProjectFormModal mode="create" onClose={vi.fn()} onSubmit={vi.fn()} onError={vi.fn()} />
    </ToastProvider>,
  );
}

const adornmentOf = (label: RegExp) => screen.getByLabelText(label).parentElement!.textContent;

beforeEach(() => {
  org.currency = 'IDR';
});

describe('#694 ProjectFormModal — money adornment is the org currency', () => {
  it('#694: an IDR org sees the IDR glyph beside Estimated value, never a dollar sign', () => {
    renderModal();
    expect(adornmentOf(/estimated value/i)).toBe(currencySymbol('IDR'));
    expect(adornmentOf(/estimated value/i)).not.toContain('$');
  });

  it('#694: the tax amount adornment (asked once a value is entered) is the org currency too', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '1000');
    expect(adornmentOf(/tax amount/i)).toBe(currencySymbol('IDR'));
  });

  it('#694: a USD org still shows $', () => {
    org.currency = 'USD';
    renderModal();
    expect(adornmentOf(/estimated value/i)).toBe('$');
  });
});
