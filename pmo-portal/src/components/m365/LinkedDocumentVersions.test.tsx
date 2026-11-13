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

/** Microsoft Graph version ids are opaque strings (graphClient.ts `GraphVersion.id`), never numbers. */
const GRAPH_VERSION_IDS = ['3058fe1c-4c2a-4a4f-9f3b-6b9d1a2c8e11', 'a71e0b52-8e0f-4a1d-a0d3-2b6b7c9f4d21'];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listVersions).mockResolvedValue({
    value: [
      { id: GRAPH_VERSION_IDS[0], modified_at: '2026-09-02T10:00:00Z' },
      { id: GRAPH_VERSION_IDS[1], modified_at: '2026-09-01T10:00:00Z' },
    ],
    next: null,
    unsupported_count: 0,
  } as never);
});

afterEach(() => cleanup());

describe('LinkedDocumentVersionsModal (plain-words C20-3d)', () => {
  it('C20-3d: numbers versions by their order and keeps each date, never printing the opaque version id as the label', async () => {
    render(<LinkedDocumentVersionsModal reference={reference} onClose={vi.fn()} />);

    const first = await screen.findByText('Version 1');
    expect(first.closest('li')).toHaveTextContent(formatDay('2026-09-02T10:00:00Z'));
    expect(screen.getByText('Version 2').closest('li')).toHaveTextContent(formatDay('2026-09-01T10:00:00Z'));

    // The opaque id is reference material, not the version's name: each row keeps it behind the
    // same closed Reference disclosure the other C20 surfaces use (ruling 3b/3c/3d).
    for (const [rowText, id] of [['Version 1', GRAPH_VERSION_IDS[0]], ['Version 2', GRAPH_VERSION_IDS[1]]] as const) {
      const row = screen.getByText(rowText).closest('li') as HTMLElement;
      const disclosure = within(row).getByTestId('record-reference') as HTMLDetailsElement;
      expect(disclosure.tagName).toBe('DETAILS');
      expect(disclosure.open).toBe(false);
      expect(disclosure).toHaveTextContent(id);
      expect(row).not.toHaveTextContent(new RegExp(`^Version ${id}`));
    }
    expect(screen.queryByText(/Version 3058fe1c/)).not.toBeInTheDocument();
  });
});
