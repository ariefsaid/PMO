vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }) }));
/**
 * #694 — the Estimate & tax group names the organization currency once so every amount in the group
 * has the same unit without repeating an adornment on each input.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

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

const fieldContainerText = (label: RegExp) => screen.getByLabelText(label).parentElement!.textContent;

beforeEach(() => {
  org.currency = 'IDR';
});

describe('#694 ProjectFormModal — one currency applies to the estimate and tax group', () => {
  it('#694: an IDR org sees its currency in the Estimate & tax group heading', () => {
    renderModal();
    expect(screen.getByText('Estimate & tax · IDR')).toBeInTheDocument();
    expect(fieldContainerText(/estimated value/i)).not.toContain('IDR');
    expect(fieldContainerText(/estimated value/i)).not.toContain('$');
  });

  it('#694: the same group currency covers the conditional tax amount without repeating the unit', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '1000');
    expect(screen.getByText('Estimate & tax · IDR')).toBeInTheDocument();
    expect(fieldContainerText(/tax amount/i)).not.toContain('IDR');
    expect(fieldContainerText(/tax amount/i)).not.toContain('$');
  });

  it('#694: a USD org shows USD in the group heading', () => {
    org.currency = 'USD';
    renderModal();
    expect(screen.getByText('Estimate & tax · USD')).toBeInTheDocument();
  });
});
