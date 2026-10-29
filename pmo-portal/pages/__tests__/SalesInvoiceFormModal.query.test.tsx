import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const transport = vi.hoisted(() => ({ clients: vi.fn(), projects: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { company: { listClients: transport.clients }, project: { list: transport.projects } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-test' } }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false }) }));
import { SalesInvoiceFormModal } from '../sales-invoices/SalesInvoiceFormModal';

const customer = { id: 'c1', name: 'Customer One', short_name: null };
const project = { id: 'p1', name: 'Project One', client_id: 'c1', archived_at: null, subject_to_vat: false, tax_rate: null };

describe('invoice picker query recovery', () => {
  it.each(['Customer', 'Project'])('settles a failed %s query and retries explicitly', async (picker) => {
    transport.clients.mockReset(); transport.projects.mockReset();
    const failed = picker === 'Customer' ? transport.clients : transport.projects;
    transport.clients.mockResolvedValue([customer]); transport.projects.mockResolvedValue([project]);
    failed.mockImplementation(async () => { throw new Error('read unavailable'); });
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 1, refetchOnWindowFocus: false } } });
    const user = userEvent.setup();
    const view = render(<QueryClientProvider client={client}><MemoryRouter><SalesInvoiceFormModal onClose={vi.fn()} onCreate={vi.fn()} native pendingPush={{ status: 'idle', error: null }} /></MemoryRouter></QueryClientProvider>);
    await user.click(screen.getByRole('combobox', { name: picker }));
    expect(await screen.findByRole('button', { name: /^Retry$/ }, { timeout: 2000 })).toBeInTheDocument();
    const count = failed.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(failed).toHaveBeenCalledTimes(count);
    failed.mockResolvedValue(picker === 'Customer' ? [customer] : [project]);
    await user.click(screen.getByRole('button', { name: /^Retry$/ }));
    expect(await screen.findByRole('option', { name: new RegExp(picker + ' One') })).toBeInTheDocument();
    expect(within(screen.getByRole('listbox')).queryByText(/no .* found/i)).not.toBeInTheDocument();
    view.unmount(); client.clear();
  });
  it('distinguishes a pending customer read from an empty successful read', async () => {
    transport.clients.mockReset(); transport.projects.mockReset();
    let resolve!: (rows: unknown[]) => void;
    transport.clients.mockImplementation(() => new Promise((r) => { resolve = r; }));
    transport.projects.mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 1 } } });
    const user = userEvent.setup();
    const view = render(<QueryClientProvider client={client}><MemoryRouter><SalesInvoiceFormModal onClose={vi.fn()} onCreate={vi.fn()} native pendingPush={{ status: 'idle', error: null }} /></MemoryRouter></QueryClientProvider>);
    await user.click(screen.getByRole('combobox', { name: 'Customer' }));
    expect(screen.getByTestId('combo-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Retry$/ })).not.toBeInTheDocument();
    await act(async () => resolve([]));
    expect(await screen.findByText('No customer matches.')).toBeInTheDocument();
    expect(screen.queryByTestId('combo-loading')).not.toBeInTheDocument();
    view.unmount(); client.clear();
  });

  it('offers only live projects belonging to the selected customer', async () => {
    transport.clients.mockReset().mockResolvedValue([customer]);
    transport.projects.mockReset().mockResolvedValue([project, { ...project, id: 'p2', name: 'Other customer project', client_id: 'c2' }, { ...project, id: 'p3', name: 'Archived project', archived_at: '2026-01-01' }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 1 } } });
    const user = userEvent.setup();
    const view = render(<QueryClientProvider client={client}><MemoryRouter><SalesInvoiceFormModal onClose={vi.fn()} onCreate={vi.fn()} native pendingPush={{ status: 'idle', error: null }} /></MemoryRouter></QueryClientProvider>);
    await user.click(screen.getByRole('combobox', { name: 'Customer' }));
    await user.click(await screen.findByRole('option', { name: /Customer One/ }));
    await user.click(screen.getByRole('combobox', { name: 'Project' }));
    expect(await screen.findByRole('option', { name: /Project One/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Other customer project|Archived project/ })).not.toBeInTheDocument();
    view.unmount(); client.clear();
  });

  it('does not treat stale cached customers as a successful read after a query error', async () => {
    transport.clients.mockReset().mockRejectedValue(new Error('read unavailable'));
    transport.projects.mockReset().mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 1, refetchOnWindowFocus: false } } });
    client.setQueryData(['fk-options', 'client', 'org-test'], [{ value: 'c1', label: 'Customer One' }]);
    await client.fetchQuery({ queryKey: ['fk-options', 'client', 'org-test'], queryFn: () => transport.clients(), staleTime: 0 }).catch(() => undefined);
    const user = userEvent.setup();
    const view = render(<QueryClientProvider client={client}><MemoryRouter><SalesInvoiceFormModal onClose={vi.fn()} onCreate={vi.fn()} native pendingPush={{ status: 'idle', error: null }} /></MemoryRouter></QueryClientProvider>);
    await user.click(screen.getByRole('combobox', { name: 'Customer' }));
    expect(await screen.findByRole('button', { name: /^Retry$/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Customer One/ })).not.toBeInTheDocument();
    transport.clients.mockResolvedValue([customer]);
    await user.click(screen.getByRole('button', { name: /^Retry$/ }));
    expect(await screen.findByRole('option', { name: /Customer One/ })).toBeInTheDocument();
    view.unmount(); client.clear();
  });

});
