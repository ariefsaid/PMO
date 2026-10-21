import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axeViolations } from '@/src/components/__tests__/axe';
import { MicrosoftDocumentPicker } from './MicrosoftDocumentPicker';
import { browseOneDrive, listChildren, searchDrive } from '@/src/lib/m365/graphClient';

vi.mock('@/src/lib/m365/graphClient', () => ({
  listSites: vi.fn().mockResolvedValue({ value: [{ id: 'site-1', name: 'Synthetic site', web_url: 'https://example.invalid' }], next: null }),
  listDrives: vi.fn().mockResolvedValue({ value: [{ id: 'drive-1', name: 'Documents', web_url: 'https://example.invalid' }], next: null }),
  getPersonalDrive: vi.fn().mockResolvedValue({ id: 'drive-2', name: 'OneDrive', web_url: 'https://example.invalid' }),
  browseOneDrive: vi.fn().mockResolvedValue({ value: [], next: null }),
  listChildren: vi.fn().mockResolvedValue({ value: [
    { drive_id: 'drive-1', item_id: 'folder-1', web_url: 'https://example.invalid/folder', name: 'Folder', item_kind: 'folder', parent_path: null, content_tag: null, sharepoint_ids: null },
    { drive_id: 'drive-1', item_id: 'file-1', web_url: 'https://example.invalid/file', name: 'Report.pdf', item_kind: 'file', parent_path: null, content_tag: null, sharepoint_ids: null },
  ], next: null }),
  searchDrive: vi.fn().mockResolvedValue({ value: [], next: null }),
}));
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({ useMicrosoftDocuments: () => ({ connection: { status: 'active', connected: true }, defaultLibrary: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/lib/m365/folderSuggestions', () => ({ suggestFolders: vi.fn().mockResolvedValue([]) }));

describe('MicrosoftDocumentPicker', () => {
  it('AC-M365DOC-054 chooser exposes SharePoint and OneDrive; file and folder require explicit selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MicrosoftDocumentPicker open context={{ kind: 'project', code: null }} onClose={vi.fn()} onSelect={onSelect} />);
    await user.click(await screen.findByRole('button', { name: 'SharePoint sites' }));
    await user.click(await screen.findByRole('button', { name: 'Synthetic site' }));
    await user.click(await screen.findByRole('button', { name: 'Documents' }));
    expect(await screen.findByRole('button', { name: 'Select folder Folder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select file Report.pdf' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select folder Folder' }));
    await user.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ item_id: 'folder-1', item_kind: 'folder' }));
  });

  it('AC-M365DOC-067 loads pages only on request and appends deduplicated items', async () => {
    const user = userEvent.setup();
    const first = Array.from({ length: 100 }, (_, i) => ({ drive_id: 'drive-1', item_id: `item-${i}`, web_url: `https://example.invalid/${i}`, name: `File ${i}`, item_kind: 'file' as const, parent_path: null, content_tag: null, sharepoint_ids: null }));
    vi.mocked(listChildren).mockResolvedValueOnce({ value: first, next: { path: '/next' }, unsupported_count: 2 });
    vi.mocked(browseOneDrive).mockResolvedValueOnce({ value: [first[99]!, { ...first[0]!, item_id: 'item-100', name: 'File 100' }], next: null });
    render(<MicrosoftDocumentPicker open context={{ kind: 'budget' }} onClose={vi.fn()} onSelect={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'SharePoint sites' }));
    await user.click(await screen.findByRole('button', { name: 'Synthetic site' }));
    await user.click(await screen.findByRole('button', { name: 'Documents' }));
    expect(document.querySelector('[role="list"][class*="max-h-72"]')!.querySelectorAll('[role="listitem"]')).toHaveLength(100);
    expect(screen.getByText('Some items cannot be selected.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(document.querySelector('[role="list"][class*="max-h-72"]')!.querySelectorAll('[role="listitem"]')).toHaveLength(101);
    expect(browseOneDrive).toHaveBeenCalledWith({ path: '/next' });
  });

  it('AC-M365DOC-067 debounces location search for 300ms and shows loading immediately', async () => {
    render(<MicrosoftDocumentPicker open context={{ kind: 'budget' }} onClose={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'SharePoint sites' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Synthetic site' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Documents' }));
    vi.useFakeTimers();
    try {
      const input = screen.getByRole('textbox', { name: 'Search this location' });
      fireEvent.change(input, { target: { value: 'report' } });
      expect(screen.getByRole('status')).toHaveTextContent('Loading');
      await act(async () => { await vi.advanceTimersByTimeAsync(299); });
      expect(searchDrive).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(searchDrive).toHaveBeenCalledWith('drive-1', 'report');
    } finally { vi.useRealTimers(); }
  });

  it('AC-M365DOC-067 picker modal passes axe with keyboard-operable navigation controls', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<MicrosoftDocumentPicker open context={{ kind: 'budget' }} onClose={onClose} onSelect={vi.fn()} />);
    expect((await axeViolations(container)).blocking).toEqual([]);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps a selected file and displays a persistent safe error when linking fails', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn().mockRejectedValue(new Error('synthetic-item-id raw-synthetic-error'));
    render(<MicrosoftDocumentPicker open context={{ kind: 'project', code: null }} onClose={vi.fn()} onSelect={onSelect} />);
    await user.click(await screen.findByRole('button', { name: 'SharePoint sites' }));
    await user.click(await screen.findByRole('button', { name: 'Synthetic site' }));
    await user.click(await screen.findByRole('button', { name: 'Documents' }));
    await user.click(await screen.findByRole('button', { name: 'Select file Report.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not link this Microsoft item.');
    expect(screen.getByText('Selected file: Report.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/raw-synthetic-error|synthetic-item-id/)).not.toBeInTheDocument();
  });
});
