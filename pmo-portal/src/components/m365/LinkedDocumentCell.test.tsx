import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppError } from '@/src/lib/appError';
import { formatInstantDate } from '@/src/lib/format';
import { getItem, listVersions, type GraphItem } from '@/src/lib/m365/graphClient';
import type { MicrosoftReference, ReferenceOwner } from '@/src/lib/m365/reference';
import { LinkedDocumentCell } from './LinkedDocumentCell';

vi.mock('@/src/lib/m365/graphClient', () => ({ getItem: vi.fn(), listVersions: vi.fn() }));

const SP_URL = 'https://tenant.sharepoint.com/sites/synthetic/Shared%20Documents/Plan.docx';
const LIST_ID = '0f0f0f0f-1111-4222-8333-444455556666';
const ref = (over: Partial<MicrosoftReference> = {}): MicrosoftReference => ({
  drive_id: 'drive-1', item_id: 'item-1', web_url: SP_URL, name: 'Plan.docx', item_kind: 'file',
  linked_by: 'user-1', linked_at: '2026-10-01T09:00:00Z', last_verified_at: null, ...over,
});
const projectOwner = (over: Partial<Extract<ReferenceOwner, { kind: 'project' }>> = {}): ReferenceOwner => ({
  kind: 'project', id: 'doc-1', status: 'Approved', content_tag_at_issue: 'tag-1', version_id_at_issue: '2.0',
  drift_state: 'clean', last_verified_at: '2026-10-10T08:00:00Z', ...over,
});
const procurement: ReferenceOwner = { kind: 'procurement', id: 'pd-1' };
const budget: ReferenceOwner = { kind: 'budget', id: 'bl-1' };
const graphItem = (over: Partial<GraphItem> = {}): GraphItem => ({
  drive_id: 'drive-1', item_id: 'item-1', web_url: SP_URL, name: 'Plan.docx', item_kind: 'file', parent_path: null, content_tag: 'tag-1',
  sharepoint_ids: { site_url: 'https://tenant.sharepoint.com/sites/synthetic', list_id: LIST_ID, list_item_id: '12' }, ...over,
});
const versionsPage = (ids: string[], next: { path: string } | null = null) =>
  ({ value: ids.map((id, i) => ({ id, modified_at: `2026-09-0${(i % 9) + 1}T10:00:00Z` })), next, unsupported_count: 0 });

const open = vi.fn();
let windowOpen: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  windowOpen = vi.spyOn(window, 'open').mockImplementation(open);
  vi.mocked(getItem).mockResolvedValue(graphItem());
  vi.mocked(listVersions).mockResolvedValue(versionsPage(['3.0', '2.0', '1.0']));
});
afterEach(() => windowOpen.mockRestore());

const view = (reference: MicrosoftReference, owner: ReferenceOwner, title?: string) =>
  render(<MemoryRouter><LinkedDocumentCell reference={reference} owner={owner} title={title} /></MemoryRouter>);
const historyUrlOf = () => {
  const call = open.mock.calls.find(([url]) => String(url).includes('Versions.aspx'));
  return call ? String(call[0]) : null;
};

describe('LinkedDocumentCell direct open', () => {
  it('AC-M365DOC-058 a file opens the stored URL in a new tab with noopener/noreferrer and makes no Graph call, with no permission or connection context at all', async () => {
    view(ref(), projectOwner({ status: 'Draft', drift_state: null }), 'Plan');
    expect(screen.getByText('SharePoint file')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Open in SharePoint/ }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(SP_URL, '_blank', 'noopener,noreferrer');
    expect(getItem).not.toHaveBeenCalled();
    expect(listVersions).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-021 the access hint is present and the open action is not disabled', () => {
    view(ref(), procurement);
    expect(screen.getByText('Opens in Microsoft. Access depends on your Microsoft permissions on this file.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Open in SharePoint/ })).toBeEnabled();
  });

  it.each([
    ['https://tenant.sharepoint.com/sites/x/a.docx', 'SharePoint'],
    ['https://sharepoint.com/a.docx', 'SharePoint'],
    ['https://onedrive.live.com/redir?x=1', 'OneDrive'],
    ['https://1drv.ms/w/s!synthetic', 'OneDrive'],
    ['https://evilsharepoint.com/a.docx', 'Microsoft 365'],
    ['https://sharepoint.com.attacker.example/a.docx', 'Microsoft 365'],
    ['https://example.invalid/a.docx', 'Microsoft 365'],
  ])('AC-M365DOC-058 provenance for %s is %s (suffix match on a label boundary)', (url, expected) => {
    view(ref({ web_url: url }), budget);
    expect(screen.getByRole('button', { name: new RegExp(`^Open in ${expected}`) })).toBeInTheDocument();
  });

  it.each([
    ['project', projectOwner({ status: 'Draft', drift_state: null })],
    ['procurement', procurement],
    ['budget', budget],
  ] as const)('AC-M365DOC-058 a %s folder shows Folder, opens directly, and has no version, drift or approval controls', async (kind, owner) => {
    view(ref({ item_kind: 'folder', name: 'Project folder', web_url: 'https://tenant.sharepoint.com/sites/synthetic/Shared%20Documents/Project' }), owner);
    expect(screen.getByText('SharePoint folder')).toBeInTheDocument();
    expect(screen.getByText('Opens in Microsoft. Access depends on your Microsoft permissions on this folder.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Versions/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/approv|issued version|Not verified|Unchanged since|Changed since/i)).not.toBeInTheDocument();
    if (kind === 'project') expect(screen.getByText('Reference only')).toBeInTheDocument();
    else expect(screen.queryByText('Reference only')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Open folder in SharePoint/ }));
    expect(open).toHaveBeenCalledWith('https://tenant.sharepoint.com/sites/synthetic/Shared%20Documents/Project', '_blank', 'noopener,noreferrer');
    expect(getItem).not.toHaveBeenCalled();
    expect(listVersions).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-058 a project folder in any non-Draft state still shows no drift, verification or approval claim', () => {
    view(ref({ item_kind: 'folder' }), projectOwner({ status: 'Approved', drift_state: 'drifted' }));
    expect(screen.queryByText(/Changed since|Not verified|Unchanged since|approved version/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /history|Versions/i })).not.toBeInTheDocument();
  });

  it.each([
    'http://tenant.sharepoint.com/a.docx', 'javascript:alert(1)', 'https://user:pw@tenant.sharepoint.com/a.docx', '', 'not a url', 'https://tenant.sharepoint.com/a b',
  ])('AC-M365DOC-062 an invalid stored URL (%s) refuses navigation and says so', async (bad) => {
    view(ref({ web_url: bad }), procurement);
    await userEvent.click(screen.getByRole('button', { name: /^Open in / }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This Microsoft link cannot be opened.');
  });

  it('AC-M365DOC-058 a PMO title that differs from the Microsoft name shows the Microsoft name as secondary text; an equal name is not repeated', () => {
    const { unmount } = view(ref({ name: 'Plan-final.docx' }), budget, 'Site plan');
    expect(screen.getByText('Plan-final.docx')).toHaveClass('text-muted-foreground');
    unmount();
    view(ref({ name: 'Site plan' }), budget, 'Site plan');
    expect(screen.queryByText('Site plan')).not.toBeInTheDocument();
  });

  it('AC-M365DOC-058 long names wrap inside the cell instead of widening the table', () => {
    view(ref({ name: 'A-very-long-microsoft-file-name-without-any-spaces-that-would-otherwise-overflow.docx' }), budget, 'Other title');
    expect(screen.getByText(/A-very-long/).className).toMatch(/break-words|break-all/);
    expect(screen.getByText(/A-very-long/).closest('div')!.className).toMatch(/min-w-0/);
  });
});

describe('LinkedDocumentCell versions and approved history', () => {
  it('AC-M365DOC-065 every file target can list versions as metadata with explicit Load more, and nothing is opened or persisted', async () => {
    const user = userEvent.setup();
    vi.mocked(listVersions).mockResolvedValueOnce(versionsPage(['3.0', '2.0'], { path: '/versions-next' })).mockResolvedValueOnce(versionsPage(['1.0']));
    view(ref(), procurement, 'Quote');
    await user.click(screen.getByRole('button', { name: /^Versions/ }));
    const list = await screen.findByRole('list', { name: 'Versions' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(listVersions).toHaveBeenCalledTimes(1);
    expect(listVersions).toHaveBeenCalledWith({ drive_id: 'drive-1', item_id: 'item-1', web_url: SP_URL, name: 'Plan.docx', item_kind: 'file' });
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('listitem')).toHaveLength(3));
    expect(listVersions).toHaveBeenLastCalledWith(expect.objectContaining({ item_id: 'item-1' }), { path: '/versions-next' });
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Versions/ })).toHaveFocus();
  });

  it('AC-M365DOC-065 the version list marks the approved version and reports empty, loading and failure states', async () => {
    const user = userEvent.setup();
    view(ref(), projectOwner());
    await user.click(screen.getByRole('button', { name: /^Versions/ }));
    const items = within(await screen.findByRole('list', { name: 'Versions' })).getAllByRole('listitem');
    expect(items[1]).toHaveTextContent('Version 2.0');
    expect(items[1]).toHaveTextContent('Approved version');
    expect(items[0]).not.toHaveTextContent('Approved version');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    vi.mocked(listVersions).mockResolvedValueOnce(versionsPage([]));
    await user.click(screen.getByRole('button', { name: /^Versions/ }));
    expect(await screen.findByText('No versions listed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));

    vi.mocked(listVersions).mockRejectedValueOnce(new AppError('raw-synthetic-error', 'GRAPH_ERROR')).mockResolvedValueOnce(versionsPage(['9.0']));
    await user.click(screen.getByRole('button', { name: /^Versions/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft could not load this location');
    expect(document.body.textContent).not.toMatch(/raw-synthetic-error/);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Version 9.0')).toBeInTheDocument();
  });

  it('AC-M365DOC-065 a missing connection explains itself in the version list while Open latest keeps working', async () => {
    const user = userEvent.setup();
    vi.mocked(listVersions).mockRejectedValue(new AppError('x', 'NOT_CONNECTED'));
    view(ref(), budget);
    await user.click(screen.getByRole('button', { name: /^Versions/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connect Microsoft 365 first to browse documents.');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: /^Open in SharePoint/ }));
    expect(open).toHaveBeenCalledWith(SP_URL, '_blank', 'noopener,noreferrer');
  });

  it.each(['Approved', 'Closed', 'Superseded'])('AC-M365DOC-065 a %s controlled file shows the pinned label, opens the version-history page built from sharepointIds, and labels the direct link as latest', async (status) => {
    const user = userEvent.setup();
    view(ref(), projectOwner({ status }));
    expect(screen.getByText('Approved version 2.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Open latest in SharePoint/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^View approved version history/ }));
    await waitFor(() => expect(historyUrlOf()).not.toBeNull());
    const url = new URL(historyUrlOf()!);
    expect(url.origin + url.pathname).toBe('https://tenant.sharepoint.com/sites/synthetic/_layouts/15/Versions.aspx');
    expect(url.searchParams.get('list')).toBe(`{${LIST_ID}}`);
    expect(url.searchParams.get('ID')).toBe('12');
    expect(open).toHaveBeenCalledWith(String(open.mock.calls[0]![0]), '_blank', 'noopener,noreferrer');
    expect(open).not.toHaveBeenCalledWith(SP_URL, '_blank', 'noopener,noreferrer');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('AC-M365DOC-065 an Issued file is labelled "Issued version", makes no approval claim and offers no approved-history action', () => {
    view(ref(), projectOwner({ status: 'Issued' }));
    expect(screen.getByText('Issued version 2.0')).toBeInTheDocument();
    expect(screen.queryByText(/Approved version/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approved version history/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Open in SharePoint/ })).toBeInTheDocument();
  });

  it('AC-M365DOC-065 a Draft file has no pinned label and no history action but still lists versions', () => {
    view(ref(), projectOwner({ status: 'Draft', version_id_at_issue: null, drift_state: null, last_verified_at: null }));
    expect(screen.queryByText(/version 2\.0|Issued version|Approved version/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /history/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Versions/ })).toBeInTheDocument();
  });

  it('AC-M365DOC-065 sharepointIds missing: history is unavailable for that stated reason and the latest link is untouched', async () => {
    const user = userEvent.setup();
    vi.mocked(getItem).mockResolvedValue(graphItem({ sharepoint_ids: null }));
    view(ref(), projectOwner());
    await user.click(screen.getByRole('button', { name: /^View approved version history/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Version history unavailable: Microsoft did not provide SharePoint identifiers.');
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Open latest in SharePoint/ })).toBeEnabled();
  });

  it('AC-M365DOC-065 the pinned version is only called unavailable after every page was read; until then it is "not found in loaded history"', async () => {
    const user = userEvent.setup();
    vi.mocked(listVersions)
      .mockResolvedValueOnce(versionsPage(['5.0', '4.0'], { path: '/more' }))
      .mockResolvedValueOnce(versionsPage(['3.0', '1.0'], null));
    view(ref(), projectOwner());
    await user.click(screen.getByRole('button', { name: /^View approved version history/ }));
    expect(await screen.findByText('Approved version not found in loaded history.')).toBeInTheDocument();
    expect(screen.queryByText(/no longer lists it/)).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Load more history' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Approved version unavailable: Microsoft no longer lists it, so it may have been pruned. The latest version is still available.');
    expect(listVersions).toHaveBeenLastCalledWith(expect.anything(), { path: '/more' });
    expect(open).not.toHaveBeenCalled();
  });

  it('AC-M365DOC-065 the pinned version found on a later page opens the history page', async () => {
    const user = userEvent.setup();
    vi.mocked(listVersions)
      .mockResolvedValueOnce(versionsPage(['5.0'], { path: '/more' }))
      .mockResolvedValueOnce(versionsPage(['2.0'], null));
    view(ref(), projectOwner());
    await user.click(screen.getByRole('button', { name: /^View approved version history/ }));
    await user.click(await screen.findByRole('button', { name: 'Load more history' }));
    await waitFor(() => expect(historyUrlOf()).not.toBeNull());
  });

  it('AC-M365DOC-065 no listed versions at all reads as versioning unavailable, not as a pruned version', async () => {
    const user = userEvent.setup();
    vi.mocked(listVersions).mockResolvedValue(versionsPage([]));
    view(ref(), projectOwner());
    await user.click(screen.getByRole('button', { name: /^View approved version history/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Approved version unavailable: Microsoft lists no versions for this file (version history may be turned off). The latest version is still available.');
  });

  it('AC-M365DOC-065 no recorded pin is stated plainly and nothing is read', async () => {
    const user = userEvent.setup();
    view(ref(), projectOwner({ version_id_at_issue: null }));
    expect(screen.queryByText(/Approved version \d/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^View approved version history/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Approved version unavailable: no version was recorded when this file was issued.');
    expect(getItem).not.toHaveBeenCalled();
  });

  it.each([
    ['NOT_CONNECTED', 'Approved version history needs a Microsoft 365 connection.'],
    ['CONNECTION_STALE', 'Approved version history needs you to reconnect Microsoft 365.'],
    ['CONNECTION_REVOKED', 'Approved version history needs you to reconnect Microsoft 365.'],
    ['SCOPE_INSUFFICIENT', 'Approved version history needs additional Microsoft permissions.'],
    ['GRAPH_ERROR', 'Microsoft could not load version history. Retry, or open the latest version.'],
    ['external-unreachable', 'Microsoft could not load version history. Retry, or open the latest version.'],
  ])('AC-M365DOC-065 a %s read failure gives a reviewed reason, never a latest fallback or raw text', async (code, copy) => {
    const user = userEvent.setup();
    vi.mocked(getItem).mockRejectedValue(new AppError('raw-synthetic-error tenant', code));
    view(ref(), projectOwner());
    await user.click(screen.getByRole('button', { name: /^View approved version history/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy);
    expect(document.body.textContent).not.toMatch(/raw-synthetic-error/);
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Open latest in SharePoint/ })).toBeEnabled();
  });
});

describe('LinkedDocumentCell drift and verification state', () => {
  const verified = '2026-10-10T08:00:00Z';

  it('AC-M365DOC-064 drifted shows a warn pill "Changed since approval" with the last successful check time', () => {
    view(ref(), projectOwner({ drift_state: 'drifted', last_verified_at: verified }));
    expect(screen.getByText('Changed since approval')).toBeInTheDocument();
    expect(screen.getByText(`Checked ${formatInstantDate(verified)}`)).toBeInTheDocument();
    expect(screen.queryByText(/Unchanged/)).not.toBeInTheDocument();
  });

  it('AC-M365DOC-064 an Issued file that drifted says "Changed since issue", not approval', () => {
    view(ref(), projectOwner({ status: 'Issued', drift_state: 'drifted', last_verified_at: verified }));
    expect(screen.getByText('Changed since issue')).toBeInTheDocument();
    expect(screen.queryByText(/approval/)).not.toBeInTheDocument();
  });

  it('AC-M365DOC-064 clean is quiet text with its as-of time, not a pill', () => {
    view(ref(), projectOwner({ drift_state: 'clean', last_verified_at: verified }));
    const clean = screen.getByText(`Unchanged since approval. Verified ${formatInstantDate(verified)}.`);
    expect(clean).toHaveClass('text-muted-foreground');
    expect(screen.queryByText('Changed since approval')).not.toBeInTheDocument();
    expect(screen.queryByText('Not verified')).not.toBeInTheDocument();
  });

  it('AC-M365DOC-064 not_verified states why and since when, and never reads as clean', () => {
    view(ref(), projectOwner({ drift_state: 'not_verified', last_verified_at: verified }));
    expect(screen.getByText('Not verified')).toBeInTheDocument();
    expect(screen.getByText(`Not verified since ${formatInstantDate(verified)}. Microsoft could not be checked.`)).toBeInTheDocument();
    expect(screen.queryByText(/Unchanged/)).not.toBeInTheDocument();
  });

  it.each([
    ['never checked', null, null],
    ['not_verified with no successful check', 'not_verified', null],
  ] as const)('AC-M365DOC-064 %s is "Not verified" with no as-of time and no false all-clear', (_label, drift, at) => {
    view(ref(), projectOwner({ drift_state: drift, last_verified_at: at }));
    expect(screen.getByText('Not verified')).toBeInTheDocument();
    expect(screen.getByText(/Not verified yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Unchanged|Changed since/)).not.toBeInTheDocument();
  });

  it('AC-M365DOC-064 a clean state with no recorded successful check is not trusted as clean', () => {
    view(ref(), projectOwner({ drift_state: 'clean', last_verified_at: null }));
    expect(screen.queryByText(/Unchanged/)).not.toBeInTheDocument();
    expect(screen.getByText('Not verified')).toBeInTheDocument();
  });

  it('AC-M365DOC-064 Draft files and non-project references show no drift or verification badge', () => {
    const { unmount } = view(ref(), projectOwner({ status: 'Draft', drift_state: 'drifted', last_verified_at: verified }));
    expect(screen.queryByText(/Changed since|Not verified|Unchanged/)).not.toBeInTheDocument();
    unmount();
    view(ref({ last_verified_at: verified }), procurement);
    expect(screen.queryByText(/Changed since|Not verified|Unchanged/)).not.toBeInTheDocument();
  });
});
