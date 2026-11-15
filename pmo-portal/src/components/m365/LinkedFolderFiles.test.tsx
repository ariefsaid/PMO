// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppError } from '@/src/lib/appError';
import { axeViolations } from '@/src/components/__tests__/axe';
import { BahasaProvider } from '@/test/bahasa';

const listChildren = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/m365/graphClient', () => ({ listChildren: (...a: unknown[]) => listChildren(...a) }));
const previewMicrosoftDocument = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/m365/previewClient', () => ({ previewMicrosoftDocument: (...a: unknown[]) => previewMicrosoftDocument(...a) }));

import { LinkedFolderFiles } from './LinkedFolderFiles';
import { DocumentViewerContext, type DocumentViewerApi } from '@/src/components/documents/viewerContext';
import { MAX_NESTED_FOLDERS } from '../../../../supabase/functions/_shared/microsoftDocumentPreview';

const item = (id: string, name: string, kind: 'file' | 'folder', modified: string | null) => ({
  drive_id: 'drive-1', item_id: id, name, item_kind: kind, modified_at: modified,
  web_url: `https://contoso.sharepoint.com/sites/synthetic/Shared%20Documents/${encodeURIComponent(name)}`,
  parent_path: null, content_tag: null, sharepoint_ids: null,
});
const ref = { drive_id: 'drive-1', item_id: 'folder-1' };
let client: QueryClient;
const tree = () => <QueryClientProvider client={client}><MemoryRouter><LinkedFolderFiles reference={ref} /></MemoryRouter></QueryClientProvider>;
const mount = () => render(tree());

beforeEach(() => { listChildren.mockReset(); previewMicrosoftDocument.mockReset(); client = new QueryClient(); });

describe('#1320 AC-2 LinkedFolderFiles', () => {
  it('AC-2: reads the stored folder through the M365 connection and lists name, modified date and an open link per file', async () => {
    listChildren.mockResolvedValue({ value: [item('a', 'Plan.pdf', 'file', '2026-05-04T10:00:00Z'), item('b', 'Photos', 'folder', null)], next: null });
    const { container } = mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    const list = await screen.findByRole('list', { name: 'Files in this folder' });
    expect(listChildren).toHaveBeenCalledWith('drive-1', 'folder-1');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Plan.pdf')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/4 May/)).toBeInTheDocument();
    const open = within(rows[0]).getByRole('link', { name: 'Open Plan.pdf' });
    expect(open).toHaveAttribute('href', expect.stringContaining('Plan.pdf'));
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect((await axeViolations(container)).blocking).toEqual([]);
  });

  it('#2114 coming back to a folder shows the cached list at once and re-reads it, so a new file appears', async () => {
    listChildren.mockResolvedValueOnce({ value: [item('a', 'Plan.pdf', 'file', null)], next: null });
    const first = mount();
    expect(await screen.findByText('Plan.pdf')).toBeInTheDocument();
    first.unmount();
    listChildren.mockResolvedValueOnce({ value: [item('a', 'Plan.pdf', 'file', null), item('n', 'Added in Microsoft.pdf', 'file', null)], next: null });
    mount();
    expect(screen.getByText('Plan.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(await screen.findByText('Added in Microsoft.pdf')).toBeInTheDocument();
    expect(listChildren).toHaveBeenCalledTimes(2);
  });

  it('AC-2: an empty folder says so', async () => {
    listChildren.mockResolvedValue({ value: [], next: null });
    mount();
    expect(await screen.findByText('This folder is empty.')).toBeInTheDocument();
  });

  it('AC-2: a failed read shows reviewed copy (never the raw body) and Retry re-reads', async () => {
    listChildren.mockRejectedValueOnce(new AppError('RAW-UPSTREAM-BODY', 'GRAPH_ERROR'));
    listChildren.mockResolvedValueOnce({ value: [item('a', 'Plan.pdf', 'file', null)], next: null });
    mount();
    expect(await screen.findByText(/Microsoft could not load/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('RAW-UPSTREAM');
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Plan.pdf')).toBeInTheDocument();
  });

  it('AC-2: an expired connection explains that reconnecting restores this folder list', async () => {
    listChildren.mockRejectedValueOnce(Object.assign(new Error('expired'), { code: 'CONNECTION_STALE' }));
    mount();
    expect(await screen.findByText('The Microsoft 365 connection expired. Reconnect to see this folder’s files.')).toBeInTheDocument();
  });

  it('AC-2: the expired-folder reconnect message is localized in Bahasa', async () => {
    listChildren.mockRejectedValueOnce(Object.assign(new Error('expired'), { code: 'CONNECTION_STALE' }));
    render(<QueryClientProvider client={client}><BahasaProvider><MemoryRouter><LinkedFolderFiles reference={ref} /></MemoryRouter></BahasaProvider></QueryClientProvider>);
    expect(await screen.findByText('Koneksi Microsoft 365 telah kedaluwarsa. Hubungkan ulang untuk melihat file folder ini.')).toBeInTheDocument();
  });

  it('AC-2: when Microsoft has more than one page, says the list is partial', async () => {
    listChildren.mockResolvedValue({ value: [item('a', 'Plan.pdf', 'file', null)], next: { path: '/x' } });
    mount();
    expect(await screen.findByText(/first files/i)).toBeInTheDocument();
  });
});

describe('#1588 LinkedFolderFiles sub-folders', () => {
  const byFolder = (children: Record<string, ReturnType<typeof item>[]>) =>
    listChildren.mockImplementation((_drive: string, folderId: string) => Promise.resolve({ value: children[folderId] ?? [], next: null }));

  it('opening a sub-folder lists its files, and the folder path leads back to the linked folder', async () => {
    byFolder({ 'folder-1': [item('a', 'Plan.pdf', 'file', null), item('b', 'Photos', 'folder', null)], b: [item('c', 'Site.jpg', 'file', null)] });
    const { container } = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Open folder Photos' }));
    expect(await screen.findByText('Site.jpg')).toBeInTheDocument();
    expect(listChildren).toHaveBeenLastCalledWith('drive-1', 'b');
    expect(screen.queryByText('Plan.pdf')).not.toBeInTheDocument();
    const path = screen.getByRole('navigation', { name: 'Folder path' });
    expect(within(path).getByText('Photos')).toHaveAttribute('aria-current', 'location');
    expect((await axeViolations(container)).blocking).toEqual([]);
    await userEvent.click(within(path).getByRole('button', { name: 'Linked folder' }));
    expect(await screen.findByText('Plan.pdf')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Folder path' })).getByText('Linked folder')).toHaveAttribute('aria-current', 'location');
  });

  it('keyboard focus follows the move: opening a folder or a path step focuses the folder you are now in', async () => {
    byFolder({ 'folder-1': [item('b', 'Photos', 'folder', null)], b: [item('c', 'Site', 'folder', null)], c: [] });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Open folder Photos' }));
    expect(screen.getByText('Photos', { selector: '[aria-current]' })).toHaveFocus();
    await screen.findByRole('button', { name: 'Open folder Site' });
    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{Enter}'); // the focused folder row "Site"
    expect(await screen.findByText('Site', { selector: '[aria-current]' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Photos' }));
    expect(screen.getByText('Photos', { selector: '[aria-current]' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Linked folder' }));
    expect(screen.getByText('Linked folder', { selector: '[aria-current]' })).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('a file in a sub-folder previews as a child of the linked folder record, by its own Microsoft id', async () => {
    byFolder({ 'folder-1': [item('b', 'Photos', 'folder', null)], b: [item('nested-1', 'Site.jpg', 'file', null)] });
    const open = vi.fn<DocumentViewerApi['open']>();
    render(
      <QueryClientProvider client={client}><MemoryRouter>
        <DocumentViewerContext.Provider value={{ open, close: vi.fn() }}>
          <LinkedFolderFiles reference={ref} owner={{ kind: 'procurement', id: 'pd-1' }} />
        </DocumentViewerContext.Provider>
      </MemoryRouter></QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open folder Photos' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Preview Site.jpg' }));
    const target = open.mock.calls[0][0];
    expect(target.name).toBe('Site.jpg');
    previewMicrosoftDocument.mockResolvedValue({ mode: 'unsupported' });
    await target.load(new AbortController().signal);
    expect(previewMicrosoftDocument).toHaveBeenCalledWith({ kind: 'procurement_document', id: 'pd-1', child_item_id: 'nested-1' }, expect.anything());
  });

  it(`browsing stops ${MAX_NESTED_FOLDERS} sub-folders down, where preview stops`, async () => {
    const children: Record<string, ReturnType<typeof item>[]> = { 'folder-1': [item('s1', 'Level 1', 'folder', null)] };
    for (let n = 1; n <= MAX_NESTED_FOLDERS; n += 1) children[`s${n}`] = [item(`s${n + 1}`, `Level ${n + 1}`, 'folder', null)];
    byFolder(children);
    mount();
    for (let n = 1; n <= MAX_NESTED_FOLDERS; n += 1) {
      await userEvent.click(await screen.findByRole('button', { name: `Open folder Level ${n}` }));
    }
    expect(await screen.findByText(`Level ${MAX_NESTED_FOLDERS + 1}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Open folder Level ${MAX_NESTED_FOLDERS + 1}` })).not.toBeInTheDocument();
  });
});
