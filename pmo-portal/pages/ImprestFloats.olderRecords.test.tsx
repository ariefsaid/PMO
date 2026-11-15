import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-PAGE-024 (#843): with more site floats than one page, the oldest float is reachable from the list and the
 * list says how many it shows of how many exist. The real paging hook runs; only the repository is mocked.
 */
const h = vi.hoisted(() => ({ listFloats: vi.fn(), countFloats: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { imprest: { listFloats: h.listFloats, countFloats: h.countFloats } } }));
vi.mock('@/src/hooks/useImprest', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/hooks/useImprest')>();
  return {
    useImprestFloatPages: real.useImprestFloatPages,
    useImprestPosition: () => ({ data: undefined, isPending: false, isError: false }),
    useEstablishFloat: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));

import ImprestFloatsPage from './ImprestFloats';

const float = (n: number, name = `Site ${n}`) => ({
  id: `f${n}`, currency: 'IDR', project: { name }, custodian: { full_name: 'Site Custodian' },
  created_at: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000000+00:00`,
});
const NEWEST = Array.from({ length: 50 }, (_, i) => float(51 - i));
const OLDEST = float(1, 'Oldest site');

const Where: React.FC = () => <output data-testid="where">{useLocation().search}</output>;
const renderPage = (entry = '/imprest') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[entry]}><ToastProvider><ImprestFloatsPage /><Where /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.listFloats.mockReset().mockImplementation(async (page?: number) =>
    (page ?? 1) > 1 ? { rows: [OLDEST], truncated: false } : { rows: NEWEST, truncated: true });
  h.countFloats.mockReset().mockResolvedValue(51);
});

describe('AC-PAGE-024 site floats beyond the first page', () => {
  it('AC-PAGE-024 the list reads "Showing 1–50 of 51", has numbered pages and no Load more', async () => {
    renderPage();
    expect(await screen.findByText('Showing 1–50 of 51')).toBeInTheDocument();
    expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument();
    expect(screen.queryByText('Oldest site')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('AC-PAGE-024 the oldest float is reachable by page 2, which is kept in the address', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Page 2' }));
    expect(await screen.findByText('Oldest site')).toBeInTheDocument();
    expect(screen.getByText('Showing 51–51 of 51')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('?page=2');
    expect(h.listFloats).toHaveBeenLastCalledWith(2);
  });

  it('AC-PAGE-025 an address naming page 2 opens on it; Previous returns to the first page and a clean address', async () => {
    const user = userEvent.setup();
    renderPage('/imprest?page=2');
    expect(await screen.findByText('Oldest site')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('Showing 1–50 of 51')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^$/);
  });

  it('AC-PAGE-025 an address past the last page is corrected to the last page', async () => {
    renderPage('/imprest?page=9');
    expect(await screen.findByText('Oldest site')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?page=2'));
  });

  it('AC-PAGE-023 a failed page read says so with a retry, and the retry loads the page', async () => {
    let failNext = true;
    h.listFloats.mockImplementation(async (page?: number) => {
      if ((page ?? 1) === 1) return { rows: NEWEST, truncated: true };
      if (failNext) { failNext = false; throw new Error('network'); }
      return { rows: [OLDEST], truncated: false };
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Page 2' }));
    await user.click(await screen.findByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText('Oldest site')).toBeInTheDocument();
  });
});
