import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { M365BrowseNotice } from './M365BrowseNotice';

const connect = vi.hoisted(() => ({ initiate: vi.fn() }));
vi.mock('@/src/lib/m365/connectClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/m365/connectClient')>()),
  initiateM365Connect: connect.initiate,
}));

const renderNotice = (props: React.ComponentProps<typeof M365BrowseNotice>) =>
  render(<MemoryRouter><M365BrowseNotice {...props} /></MemoryRouter>);

const GENERIC = 'Microsoft could not load this location. Check access and SharePoint availability with your Microsoft admin, or retry.';
const LEAKS = /raw-synthetic|synthetic-item-id|Files\.Read\.All|oid|tenant|error_description/i;

beforeEach(() => { connect.initiate.mockReset(); });

describe('M365BrowseNotice', () => {
  it('AC-M365DOC-032 stale and revoked connections show reviewed expiry copy with a Reconnect action', () => {
    for (const code of ['CONNECTION_STALE', 'CONNECTION_REVOKED']) {
      const { unmount } = renderNotice({ code, onReconnect: vi.fn() });
      expect(screen.getByRole('alert')).toHaveTextContent('The Microsoft 365 connection expired. Reconnect to link more documents.');
      expect(screen.getByRole('button', { name: 'Reconnect Microsoft 365' })).toBeInTheDocument();
      unmount();
    }
  });

  it('AC-M365DOC-034 insufficient scope shows reconnect-to-grant copy without scope strings or paths', () => {
    renderNotice({ code: 'SCOPE_INSUFFICIENT' });
    expect(screen.getByRole('alert')).toHaveTextContent('The connection needs additional permissions. Reconnect to grant them.');
    expect(screen.getByRole('button', { name: 'Reconnect Microsoft 365' })).toBeInTheDocument();
    expect(screen.queryByText(LEAKS)).not.toBeInTheDocument();
  });

  it('AC-M365DOC-031 an absent connection links to the existing setup flow instead of reconnecting', () => {
    renderNotice({ code: 'NOT_CONNECTED' });
    expect(screen.getByRole('alert')).toHaveTextContent('Connect Microsoft 365 first to browse documents.');
    expect(screen.getByRole('link', { name: 'Go to Microsoft 365 setup' })).toHaveAttribute('href', '/administration/integrations');
    expect(screen.queryByRole('button', { name: 'Reconnect Microsoft 365' })).not.toBeInTheDocument();
  });

  it('AC-M365DOC-035 network failure keeps the selection and offers retry only', async () => {
    const onRetry = vi.fn();
    renderNotice({ code: 'external-unreachable', onRetry, onReconnect: vi.fn() });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load Microsoft items. Retry; your selection and location are kept.');
    expect(screen.queryByRole('button', { name: 'Reconnect Microsoft 365' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('AC-M365DOC-035 opaque Graph, internal and unknown raw codes use the one generic sentence and never a reconnect', () => {
    for (const code of ['GRAPH_ERROR', 'INTERNAL_ERROR', 'raw-synthetic-error: tenant 0000 oid Files.Read.All', undefined]) {
      const { unmount } = renderNotice({ code, onRetry: vi.fn(), onReconnect: vi.fn() });
      expect(screen.getByRole('alert')).toHaveTextContent(GENERIC);
      expect(screen.queryByRole('button', { name: 'Reconnect Microsoft 365' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(LEAKS);
      unmount();
    }
  });

  it('AC-M365DOC-035 entitlement, approval and membership codes use the shared reviewed copy with no reconnect/retry loop', () => {
    for (const code of ['NOT_ENTITLED', 'ORG_APPROVAL_REQUIRED', 'DISABLED_MEMBER', 'BANNED_MEMBER', 'FORBIDDEN']) {
      const { unmount } = renderNotice({ code, onRetry: vi.fn(), onReconnect: vi.fn() });
      expect(screen.getByRole('alert').textContent).not.toBe(GENERIC);
      expect(screen.queryByRole('button', { name: /Reconnect|Retry/ })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('AC-M365DOC-032 default Reconnect calls the existing connect flow and redirects only to its returned https URL', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    connect.initiate.mockResolvedValue({ authorizeUrl: 'https://login.example.invalid/authorize?x=1', state: 'synthetic-state' });
    renderNotice({ code: 'CONNECTION_STALE' });
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect Microsoft 365' }));
    expect(connect.initiate).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('https://login.example.invalid/authorize?x=1');
    vi.unstubAllGlobals();
  });

  it('AC-M365DOC-035 a failed or non-https reconnect shows safe copy and does not navigate', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    connect.initiate.mockResolvedValueOnce({ authorizeUrl: 'javascript:alert(1)', state: 's' });
    renderNotice({ code: 'CONNECTION_REVOKED' });
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect Microsoft 365' }));
    expect(await screen.findByText('Could not start the Microsoft 365 reconnect. Try again.')).toBeInTheDocument();
    connect.initiate.mockRejectedValueOnce(new Error('raw-synthetic-error'));
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect Microsoft 365' }));
    expect(await screen.findByText('Could not start the Microsoft 365 reconnect. Try again.')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/raw-synthetic/);
    vi.unstubAllGlobals();
  });
});
