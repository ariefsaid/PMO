import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axeViolations } from '@/src/components/__tests__/axe';
import { MicrosoftDocumentPicker } from './MicrosoftDocumentPicker';

vi.mock('@/src/lib/m365/graphClient', () => ({
  listSites: vi.fn().mockResolvedValue({ value: [{ id: 'site-1', name: 'Synthetic site', web_url: 'https://example.invalid' }], next: null }),
  listDrives: vi.fn().mockResolvedValue({ value: [{ id: 'drive-1', name: 'Documents', web_url: 'https://example.invalid' }], next: null }),
  getPersonalDrive: vi.fn().mockResolvedValue({ id: 'drive-2', name: 'OneDrive', web_url: 'https://example.invalid' }),
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
