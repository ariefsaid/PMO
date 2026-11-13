import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({
  conn: { data: undefined as unknown },
  links: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  can: { manage: true },
  setPlan: vi.fn(),
  census: vi.fn(),
}));
vi.mock('@/src/hooks/useOdoo', () => ({
  useOdooConnection: () => h.conn,
  useOdooProjectLinks: () => h.links,
  useOdooSetup: () => ({ mutateAsync: h.setPlan, isPending: false }),
}));
vi.mock('./useOdooCan', () => ({ useOdooCan: () => h.can }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: { startConnectCensus: h.census } } }));
vi.mock('../ConnectProposalReview', () => ({ ConnectProposalReview: (p: { tier: string }) => <div data-testid="review" data-tier={p.tier} /> }));
vi.mock('../ErpSendStates', () => ({ ErpSendStates: (p: { tier: string }) => <li data-testid="sends" data-tier={p.tier} /> }));

import { OdooRecordsSetup } from './OdooRecordsSetup';

const active = { status: 'active', activated: true, capabilities: { missing: [] }, config: {}, connection: null };
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OdooRecordsSetup /></QueryClientProvider>,
);
beforeEach(() => {
  vi.clearAllMocks();
  h.conn.data = active;
  h.can.manage = true;
  h.links.data = { planId: 7, plans: [], accounts: [], linked: [] };
  h.links.isPending = false;
  h.links.isError = false;
  h.setPlan.mockResolvedValue({ saved: true });
  h.census.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('AC-ODS-001 the record review and send states for Odoo', () => {
  it('AC-ODS-001 an Admin on an activated connection sees the review and the send states for Odoo, in one named region', () => {
    renderIt();
    const region = screen.getByRole('region', { name: 'Records in PMO and Odoo' });
    expect(within(region).getByTestId('review')).toHaveAttribute('data-tier', 'odoo');
    expect(within(region).getByTestId('sends')).toHaveAttribute('data-tier', 'odoo');
  });

  it('AC-ODS-001 a connection that is not activated, or not active, shows nothing', () => {
    h.conn.data = { ...active, activated: false };
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
    cleanup();
    h.conn.data = { ...active, status: 'disconnected' };
    const again = renderIt();
    expect(again.container).toBeEmptyDOMElement();
    cleanup();
    h.conn.data = undefined;
    expect(renderIt().container).toBeEmptyDOMElement();
  });

  it('AC-ODS-001 Finance, Engineer and an Admin viewing as another role (manage false) see nothing', () => {
    h.can.manage = false;
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AC-ODS-004 the analytic plan is chosen once, inside setup', () => {
  it('AC-ODS-004 one plan in Odoo is proposed; one click saves it and the census is read again so projects can be sent', async () => {
    h.links.data = { planId: null, plans: [{ id: '3', name: 'Projects' }], accounts: [], linked: [] };
    renderIt();
    expect(screen.getByText('Project cost accounts')).toBeInTheDocument();
    expect(screen.getByText('Proposed: Projects')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use Projects' }));
    await waitFor(() => expect(h.setPlan).toHaveBeenCalledWith({ planId: '3' }));
    await waitFor(() => expect(h.census).toHaveBeenCalledWith('odoo'));
  });

  it('AC-ODS-004 several plans: the Admin picks one first; the button stays off until then', async () => {
    h.links.data = { planId: null, plans: [{ id: '3', name: 'Projects' }, { id: '5', name: 'Sites' }], accounts: [], linked: [] };
    renderIt();
    const use = screen.getByRole('button', { name: 'Use this plan' });
    expect(use).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analytic plan' }), '5');
    await userEvent.click(use);
    await waitFor(() => expect(h.setPlan).toHaveBeenCalledWith({ planId: '5' }));
    await waitFor(() => expect(h.census).toHaveBeenCalledWith('odoo'));
  });

  it('AC-ODS-004 Odoo with no analytic plan says so and offers no button', () => {
    h.links.data = { planId: null, plans: [], accounts: [], linked: [] };
    renderIt();
    expect(screen.getByText('Odoo has no analytic plan yet. Add one in Odoo, then check again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use/ })).toBeNull();
  });

  it('formC keeps Use <name> and Use this plan outlined, as on dev', () => {
    h.links.data = { planId: null, plans: [{ id: '3', name: 'Projects' }], accounts: [], linked: [] };
    const { unmount } = renderIt();
    const named = screen.getByRole('button', { name: 'Use Projects' });
    expect(named).toHaveClass('bg-card', 'border-border');
    expect(named).not.toHaveClass('bg-primary');
    unmount();
    h.links.data = { planId: null, plans: [{ id: '3', name: 'Projects' }, { id: '5', name: 'Sites' }], accounts: [], linked: [] };
    renderIt();
    const usePlan = screen.getByRole('button', { name: 'Use this plan' });
    expect(usePlan).toHaveClass('bg-card', 'border-border');
    expect(usePlan).not.toHaveClass('bg-primary');
  });

  it('AC-ODS-004 once a plan is chosen the plan block is gone and the review stays', () => {
    h.links.data = { planId: 7, plans: [], accounts: [], linked: [] };
    renderIt();
    expect(screen.queryByText('Project cost accounts')).toBeNull();
    expect(screen.getByTestId('review')).toBeInTheDocument();
  });

  it('AC-ODS-004 a refusal says why in plain words and the census is not started', async () => {
    h.links.data = { planId: null, plans: [{ id: '3', name: 'Projects' }], accounts: [], linked: [] };
    h.setPlan.mockRejectedValue(new AppError('server words', 'FORBIDDEN'));
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Use Projects' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your role cannot do this.');
    expect(h.census).not.toHaveBeenCalled();
  });

  it('AC-ODS-004 a census that fails to start after the plan is saved tells the Admin to press Check again', async () => {
    h.links.data = { planId: null, plans: [{ id: '3', name: 'Projects' }], accounts: [], linked: [] };
    h.census.mockRejectedValue(new Error('down'));
    const { rerender } = renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Use Projects' }));
    await waitFor(() => expect(h.census).toHaveBeenCalledWith('odoo'));
    // The plan read now shows the plan chosen, as it does after the invalidation.
    h.links.data = { planId: '3', plans: [], accounts: [], linked: [] };
    rerender(<QueryClientProvider client={new QueryClient()}><OdooRecordsSetup /></QueryClientProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Projects could not be checked yet. Press Check again.');
  });

  it('AC-ODS-004 plans that cannot be loaded say so and Retry reads them again', async () => {
    h.links.data = undefined;
    h.links.isError = true;
    renderIt();
    expect(screen.getByText('The analytic plans could not be loaded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.links.refetch).toHaveBeenCalled();
  });
});
