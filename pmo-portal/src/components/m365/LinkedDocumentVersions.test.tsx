/**
 * F1 (Director sitting 2026-11-13): the version list shows the version label MICROSOFT gives —
 * "Version 5.0" — never a number invented from the row's position. Numbering by index (index + 1)
 * read wrong in a real library: Microsoft lists newest first, so the newest file said "Version 1",
 * a number nobody sees in SharePoint. The opaque id is also no longer repeated beside the label
 * behind a reference disclosure: it was the same value printed twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { formatDay } from '@/src/lib/format';
import { listVersions } from '@/src/lib/m365/graphClient';
import type { MicrosoftReference } from '@/src/lib/m365/reference';
import { LinkedDocumentVersionsModal } from './LinkedDocumentVersions';

vi.mock('@/src/lib/m365/graphClient', () => ({ getItem: vi.fn(), listVersions: vi.fn() }));

const reference: MicrosoftReference = {
  drive_id: 'drive-1',
  item_id: 'item-1',
  web_url: 'https://tenant.sharepoint.com/sites/synthetic/Shared%20Documents/Plan.docx',
  name: 'Plan.docx',
  item_kind: 'file',
  linked_by: 'user-1',
  linked_at: '2026-10-01T09:00:00Z',
  last_verified_at: null,
};

/** SharePoint numbers document versions "5.0", "4.0" — the label a person reads in the library. */
const VERSIONS = [
  { id: '5.0', modified_at: '2026-09-02T10:00:00Z' },
  { id: '4.0', modified_at: '2026-09-01T10:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listVersions).mockResolvedValue({
    value: VERSIONS,
    next: null,
    unsupported_count: 0,
  } as never);
});

afterEach(() => cleanup());

describe('LinkedDocumentVersionsModal (F1 — the version label Microsoft gives)', () => {
  it('F1: a version with id 5.0 renders "Version 5.0" beside its date', async () => {
    render(<LinkedDocumentVersionsModal reference={reference} onClose={vi.fn()} />);

    const newest = await screen.findByText('Version 5.0');
    expect(newest.closest('li')).toHaveTextContent(formatDay('2026-09-02T10:00:00Z'));
    expect(screen.getByText('Version 4.0').closest('li')).toHaveTextContent(formatDay('2026-09-01T10:00:00Z'));
  });

  it('F1: the list never numbers versions by their position', async () => {
    render(<LinkedDocumentVersionsModal reference={reference} onClose={vi.fn()} />);

    await screen.findByText('Version 5.0');
    expect(screen.queryByText('Version 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Version 2')).not.toBeInTheDocument();
  });

  it('F1: the row does not print the same version value twice behind a reference disclosure', async () => {
    render(<LinkedDocumentVersionsModal reference={reference} onClose={vi.fn()} />);

    const row = (await screen.findByText('Version 5.0')).closest('li') as HTMLElement;
    expect(within(row).queryByTestId('record-reference')).toBeNull();
  });
});
