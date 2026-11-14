import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({
  useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});
vi.mock('@/src/hooks/useProjectNumberProposal', () => ({
  useProjectNumberProposal: (clientId: string | null) => clientId
    ? { status: 'success', number: 'PMO-2026-TEST-0001', error: null }
    : { status: 'idle', number: null, error: null },
}));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const { roleBox, createMutation, navigate, returnToList } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
  createMutation: vi.fn(),
  navigate: vi.fn(),
  returnToList: vi.fn(),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
  useProjectMutations: () => ({ create: { mutateAsync: createMutation, isPending: false } }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useListReturn', () => ({ useListReturn: () => ({ openRecord: vi.fn(), returnToList }) }));
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

import ProjectNew from '../ProjectNew';

const renderPage = (role = 'Project Manager') => {
  roleBox.value = role;
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/projects/new', state: { pmoListReturn: { list: 'projects' } } }]}>
      <ToastProvider>
        <ProjectNew />
      </ToastProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  navigate.mockClear();
  returnToList.mockClear();
  createMutation.mockReset();
});

describe('ProjectNew floor', () => {
  it('floor: an error-summary anchor moves focus to its matching field', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/project name/i), 'Site Upgrade');
    await user.click(screen.getByRole('combobox', { name: /client company/i }));
    await user.click(await screen.findByRole('option', { name: /Innovate Corp/i }));
    // A non-blank but unparseable value passes the completeness gate and errors on submit.
    await user.type(screen.getByLabelText(/estimated value/i), 'abc');
    await user.click(screen.getByRole('button', { name: /^Create project$/i }));

    const summary = screen.getAllByRole('alert').find((region) => region.querySelector('a'))!;
    expect(summary).toBeTruthy();
    const anchor = summary.querySelector('a')!;
    // The anchor targets the invalid field's id (a real browser focuses it on click; jsdom
    // does not implement fragment focus, so the binding is asserted on the href↔id pair).
    const targetId = anchor.getAttribute('href')!.slice(1);
    expect(targetId).toBe('project-form-value');
    expect(screen.getByLabelText(/estimated value/i)).toHaveAttribute('id', targetId);
    anchor.click();
    expect(screen.getByLabelText(/estimated value/i)).toHaveAttribute('id', targetId);
  });

  it('floor: the access-denied Projects back action returns to the list', async () => {
    const user = userEvent.setup();
    renderPage('Finance');
    expect(screen.getByText(/can't create projects/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Projects' }));
    expect(returnToList).toHaveBeenCalledTimes(1);
  });
});
