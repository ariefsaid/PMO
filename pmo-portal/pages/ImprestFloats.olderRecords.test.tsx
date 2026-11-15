import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/imprest']}><ToastProvider><ImprestFloatsPage /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.listFloats.mockReset().mockImplementation(async (cursor?: unknown) =>
    cursor ? { rows: [OLDEST], truncated: false } : { rows: NEWEST, truncated: true });
  h.countFloats.mockReset().mockResolvedValue(51);
});

describe('AC-PAGE-024 site floats beyond the first page', () => {
  it('AC-PAGE-024 the list reads "Showing 50 of 51" and drops the "latest 200" dead end', async () => {
    renderPage();
    expect(await screen.findByText('Showing 50 of 51')).toBeInTheDocument();
    expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument();
    expect(screen.queryByText('Oldest site')).not.toBeInTheDocument();
  });

  it('AC-PAGE-024 the oldest float is reachable and the count then reads 51 of 51', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Oldest site')).toBeInTheDocument();
    expect(screen.getByText('Showing 51 of 51')).toBeInTheDocument();
    expect(h.listFloats).toHaveBeenLastCalledWith({ createdAt: NEWEST[49].created_at, id: NEWEST[49].id });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('AC-PAGE-023 a failed second page keeps the first page on screen with a retry at the Load more spot', async () => {
    let failNext = true;
    h.listFloats.mockImplementation(async (cursor?: unknown) => {
      if (!cursor) return { rows: NEWEST, truncated: true };
      if (failNext) { failNext = false; throw new Error('network'); }
      return { rows: [OLDEST], truncated: false };
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText("Couldn't load more site cash floats")).toBeInTheDocument();
    expect(screen.getByText(NEWEST[0].project.name)).toBeInTheDocument();
    expect(screen.getByText('Showing 50 of 51')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText('Oldest site')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load more site cash floats")).not.toBeInTheDocument();
  });
});
