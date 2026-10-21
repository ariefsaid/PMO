import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import i18n from 'i18next';
import idCatalogue from '../../../public/locales/id/common.json';
import { MemoryRouter } from 'react-router';
import { axeViolations } from '@/src/components/__tests__/axe';
import { AppError } from '@/src/lib/appError';
import { MicrosoftDocumentPicker, type PickerContext } from './MicrosoftDocumentPicker';
import { browseOneDrive, getPersonalDrive, listChildren, listDrives, listSites, searchDrive, type GraphItem } from '@/src/lib/m365/graphClient';

const h = vi.hoisted(() => ({
  hook: {
    connection: { status: 'active', connected: true } as { status: string | null; connected: boolean } | undefined,
    defaultLibrary: null as null | { site_id: string; site_name: string; drive_id: string; drive_name: string },
    isPending: false,
    isError: false,
    connectionError: null as unknown,
    defaultError: null as unknown,
    refetch: vi.fn(),
  },
  setDefaultLibrary: vi.fn(),
}));

vi.mock('@/src/lib/m365/graphClient', () => ({
  listSites: vi.fn(),
  listDrives: vi.fn(),
  getPersonalDrive: vi.fn(),
  browseOneDrive: vi.fn(),
  listChildren: vi.fn(),
  searchDrive: vi.fn(),
}));
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({ useMicrosoftDocuments: () => h.hook }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { m365DocumentSettings: { setDefaultLibrary: h.setDefaultLibrary } } }));

const mk = (id: string, kind: 'file' | 'folder', name: string, extra: Partial<GraphItem> = {}): GraphItem => ({
  drive_id: 'drive-1', item_id: id, web_url: `https://example.invalid/${id}`, name, item_kind: kind,
  parent_path: null, content_tag: null, sharepoint_ids: null, ...extra,
});
const ROOT = [mk('folder-1', 'folder', 'Folder'), mk('file-1', 'file', 'Report.pdf')];
const page = <T,>(value: T[], next: { path: string } | null = null, unsupported_count = 0) => ({ value, next, unsupported_count });
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const LIBRARY = { site_id: 'site-1', site_name: 'Synthetic site', drive_id: 'drive-d', drive_name: 'Project library' };
const PROJECT: PickerContext = { kind: 'project', code: 'P-100' };

const spy = {
  open: vi.fn(), close: vi.fn(), select: vi.fn(),
};
function renderPicker(context: PickerContext = { kind: 'budget' }, props: { onSelect?: (r: never) => Promise<void> } = {}) {
  const onSelect = (props.onSelect ?? spy.select) as never;
  return render(<MemoryRouter><MicrosoftDocumentPicker open context={context} onClose={spy.close} onSelect={onSelect} /></MemoryRouter>);
}
async function openLibrary(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'SharePoint sites' }));
  await user.click(await screen.findByRole('button', { name: 'Synthetic site' }));
  await user.click(await screen.findByRole('button', { name: 'Documents' }));
  await screen.findByRole('navigation', { name: 'Microsoft location' });
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
}
const itemList = () => screen.getByRole('list', { name: 'Items in this location' });
const rendered = () => within(itemList()).queryAllByRole('listitem');

beforeEach(() => {
  vi.clearAllMocks();
  h.hook.connection = { status: 'active', connected: true };
  h.hook.defaultLibrary = null; h.hook.isPending = false; h.hook.isError = false;
  h.hook.connectionError = null; h.hook.defaultError = null;
  vi.mocked(listSites).mockResolvedValue(page([{ id: 'site-1', name: 'Synthetic site', web_url: 'https://example.invalid/site' }]));
  vi.mocked(listDrives).mockResolvedValue(page([{ id: 'drive-1', name: 'Documents', web_url: 'https://example.invalid/drive' }]));
  vi.mocked(getPersonalDrive).mockResolvedValue({ id: 'drive-2', name: 'OneDrive', web_url: 'https://example.invalid/me' });
  vi.mocked(listChildren).mockResolvedValue(page(ROOT));
  vi.mocked(browseOneDrive).mockResolvedValue(page([]));
  vi.mocked(searchDrive).mockResolvedValue(page([]));
});
afterEach(() => { vi.useRealTimers(); document.documentElement.classList.remove('dark'); });

describe('MicrosoftDocumentPicker selection and commit', () => {
  it('AC-M365DOC-054 select: choosing a file writes nothing until the explicit Link; onSelect receives only the five reference fields', async () => {
    const user = userEvent.setup();
    renderPicker({ kind: 'project', code: null });
    await openLibrary(user);
    const link = screen.getByRole('button', { name: 'Link from Microsoft 365' });
    expect(link).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Select file Report.pdf' }));
    expect(spy.select).not.toHaveBeenCalled();
    expect(link).toBeEnabled();
    await user.click(link);
    await waitFor(() => expect(spy.select).toHaveBeenCalledTimes(1));
    expect(spy.select).toHaveBeenCalledWith({ drive_id: 'drive-1', item_id: 'file-1', web_url: 'https://example.invalid/file-1', name: 'Report.pdf', item_kind: 'file' });
    expect(spy.close).toHaveBeenCalled();
  });

  it('AC-M365DOC-054 commit: a folder is linked as itself only through its own Select and the final Link', async () => {
    const user = userEvent.setup();
    renderPicker();
    await openLibrary(user);
    await user.click(screen.getByRole('button', { name: 'Select folder Folder' }));
    expect(spy.select).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await waitFor(() => expect(spy.select).toHaveBeenCalledWith({ drive_id: 'drive-1', item_id: 'folder-1', web_url: 'https://example.invalid/folder-1', name: 'Folder', item_kind: 'folder' }));
  });

  it('AC-M365DOC-054 commit: a failed link keeps the selection, shows a persistent safe alert and can be retried', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn().mockRejectedValueOnce(new Error('synthetic-item-id raw-synthetic-error')).mockResolvedValueOnce(undefined);
    renderPicker({ kind: 'project', code: null }, { onSelect });
    await openLibrary(user);
    await user.click(screen.getByRole('button', { name: 'Select file Report.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    const alert = await screen.findByTestId('entity-modal-save-error');
    expect(alert).toHaveTextContent('Could not link this Microsoft item.');
    expect(screen.getByText('Selected file: Report.pdf')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/raw-synthetic-error|synthetic-item-id/);
    expect(spy.close).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(2));
    expect(spy.close).toHaveBeenCalled();
  });

  it('AC-M365DOC-054 commit: a source-collision refusal shows the reviewed collision copy, never the database text', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn().mockRejectedValue(new AppError('violates check constraint "synthetic_raw"', '23514', 'm365-source-collision'));
    renderPicker({ kind: 'project', code: null }, { onSelect });
    await openLibrary(user);
    await user.click(screen.getByRole('button', { name: 'Select file Report.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    const alert = await screen.findByTestId('entity-modal-save-error');
    expect(alert).toHaveTextContent('This entry already has a file or link; refresh and clear it before relinking.');
    expect(document.body.textContent).not.toMatch(/synthetic_raw|violates/);
  });

  it('AC-M365DOC-054 focus: closing the picker returns focus to the control that opened it', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <MemoryRouter><button onClick={() => setOpen(true)}>Open picker</button>
        <MicrosoftDocumentPicker open={open} context={{ kind: 'budget' }} onClose={() => setOpen(false)} onSelect={spy.select as never} /></MemoryRouter>;
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open picker' });
    await user.click(opener);
    expect(await screen.findByRole('dialog', { name: 'Choose a Microsoft document' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});

describe('MicrosoftDocumentPicker locations', () => {
  it('AC-M365DOC-054 chooser: SharePoint sites then a library, with libraries as locations not linkable items', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByRole('button', { name: 'SharePoint sites' }));
    await user.click(await screen.findByRole('button', { name: 'Synthetic site' }));
    expect(listDrives).toHaveBeenCalledWith('site-1');
    expect(screen.queryByRole('button', { name: /^Select / })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link from Microsoft 365' })).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: 'Documents' }));
    expect(await screen.findByRole('button', { name: 'Select folder Folder' })).toBeInTheDocument();
    expect(listChildren).toHaveBeenCalledWith('drive-1', undefined);
  });

  it('AC-M365DOC-054 chooser: My OneDrive reads the personal drive root and Change location returns to the chooser keeping a selection', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockResolvedValue(page([mk('f9', 'file', 'Mine.docx', { drive_id: 'drive-2' })]));
    renderPicker();
    await user.click(await screen.findByRole('button', { name: 'My OneDrive' }));
    expect(getPersonalDrive).toHaveBeenCalledTimes(1);
    await user.click(await screen.findByRole('button', { name: 'Select file Mine.docx' }));
    expect(listChildren).toHaveBeenCalledWith('drive-2', undefined);
    await user.click(screen.getByRole('button', { name: 'Change location' }));
    expect(screen.getByRole('button', { name: 'SharePoint sites' })).toBeInTheDocument();
    expect(screen.getByText('Selected file: Mine.docx')).toBeInTheDocument();
    expect(spy.select).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-054 chooser: nothing is browsable without an active connection and no Graph call is made', async () => {
    h.hook.connection = { status: 'stale', connected: true };
    renderPicker();
    expect(await screen.findByRole('alert')).toHaveTextContent('The Microsoft 365 connection expired. Reconnect to link more documents.');
    expect(screen.getByRole('button', { name: 'SharePoint sites' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'My OneDrive' })).toBeDisabled();
    expect(listSites).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-054 chooser: an absent connection links to setup, and a failed connection-status read is not shown as "not connected"', async () => {
    h.hook.connection = { status: null, connected: false };
    const { unmount } = renderPicker();
    expect(await screen.findByRole('link', { name: 'Open My integrations' })).toHaveAttribute('href', '/integrations');
    unmount();
    h.hook.connection = undefined; h.hook.isError = true;
    h.hook.connectionError = new AppError('raw-synthetic-error', 'INTERNAL_ERROR');
    renderPicker();
    expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft could not load this location');
    expect(screen.queryByRole('link', { name: 'Open My integrations' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.hook.refetch).toHaveBeenCalled();
  });

  it('AC-M365DOC-054 folder: selecting a folder does not read its children; Browse reads them but never links', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockImplementation(async (_d, folderId) => page(folderId === 'folder-1' ? [mk('inner', 'file', 'Inner.docx')] : ROOT));
    renderPicker();
    await openLibrary(user);
    expect(listChildren).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Select folder Folder' }));
    expect(listChildren).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Select folder Folder' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Selected folder: Folder')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Browse Folder' }));
    expect(listChildren).toHaveBeenLastCalledWith('drive-1', 'folder-1');
    expect(await screen.findByRole('button', { name: 'Select file Inner.docx' })).toBeInTheDocument();
    expect(spy.select).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-054 breadcrumb: shows human names (never ids), and going back reloads the parent while the selection survives', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockImplementation(async (_d, folderId) => page(folderId === 'folder-1' ? [mk('inner', 'file', 'Inner.docx')] : ROOT));
    renderPicker();
    await openLibrary(user);
    await user.click(screen.getByRole('button', { name: 'Select file Report.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Browse Folder' }));
    const nav = await screen.findByRole('navigation', { name: 'Microsoft location' });
    expect(within(nav).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Documents', 'Folder']);
    expect(nav.textContent).not.toMatch(/folder-1|drive-1/);
    await user.click(within(nav).getByRole('button', { name: 'Documents' }));
    expect(await screen.findByRole('button', { name: 'Select file Report.pdf' })).toHaveAttribute('aria-pressed', 'true');
    expect(listChildren).toHaveBeenLastCalledWith('drive-1', undefined);
    expect(screen.getByText('Selected file: Report.pdf')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Microsoft location' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('AC-M365DOC-054 folder: the selected row is marked by a visible label and aria-pressed, not by colour alone', async () => {
    const user = userEvent.setup();
    renderPicker();
    await openLibrary(user);
    const row = screen.getByRole('button', { name: 'Select file Report.pdf' }).closest('li')!;
    expect(within(row).queryByText('Selected')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select file Report.pdf' }));
    expect(within(row).getByText('Selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select file Report.pdf' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Select folder Folder' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('MicrosoftDocumentPicker default library', () => {
  it('AC-M365DOC-056 an accessible default opens at its root, shows where it is, and never writes the setting', async () => {
    h.hook.defaultLibrary = LIBRARY;
    renderPicker({ kind: 'budget' });
    expect(await screen.findByRole('button', { name: 'Select folder Folder' })).toBeInTheDocument();
    expect(listChildren).toHaveBeenCalledWith('drive-d', undefined);
    expect(screen.getByText('Default library: Synthetic site / Project library')).toBeInTheDocument();
    expect(listSites).not.toHaveBeenCalled();
    expect(h.setDefaultLibrary).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-056 with no default the chooser opens and nothing is read', async () => {
    renderPicker({ kind: 'budget' });
    expect(await screen.findByRole('button', { name: 'SharePoint sites' })).toBeEnabled();
    expect(screen.queryByText(/Default library/)).not.toBeInTheDocument();
    expect(listChildren).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Browse default library' })).not.toBeInTheDocument();
  });

  it('AC-M365DOC-056 an unreadable default shows the reviewed unavailable copy and the manual chooser, leaving the setting alone', async () => {
    h.hook.defaultLibrary = LIBRARY;
    vi.mocked(listChildren).mockRejectedValue(new AppError('raw-synthetic-error drive-d', 'GRAPH_ERROR'));
    renderPicker({ kind: 'budget' });
    expect(await screen.findByText('Default library is unavailable; choose another accessible location. An Admin can change the default.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SharePoint sites' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'My OneDrive' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Browse default library' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/raw-synthetic-error|drive-d\b/);
    expect(h.setDefaultLibrary).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-056 an expired connection on the default shows the reconnect notice, not "default unavailable"', async () => {
    h.hook.defaultLibrary = LIBRARY;
    vi.mocked(listChildren).mockRejectedValue(new AppError('x', 'CONNECTION_STALE'));
    renderPicker({ kind: 'budget' });
    expect(await screen.findByRole('button', { name: 'Reconnect Microsoft 365' })).toBeInTheDocument();
    expect(screen.queryByText(/Default library is unavailable/)).not.toBeInTheDocument();
  });

  it('AC-M365DOC-056 a settings-read failure is reported separately from "no default", with Retry and a manual chooser', async () => {
    h.hook.defaultError = new Error('settings unavailable'); h.hook.isError = true;
    renderPicker({ kind: 'budget' });
    expect(await screen.findByText('Default library settings could not be read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SharePoint sites' })).toBeEnabled();
    expect(listChildren).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.hook.refetch).toHaveBeenCalled();
    expect(h.setDefaultLibrary).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-056 there is no remembered location: a second open starts from the default again', async () => {
    h.hook.defaultLibrary = LIBRARY;
    const user = userEvent.setup();
    vi.mocked(listChildren).mockImplementation(async (d) => page(d === 'drive-d' ? ROOT : [mk('x', 'file', 'Other.pdf')]));
    const first = renderPicker({ kind: 'budget' });
    await screen.findByRole('button', { name: 'Select folder Folder' });
    await user.click(screen.getByRole('button', { name: 'Change location' }));
    await user.click(screen.getByRole('button', { name: 'My OneDrive' }));
    await screen.findByRole('button', { name: 'Select file Other.pdf' });
    first.unmount();
    vi.mocked(listChildren).mockClear();
    renderPicker({ kind: 'budget' });
    await screen.findByRole('button', { name: 'Select folder Folder' });
    expect(listChildren).toHaveBeenCalledWith('drive-d', undefined);
  });
});

describe('MicrosoftDocumentPicker contextual suggestions', () => {
  const projectMatch = (name: string, parent = '/drive/root:/Projects') => mk(`m-${name}`, 'folder', name, { drive_id: 'drive-d', parent_path: parent });

  it('AC-M365DOC-057 lists convention-matching folders with their path; Browse opens that location without linking; Link this folder is the explicit final choice', async () => {
    h.hook.defaultLibrary = LIBRARY;
    const user = userEvent.setup();
    vi.mocked(searchDrive).mockResolvedValue(page([
      projectMatch('P-100 Alpha'), projectMatch('P-100 Beta'),
      projectMatch('P-100 Elsewhere', '/drive/root:/Archive'), mk('f1', 'file', 'P-100 notes.docx', { drive_id: 'drive-d', parent_path: '/drive/root:/Projects' }),
    ]));
    vi.mocked(listChildren).mockResolvedValue(page([mk('inner', 'file', 'Plan.docx', { drive_id: 'drive-d' })]));
    renderPicker(PROJECT);
    expect(await screen.findByRole('button', { name: 'Browse P-100 Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse P-100 Beta' })).toBeInTheDocument();
    expect(screen.queryByText(/Elsewhere/)).not.toBeInTheDocument();
    expect(screen.queryByText(/notes\.docx/)).not.toBeInTheDocument();
    expect(searchDrive).toHaveBeenCalledWith('drive-d', 'P-100');
    expect(screen.getAllByText('Projects').length).toBeGreaterThan(0);
    expect(listChildren).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Browse P-100 Alpha' }));
    expect(listChildren).toHaveBeenCalledWith('drive-d', 'm-P-100 Alpha');
    expect(await screen.findByRole('button', { name: 'Select file Plan.docx' })).toBeInTheDocument();
    expect(spy.select).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-057 Link this folder selects the suggested folder but persists nothing until the final Link', async () => {
    h.hook.defaultLibrary = LIBRARY;
    const user = userEvent.setup();
    vi.mocked(searchDrive).mockResolvedValue(page([projectMatch('P-100 Alpha')]));
    renderPicker(PROJECT);
    await user.click(await screen.findByRole('button', { name: 'Link this folder P-100 Alpha' }));
    expect(spy.select).not.toHaveBeenCalled();
    expect(screen.getByText('Selected folder: P-100 Alpha')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await waitFor(() => expect(spy.select).toHaveBeenCalledWith(expect.objectContaining({ item_id: 'm-P-100 Alpha', item_kind: 'folder', drive_id: 'drive-d' })));
  });

  it('AC-M365DOC-057 the suggestion year is the UTC year of the request, not the local calendar year', async () => {
    h.hook.defaultLibrary = LIBRARY;
    vi.mocked(searchDrive).mockResolvedValue(page([
      mk('p27', 'folder', 'PR-77 Quote', { drive_id: 'drive-d', parent_path: '/drive/root:/Procurement/2027' }),
      mk('p26', 'folder', 'PR-77 Old', { drive_id: 'drive-d', parent_path: '/drive/root:/Procurement/2026' }),
    ]));
    renderPicker({ kind: 'procurement', request_number: 'PR-77', created_at: '2026-12-31T23:30:00-05:00' });
    expect(await screen.findByRole('button', { name: 'Browse PR-77 Quote' })).toBeInTheDocument();
    expect(screen.queryByText(/PR-77 Old/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Procurement / 2027').length).toBeGreaterThan(0);
  });

  it('AC-M365DOC-057 no match opens the default root with a subdued manual-browse hint and no folder is created', async () => {
    h.hook.defaultLibrary = LIBRARY;
    vi.mocked(searchDrive).mockResolvedValue(page([projectMatch('Q-200 Unrelated')]));
    renderPicker(PROJECT);
    expect(await screen.findByRole('button', { name: 'Select folder Folder' })).toBeInTheDocument();
    expect(listChildren).toHaveBeenCalledWith('drive-d', undefined);
    expect(screen.getByText('No folder suggestion for P-100. Browse this library or choose another location.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Create|New) /i })).not.toBeInTheDocument();
  });

  it('AC-M365DOC-057 a failed search or a three-page cap falls back to the default root and never claims absence', async () => {
    h.hook.defaultLibrary = LIBRARY;
    vi.mocked(searchDrive).mockRejectedValue(new AppError('raw-synthetic-error', 'GRAPH_ERROR'));
    const { unmount } = renderPicker(PROJECT);
    expect(await screen.findByRole('button', { name: 'Select folder Folder' })).toBeInTheDocument();
    expect(screen.queryByText(/raw-synthetic-error/)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not exist|no such folder/i)).not.toBeInTheDocument();
    unmount();

    vi.mocked(searchDrive).mockResolvedValue(page([], { path: '/more' }));
    vi.mocked(browseOneDrive).mockResolvedValue(page([], { path: '/more' }));
    vi.mocked(listChildren).mockClear(); vi.mocked(searchDrive).mockClear();
    renderPicker(PROJECT);
    expect(await screen.findByRole('button', { name: 'Select folder Folder' })).toBeInTheDocument();
    expect(searchDrive).toHaveBeenCalledTimes(1);
    expect(browseOneDrive).toHaveBeenCalledTimes(2);
  });

  it('AC-M365DOC-057 a project without a code skips the search and opens the default root', async () => {
    h.hook.defaultLibrary = LIBRARY;
    renderPicker({ kind: 'project', code: null });
    expect(await screen.findByRole('button', { name: 'Select folder Folder' })).toBeInTheDocument();
    expect(searchDrive).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-057 a budget context bypasses suggestions entirely: no search and no hint', async () => {
    h.hook.defaultLibrary = LIBRARY;
    renderPicker({ kind: 'budget' });
    expect(await screen.findByRole('button', { name: 'Select folder Folder' })).toBeInTheDocument();
    expect(searchDrive).not.toHaveBeenCalled();
    expect(screen.queryByText(/No folder suggestion/)).not.toBeInTheDocument();
    expect(spy.select).not.toHaveBeenCalled();
  });
});

describe('MicrosoftDocumentPicker paging and search', () => {
  const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => mk(`item-${from + i}`, 'file', `File ${from + i}`));

  it('AC-M365DOC-067 paging: loads one page, Load more appends the next page only on request, with no duplicates', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockResolvedValueOnce(page(many(0, 100), { path: '/next' }, 2));
    vi.mocked(browseOneDrive).mockResolvedValueOnce(page([...many(99, 1), ...many(100, 100)], null));
    renderPicker();
    await openLibrary(user);
    expect(rendered()).toHaveLength(100);
    expect(screen.getByText("2 items can't be linked (not a file or folder).")).toBeInTheDocument();
    expect(browseOneDrive).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rendered()).toHaveLength(200));
    expect(browseOneDrive).toHaveBeenCalledWith({ path: '/next' });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('AC-M365DOC-067 paging: Load more is disabled while a page is in flight and announces loading politely', async () => {
    const user = userEvent.setup();
    const d = deferred<ReturnType<typeof page<GraphItem>>>();
    vi.mocked(listChildren).mockResolvedValueOnce(page(many(0, 3), { path: '/next' }));
    vi.mocked(browseOneDrive).mockReturnValueOnce(d.promise as never);
    renderPicker();
    await openLibrary(user);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(screen.getByRole('button', { name: 'Load more' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(browseOneDrive).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(page(many(3, 2))); });
    await waitFor(() => expect(rendered()).toHaveLength(5));
  });

  it('AC-M365DOC-067 paging: a failed page keeps the selection, the breadcrumb and a retryable cursor', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockResolvedValueOnce(page([...ROOT, ...many(0, 3)], { path: '/next' }));
    vi.mocked(browseOneDrive).mockRejectedValueOnce(new AppError('raw-synthetic-error', 'GRAPH_ERROR')).mockResolvedValueOnce(page(many(3, 2)));
    renderPicker();
    await openLibrary(user);
    await user.click(screen.getByRole('button', { name: 'Select file Report.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft could not load this location');
    expect(document.body.textContent).not.toMatch(/raw-synthetic-error/);
    expect(screen.getByText('Selected file: Report.pdf')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Microsoft location' })).toBeInTheDocument();
    expect(rendered()).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rendered()).toHaveLength(7));
    expect(browseOneDrive).toHaveBeenCalledTimes(2);
    expect(browseOneDrive).toHaveBeenLastCalledWith({ path: '/next' });
    expect(listChildren).toHaveBeenCalledTimes(1);
  });

  it('AC-M365DOC-067 paging: keyboard focus moves to the first newly loaded row when Load more completes', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockResolvedValueOnce(page(many(0, 2), { path: '/next' }));
    vi.mocked(browseOneDrive).mockResolvedValueOnce(page(many(2, 2)));
    renderPicker();
    await openLibrary(user);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select file File 2' })).toHaveFocus());
  });

  it('AC-M365DOC-067 debounce: loading shows immediately, no request at 299ms, exactly one at 300ms', async () => {
    const user = userEvent.setup();
    renderPicker();
    await openLibrary(user);
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search this location' }), { target: { value: 'report' } });
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(searchDrive).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(searchDrive).toHaveBeenCalledTimes(1);
    expect(searchDrive).toHaveBeenCalledWith('drive-1', 'report');
  });

  it('AC-M365DOC-067 debounce: a one-character term does not search and clearing the term restores the location listing', async () => {
    const user = userEvent.setup();
    renderPicker();
    await openLibrary(user);
    const input = screen.getByRole('textbox', { name: 'Search this location' });
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: 'a' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(searchDrive).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'ab' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(searchDrive).toHaveBeenCalledTimes(1);
    vi.mocked(listChildren).mockClear();
    fireEvent.change(input, { target: { value: '' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(listChildren).toHaveBeenCalledWith('drive-1', undefined);
    expect(screen.getByRole('button', { name: 'Select file Report.pdf' })).toBeInTheDocument();
  });

  it('AC-M365DOC-067 stale: an older search response that arrives after a newer one is ignored', async () => {
    const user = userEvent.setup();
    const first = deferred<ReturnType<typeof page<GraphItem>>>();
    const second = deferred<ReturnType<typeof page<GraphItem>>>();
    vi.mocked(searchDrive).mockReturnValueOnce(first.promise as never).mockReturnValueOnce(second.promise as never);
    renderPicker();
    await openLibrary(user);
    const input = screen.getByRole('textbox', { name: 'Search this location' });
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: 'ab' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    fireEvent.change(input, { target: { value: 'abc' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(searchDrive).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(page([mk('new', 'file', 'Newer result')])); });
    await act(async () => { first.resolve(page([mk('old', 'file', 'Older result')])); });
    expect(screen.getByRole('button', { name: 'Select file Newer result' })).toBeInTheDocument();
    expect(screen.queryByText('Older result')).not.toBeInTheDocument();
  });

  it('AC-M365DOC-067 stale: a late listing for a folder the user already left cannot replace the current location', async () => {
    const user = userEvent.setup();
    const late = deferred<ReturnType<typeof page<GraphItem>>>();
    vi.mocked(listChildren).mockImplementation((_d, folderId) => (folderId === 'folder-1' ? late.promise : Promise.resolve(page(ROOT))) as never);
    renderPicker();
    await openLibrary(user);
    await user.click(screen.getByRole('button', { name: 'Browse Folder' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Microsoft location' })).getByRole('button', { name: 'Documents' }));
    await screen.findByRole('button', { name: 'Select file Report.pdf' });
    await act(async () => { late.resolve(page([mk('inner', 'file', 'Inner.docx')])); });
    expect(screen.queryByText('Inner.docx')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select file Report.pdf' })).toBeInTheDocument();
  });

  it('AC-M365DOC-067 stale: a late response after the picker closes changes nothing and raises no error', async () => {
    const user = userEvent.setup();
    const late = deferred<ReturnType<typeof page<GraphItem>>>();
    vi.mocked(listChildren).mockReturnValue(late.promise as never);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = renderPicker();
    await user.click(await screen.findByRole('button', { name: 'SharePoint sites' }));
    await user.click(await screen.findByRole('button', { name: 'Synthetic site' }));
    await user.click(await screen.findByRole('button', { name: 'Documents' }));
    view.rerender(<MemoryRouter><MicrosoftDocumentPicker open={false} context={{ kind: 'budget' }} onClose={spy.close} onSelect={spy.select as never} /></MemoryRouter>);
    await act(async () => { late.resolve(page(ROOT)); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('MicrosoftDocumentPicker keyboard, states and accessibility', () => {
  async function tabTo(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
    const target = await screen.findByRole('button', { name });
    for (let i = 0; i < 60; i += 1) {
      if (document.activeElement === target) return target;
      await user.tab();
    }
    throw new Error(`Could not reach "${String(name)}" by keyboard`);
  }

  it('AC-M365DOC-067 keyboard: a keyboard-only user opens the picker, walks site to library to folder, selects a file, links, and focus returns to the opener', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockImplementation(async (_d, folderId) => page(folderId === 'folder-1' ? [mk('inner', 'file', 'Inner.docx')] : ROOT));
    const onSelect = vi.fn().mockResolvedValue(undefined);
    function Harness() {
      const [open, setOpen] = useState(false);
      return <MemoryRouter><button onClick={() => setOpen(true)}>Open picker</button>
        <MicrosoftDocumentPicker open={open} context={{ kind: 'budget' }} onClose={() => setOpen(false)} onSelect={onSelect} /></MemoryRouter>;
    }
    render(<Harness />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Open picker' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await tabTo(user, 'SharePoint sites'); await user.keyboard('{Enter}');
    await tabTo(user, 'Synthetic site'); await user.keyboard('{Enter}');
    await tabTo(user, 'Documents'); await user.keyboard('{Enter}');
    await tabTo(user, 'Browse Folder'); await user.keyboard('{Enter}');
    await tabTo(user, 'Select file Inner.docx'); await user.keyboard('{Enter}');
    expect(screen.getByText('Selected file: Inner.docx')).toBeInTheDocument();
    await tabTo(user, 'Link from Microsoft 365'); await user.keyboard('{Enter}');
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ item_id: 'inner', item_kind: 'file' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open picker' })).toHaveFocus();
  });

  it('AC-M365DOC-067 keyboard: focus moves to the new location heading after navigation so Tab never lands behind the dialog', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByRole('button', { name: 'SharePoint sites' }));
    const heading = await screen.findByRole('heading', { name: 'SharePoint sites' });
    expect(heading).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('AC-M365DOC-067 keyboard: Tab leaves the search field without moving focus back or showing an error on blur', async () => {
    const user = userEvent.setup();
    renderPicker();
    await openLibrary(user);
    const input = screen.getByRole('textbox', { name: 'Search this location' });
    await user.click(input);
    await user.tab();
    expect(input).not.toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('AC-M365DOC-067 empty: an empty location says so, keeps Change location and the search reachable, and Escape still closes', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockResolvedValue(page([]));
    renderPicker();
    await openLibrary(user);
    expect(await screen.findByText('No items found')).toBeInTheDocument();
    expect(screen.getByText('Choose another location or search.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change location' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Search this location' })).toBeEnabled();
    await user.keyboard('{Escape}');
    expect(spy.close).toHaveBeenCalled();
  });

  it('AC-M365DOC-067 error: a failed listing shows a retryable alert, keeps the search reachable, and Escape closes during the error', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockRejectedValueOnce(new AppError('x', 'GRAPH_ERROR')).mockResolvedValueOnce(page(ROOT));
    renderPicker();
    await user.click(await screen.findByRole('button', { name: 'SharePoint sites' }));
    await user.click(await screen.findByRole('button', { name: 'Synthetic site' }));
    await user.click(await screen.findByRole('button', { name: 'Documents' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft could not load this location');
    expect(screen.getByRole('textbox', { name: 'Search this location' })).toBeEnabled();
    expect(screen.queryByText('No items found')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Select file Report.pdf' })).toBeInTheDocument();
    expect(listChildren).toHaveBeenCalledTimes(2);
  });

  it('AC-M365DOC-067 keyboard: Escape closes while a listing is still loading', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockReturnValue(new Promise(() => undefined) as never);
    renderPicker();
    await user.click(await screen.findByRole('button', { name: 'SharePoint sites' }));
    await user.click(await screen.findByRole('button', { name: 'Synthetic site' }));
    await user.click(await screen.findByRole('button', { name: 'Documents' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await user.keyboard('{Escape}');
    expect(spy.close).toHaveBeenCalled();
  });

  it.each([['light', false], ['dark', true]])('AC-M365DOC-067 axe: chooser, library list, item list, empty and error states have no blocking violations (%s theme)', async (_name, dark) => {
    document.documentElement.classList.toggle('dark', dark);
    const user = userEvent.setup();
    const view = renderPicker();
    expect((await axeViolations(document.body)).blocking).toEqual([]);
    await user.click(await screen.findByRole('button', { name: 'SharePoint sites' }));
    await screen.findByRole('button', { name: 'Synthetic site' });
    expect((await axeViolations(document.body)).blocking).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Synthetic site' }));
    await user.click(await screen.findByRole('button', { name: 'Documents' }));
    await screen.findByRole('button', { name: 'Select file Report.pdf' });
    await user.click(screen.getByRole('button', { name: 'Select file Report.pdf' }));
    expect((await axeViolations(document.body)).blocking).toEqual([]);
    view.unmount();

    vi.mocked(listChildren).mockResolvedValueOnce(page([]));
    renderPicker();
    await user.click(await screen.findByRole('button', { name: 'My OneDrive' }));
    await screen.findByText('No items found');
    expect((await axeViolations(document.body)).blocking).toEqual([]);
  });

  it('AC-M365DOC-067 axe: the degraded states (error notice, unavailable default, expired connection) have no blocking violations', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockRejectedValue(new AppError('x', 'GRAPH_ERROR'));
    const view = renderPicker();
    await user.click(await screen.findByRole('button', { name: 'My OneDrive' }));
    await screen.findByRole('alert');
    expect((await axeViolations(document.body)).blocking).toEqual([]);
    view.unmount();
    h.hook.defaultLibrary = LIBRARY;
    const second = renderPicker();
    await screen.findByText(/Default library is unavailable/);
    expect((await axeViolations(document.body)).blocking).toEqual([]);
    second.unmount();
    h.hook.defaultLibrary = null; h.hook.connection = { status: 'revoked', connected: true };
    renderPicker();
    await screen.findByRole('alert');
    expect((await axeViolations(document.body)).blocking).toEqual([]);
  });
});

describe('#1020 Discover fixes', () => {
  afterEach(async () => { await i18n.changeLanguage('en'); });
  const LONG = `Extraordinarily_long_name_${'x'.repeat(80)}.pdf`;

  it('F3: in Indonesian the whole picker (title, chooser, sites, list, select, load more) is translated', async () => {
    i18n.addResourceBundle('id', 'common', idCatalogue, true, true);
    await i18n.changeLanguage('id');
    const user = userEvent.setup();
    vi.mocked(listChildren).mockResolvedValue(page(ROOT, { path: '/next' }, 1));
    renderPicker();
    expect(await screen.findByRole('dialog', { name: 'Pilih dokumen Microsoft' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pilih lokasi' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Situs SharePoint' }));
    await user.click(await screen.findByRole('button', { name: 'Synthetic site' }));
    await user.click(await screen.findByRole('button', { name: 'Documents' }));
    expect(await screen.findByLabelText('Cari di lokasi ini')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Pilih berkas Report.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Muat lebih banyak' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tautkan dari Microsoft 365' })).toBeInTheDocument();
    expect(screen.queryByText('Load more')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose a file or folder')).not.toBeInTheDocument();
  });

  it('F3: the not-connected gate and the connection-loading line are translated too', async () => {
    i18n.addResourceBundle('id', 'common', idCatalogue, true, true);
    await i18n.changeLanguage('id');
    h.hook.connection = { status: null, connected: false };
    renderPicker();
    expect(await screen.findByRole('link', { name: 'Buka Integrasi saya' })).toHaveAttribute('href', '/integrations');
  });

  it('F10: a long unbroken name wraps inside its row, carries a title, and the Selected badge sits in the name block', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockResolvedValue(page([mk('long', 'file', LONG), ...ROOT]));
    renderPicker();
    await openLibrary(user);
    await user.click(screen.getByRole('button', { name: `Select file ${LONG}` }));
    const row = rendered()[0];
    const nameEl = row.querySelector(`[title="${LONG}"]`) as HTMLElement;
    expect(nameEl).not.toBeNull();
    expect(nameEl.className).toContain('[overflow-wrap:anywhere]');
    const badge = within(row).getByText('Selected');
    expect(badge.parentElement).toBe(nameEl.parentElement);
    expect(row.querySelector('button[aria-pressed]')?.className).toContain('shrink-0');
  });

  it('F10: breadcrumb entries for a long folder name wrap (title + anywhere-wrap) instead of running past the dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockResolvedValue(page([mk('lf', 'folder', LONG)]));
    renderPicker();
    await openLibrary(user);
    await user.click(screen.getByRole('button', { name: `Browse ${LONG}` }));
    const crumb = await within(screen.getByRole('navigation', { name: 'Microsoft location' })).findByRole('button', { name: LONG });
    expect(crumb).toHaveAttribute('title', LONG);
    expect(crumb.className).toContain('[overflow-wrap:anywhere]');
  });

  it('F11: suggested folders stack Browse / Link under the name on narrow widths', async () => {
    h.hook.defaultLibrary = LIBRARY;
    vi.mocked(searchDrive).mockResolvedValue(page([mk('m1', 'folder', 'P-100 Alpha', { drive_id: 'drive-d', parent_path: '/drive/root:/Projects' })]));
    renderPicker(PROJECT);
    const row = (await screen.findByRole('button', { name: 'Link this folder P-100 Alpha' })).closest('li') as HTMLElement;
    expect(row.className).toContain('flex-col');
    const actions = screen.getByRole('button', { name: 'Browse P-100 Alpha' }).parentElement as HTMLElement;
    expect(actions).toBe(screen.getByRole('button', { name: 'Link this folder P-100 Alpha' }).parentElement);
    expect(actions.className).toContain('flex-wrap');
  });

  it('F17: the "Default library" line shows only at the default location, not after the user changes location', async () => {
    h.hook.defaultLibrary = LIBRARY;
    const user = userEvent.setup();
    renderPicker({ kind: 'budget' });
    expect(await screen.findByText('Default library: Synthetic site / Project library')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change location' }));
    expect(screen.queryByText(/Default library:/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'My OneDrive' }));
    await screen.findByRole('button', { name: 'Select file Report.pdf' });
    expect(screen.queryByText(/Default library:/)).not.toBeInTheDocument();
  });

  it('F17: says how many items cannot be linked and why (singular and plural)', async () => {
    const user = userEvent.setup();
    vi.mocked(listChildren).mockResolvedValueOnce(page(ROOT, null, 1));
    const { unmount } = renderPicker();
    await openLibrary(user);
    expect(screen.getByText("1 item can't be linked (not a file or folder).")).toBeInTheDocument();
    unmount();
    vi.mocked(listChildren).mockResolvedValueOnce(page(ROOT, null, 4));
    renderPicker();
    await openLibrary(user);
    expect(screen.getByText("4 items can't be linked (not a file or folder).")).toBeInTheDocument();
  });

  it('F20: under StrictMode with an already-cached default library (project context, async suggestions) the picker leaves "Loading…" and lists the suggestions', async () => {
    h.hook.defaultLibrary = LIBRARY;
    vi.mocked(searchDrive).mockResolvedValue(page([mk('m1', 'folder', 'P-100 Alpha', { drive_id: 'drive-d', parent_path: '/drive/root:/Projects' })]));
    render(<StrictMode><MemoryRouter><MicrosoftDocumentPicker open context={PROJECT} onClose={spy.close} onSelect={spy.select as never} /></MemoryRouter></StrictMode>);
    expect(await screen.findByRole('button', { name: 'Browse P-100 Alpha' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });
});
