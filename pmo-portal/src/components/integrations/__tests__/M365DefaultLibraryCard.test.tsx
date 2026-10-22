import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppError } from '@/src/lib/appError';
import { M365DefaultLibraryCard } from '../M365DefaultLibraryCard';

vi.unmock('../M365DefaultLibraryCard');

const mock = vi.hoisted(() => ({
  manage: true,
  setter: true,
  docs: {} as Record<string, unknown>,
  setDefault: vi.fn(),
  listSites: vi.fn(),
  listDrives: vi.fn(),
  refetch: vi.fn(),
}));
// The card mounts LinkExistingRecordFolders (own coverage: LinkExistingRecordFolders.test).
vi.mock('@/src/components/m365/LinkExistingRecordFolders', () => ({ LinkExistingRecordFolders: () => null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'admin-1', org_id: 'org-1' } }) }));
vi.mock('@/src/components/m365/DocumentLinkPermissions', () => ({ useDocumentLinkPermissions: () => ({ manageDefault: () => mock.manage }) }));
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({
  useMicrosoftDocuments: () => mock.docs,
  useSetDefaultLibrary: () => (mock.setter ? { mutateAsync: mock.setDefault, isPending: false } : null),
}));
vi.mock('@/src/lib/m365/graphClient', () => ({
  listSites: (...a: unknown[]) => mock.listSites(...a),
  listDrives: (...a: unknown[]) => mock.listDrives(...a),
}));

const library = { site_id: 's1', site_name: 'Synthetic site', drive_id: 'd1', drive_name: 'Synthetic library' };
const active = { connected: true, status: 'active' };
const docs = (over: Record<string, unknown> = {}) => ({
  connection: active, defaultLibrary: null, isPending: false, defaultError: null, refetch: mock.refetch, ...over,
});
const view = (children?: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <M365DefaultLibraryCard>{children}</M365DefaultLibraryCard>
  </QueryClientProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  mock.manage = true; mock.setter = true; mock.docs = docs();
  mock.setDefault.mockResolvedValue(undefined);
  mock.listSites.mockResolvedValue({ value: [{ id: 's1', name: 'Synthetic site', web_url: 'https://x.invalid' }], next: null });
  mock.listDrives.mockResolvedValue({ value: [{ id: 'd1', name: 'Synthetic library', web_url: 'https://x.invalid' }], next: null });
});

async function chooseLibrary() {
  await userEvent.click(screen.getByRole('button', { name: 'Choose default library' }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Synthetic site' })).toBeInTheDocument());
  await userEvent.selectOptions(within(dialog).getByLabelText(/^Site/), 's1');
  await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Synthetic library' })).toBeInTheDocument());
  await userEvent.selectOptions(within(dialog).getByLabelText(/^Library/), 'd1');
  return dialog;
}

describe('M365DefaultLibraryCard choose', () => {
  it('AC-M365DOC-055 an active Admin picks a site and a library and saves exactly the four-field value', async () => {
    view();
    expect(screen.getByText('No default library is set.')).toBeInTheDocument();
    const dialog = await chooseLibrary();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save default' }));
    await waitFor(() => expect(mock.setDefault).toHaveBeenCalledTimes(1));
    expect(mock.setDefault).toHaveBeenCalledWith({ site_id: 's1', site_name: 'Synthetic site', drive_id: 'd1', drive_name: 'Synthetic library' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('AC-M365DOC-056 Save stays disabled until both a site and a library are chosen; no connection mutation happens', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Choose default library' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Save default' })).toBeDisabled();
    expect(mock.setDefault).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-060 a member sees the labels only: no choose, clear or footer slot', () => {
    mock.manage = false; mock.docs = docs({ defaultLibrary: library });
    view(<button>Link existing folders</button>);
    expect(screen.getByTestId('m365-default-library-current')).toHaveTextContent('Synthetic site / Synthetic library');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('AC-M365DOC-060 impersonation is view-only (the setter is null): labels show, no actions', () => {
    mock.setter = false; mock.docs = docs({ defaultLibrary: library });
    view();
    expect(screen.getByTestId('m365-default-library-current')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose default library|Clear default/ })).not.toBeInTheDocument();
  });

  it('AC-M365DOC-055 a failed save keeps the dialog and the chosen labels and shows a safe alert', async () => {
    mock.setDefault.mockRejectedValue(new AppError('permission denied for table org_m365_document_settings', '42501'));
    view();
    const dialog = await chooseLibrary();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save default' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not save the default library.');
    expect(within(dialog).getByLabelText(/^Site/)).toHaveValue('s1');
    expect(within(dialog).getByLabelText(/^Library/)).toHaveValue('d1');
    expect(screen.queryByText(/org_m365_document_settings/)).not.toBeInTheDocument();
  });

  it('AC-M365DOC-056 the footer slot renders beside the Admin actions for another lane to fill', () => {
    view(<button>Link existing folders</button>);
    expect(screen.getByRole('button', { name: 'Link existing folders' })).toBeInTheDocument();
  });

  it('AC-M365DOC-056 a disconnected Admin cannot browse (choose disabled with a hint)', () => {
    mock.docs = docs({ connection: { connected: false, status: null } });
    view();
    expect(screen.getByRole('button', { name: 'Choose default library' })).toBeDisabled();
    expect(screen.getByText(/Connect your Microsoft 365 account/)).toBeInTheDocument();
    expect(mock.listSites).not.toHaveBeenCalled();
  });
});

describe('M365DefaultLibraryCard clear and failed reads', () => {
  it('AC-M365DOC-055 clearing confirms, then writes null with no Graph call', async () => {
    mock.docs = docs({ defaultLibrary: library, connection: { connected: false, status: null } });
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Clear default' }));
    expect(mock.setDefault).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear default' }));
    await waitFor(() => expect(mock.setDefault).toHaveBeenCalledWith(null));
    expect(mock.listSites).not.toHaveBeenCalled();
    expect(mock.listDrives).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-055 cancelling the clear confirmation writes nothing', async () => {
    mock.docs = docs({ defaultLibrary: library });
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Clear default' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /cancel/i }));
    expect(mock.setDefault).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-055 a denied clear keeps the dialog open with an alert and the default still shown', async () => {
    mock.docs = docs({ defaultLibrary: library });
    mock.setDefault.mockRejectedValue(new AppError('permission denied', '42501'));
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Clear default' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear default' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not clear the default library.');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByTestId('m365-default-library-current')).toBeInTheDocument();
  });

  it('AC-M365DOC-056 an unreadable default is "unavailable" with retry, never "No default", and offers no clear', async () => {
    mock.docs = docs({ defaultError: new Error('boom') });
    view();
    expect(screen.getByText('The default library could not be read')).toBeInTheDocument();
    expect(screen.queryByText('No default library is set.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear default' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(mock.refetch).toHaveBeenCalled();
  });

  it('AC-M365DOC-056 a revoked or missing Microsoft connection never changes the stored default', () => {
    mock.docs = docs({ defaultLibrary: library, connection: { connected: true, status: 'revoked' } });
    view();
    expect(screen.getByTestId('m365-default-library-current')).toHaveTextContent('Synthetic site / Synthetic library');
    expect(mock.setDefault).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-055 renders no identifiers: only the site and library labels', () => {
    mock.docs = docs({ defaultLibrary: library });
    const { container } = view();
    expect(container.textContent).not.toMatch(/\bs1\b|\bd1\b/);
  });
});
