// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppError } from '@/src/lib/appError';
import { axeViolations } from '@/src/components/__tests__/axe';
import { BahasaProvider } from '@/test/bahasa';

const listChildren = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/m365/graphClient', () => ({ listChildren: (...a: unknown[]) => listChildren(...a) }));

import { LinkedFolderFiles } from './LinkedFolderFiles';

const item = (id: string, name: string, kind: 'file' | 'folder', modified: string | null) => ({
  drive_id: 'drive-1', item_id: id, name, item_kind: kind, modified_at: modified,
  web_url: `https://contoso.sharepoint.com/sites/synthetic/Shared%20Documents/${encodeURIComponent(name)}`,
  parent_path: null, content_tag: null, sharepoint_ids: null,
});
const ref = { drive_id: 'drive-1', item_id: 'folder-1' };
const mount = () => render(<MemoryRouter><LinkedFolderFiles reference={ref} /></MemoryRouter>);

beforeEach(() => listChildren.mockReset());

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
    expect(within(rows[0]).getByText(/2026/)).toBeInTheDocument();
    const open = within(rows[0]).getByRole('link', { name: 'Open Plan.pdf' });
    expect(open).toHaveAttribute('href', expect.stringContaining('Plan.pdf'));
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect((await axeViolations(container)).blocking).toEqual([]);
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
    render(<BahasaProvider><MemoryRouter><LinkedFolderFiles reference={ref} /></MemoryRouter></BahasaProvider>);
    expect(await screen.findByText('Koneksi Microsoft 365 telah kedaluwarsa. Hubungkan ulang untuk melihat file folder ini.')).toBeInTheDocument();
  });

  it('AC-2: when Microsoft has more than one page, says the list is partial', async () => {
    listChildren.mockResolvedValue({ value: [item('a', 'Plan.pdf', 'file', null)], next: { path: '/x' } });
    mount();
    expect(await screen.findByText(/first files/i)).toBeInTheDocument();
  });
});
