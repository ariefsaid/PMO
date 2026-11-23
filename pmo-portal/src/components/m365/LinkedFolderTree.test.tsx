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

import { LinkedFolderTree, formatFileSize } from './LinkedFolderTree';

const item = (id: string, name: string, kind: 'file' | 'folder', extra: { modified?: string; size?: number } = {}) => ({
  drive_id: 'drive-1', item_id: id, name, item_kind: kind, modified_at: extra.modified ?? null, size: extra.size ?? null,
  web_url: `https://contoso.sharepoint.com/sites/synthetic/Shared%20Documents/${encodeURIComponent(name)}`,
  parent_path: null, content_tag: null, sharepoint_ids: null,
});
const roots = [{ key: 'doc-1', title: 'Project folder', drive_id: 'drive-1', item_id: 'root-1', web_url: 'https://contoso.sharepoint.com/sites/synthetic/Shared%20Documents/Project' }];
let client: QueryClient;
const mount = (wrap = (node: React.ReactNode) => node) => render(
  <QueryClientProvider client={client}><MemoryRouter>{wrap(<LinkedFolderTree roots={roots} />)}</MemoryRouter></QueryClientProvider>,
);
const rowOf = (name: string | RegExp) => screen.getByText(name).closest('li') as HTMLElement;

beforeEach(() => { listChildren.mockReset(); client = new QueryClient(); });

describe('#2806 AC-DOCTREE-001 the linked folder as a tree', () => {
  it('opens the linked folder at once and lists its folders, then files, with modified date and size', async () => {
    listChildren.mockResolvedValue({ next: null, value: [
      item('f2', 'Site photos.jpg', 'file', { modified: '2026-05-04T10:00:00Z', size: 8_734_112 }),
      item('d1', 'Drawings', 'folder', { size: 412_000_000 }),
    ] });
    const { container } = mount();
    expect(screen.getByRole('button', { name: 'Project folder' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByText('Drawings')).toBeInTheDocument();
    expect(listChildren).toHaveBeenCalledWith('drive-1', 'root-1', undefined);
    const names = within(screen.getByRole('list', { name: 'Project folder' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(names.findIndex((t) => t?.startsWith('Drawings'))).toBeLessThan(names.findIndex((t) => t?.startsWith('Site photos.jpg')));
    const file = within(rowOf('Site photos.jpg'));
    expect(file.getAllByText(/4 May/).length).toBeGreaterThan(0);
    expect(file.getAllByText(/8[.,]73 MB/).length).toBeGreaterThan(0);
    expect((await axeViolations(container)).blocking).toEqual([]);
  });

  it('reads a subfolder only when it is opened, and closing it hides its contents', async () => {
    listChildren.mockImplementation(async (_drive: string, folder: string) => (
      folder === 'root-1'
        ? { next: null, value: [item('d1', 'Drawings', 'folder')] }
        : { next: null, value: [item('f9', 'GA-001.pdf', 'file')] }
    ));
    mount();
    const drawings = await screen.findByRole('button', { name: /^Drawings/ });
    expect(drawings).toHaveAttribute('aria-expanded', 'false');
    expect(listChildren).toHaveBeenCalledTimes(1);
    await userEvent.click(drawings);
    expect(await screen.findByText('GA-001.pdf')).toBeInTheDocument();
    expect(listChildren).toHaveBeenLastCalledWith('drive-1', 'd1', undefined);
    await userEvent.click(drawings);
    expect(screen.queryByText('GA-001.pdf')).not.toBeInTheDocument();
  });

  it('a file opens in SharePoint in a new tab', async () => {
    listChildren.mockResolvedValue({ next: null, value: [item('f1', 'Plan.pdf', 'file')] });
    mount();
    const open = await screen.findByRole('link', { name: 'Open Plan.pdf in SharePoint' });
    expect(open).toHaveAttribute('href', expect.stringContaining('Plan.pdf'));
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('an empty folder says so in place', async () => {
    listChildren.mockResolvedValue({ next: null, value: [] });
    mount();
    expect(await screen.findByText('Empty folder')).toBeInTheDocument();
  });

  it('without a Microsoft connection it says so and links to My integrations', async () => {
    listChildren.mockRejectedValue(new AppError('x', 'NOT_CONNECTED'));
    mount();
    expect(await screen.findByText('Connect Microsoft 365 first to browse documents.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open My integrations' })).toHaveAttribute('href', '/integrations');
  });

  it('a folder this person may not open in Microsoft is refused with the access reason, not a retry loop', async () => {
    listChildren.mockRejectedValue(new AppError('x', 'FORBIDDEN'));
    mount();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a failed read can be retried and then lists the folder', async () => {
    listChildren.mockRejectedValueOnce(new AppError('x', 'GRAPH_ERROR')).mockResolvedValue({ next: null, value: [item('f1', 'Plan.pdf', 'file')] });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Plan.pdf')).toBeInTheDocument();
  });

  it('a folder of more than one page offers the next page', async () => {
    const next = { path: '/drives/drive-1/items/root-1/children', query: { $skiptoken: 'p2', $top: '100' } };
    listChildren
      .mockResolvedValueOnce({ next, value: [item('f1', 'First.pdf', 'file')] })
      .mockResolvedValueOnce({ next: null, value: [item('f2', 'Second.pdf', 'file')] });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Second.pdf')).toBeInTheDocument();
    expect(screen.getByText('First.pdf')).toBeInTheDocument();
    expect(listChildren).toHaveBeenLastCalledWith('drive-1', 'root-1', next);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('reads in Bahasa Indonesia', async () => {
    listChildren.mockResolvedValue({ next: null, value: [item('f1', 'Rencana.pdf', 'file')] });
    mount((node) => <BahasaProvider>{node}</BahasaProvider>);
    expect(await screen.findByRole('link', { name: 'Buka Rencana.pdf di SharePoint' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Folder proyek' })).toBeInTheDocument();
  });
});

describe('formatFileSize', () => {
  it('bytes under a kilobyte stay bytes; larger sizes keep three significant digits', () => {
    expect(formatFileSize(0, 'en-US')).toBe('0 B');
    expect(formatFileSize(812, 'en-US')).toBe('812 B');
    expect(formatFileSize(284_330, 'en-US')).toBe('284 kB');
    expect(formatFileSize(8_734_112, 'en-US')).toBe('8.73 MB');
    expect(formatFileSize(null, 'en-US')).toBe('');
  });
});
