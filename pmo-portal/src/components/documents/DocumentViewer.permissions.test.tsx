import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileCell } from '@/src/components/FileCell';
import { LinkedDocumentCell } from '@/src/components/m365/LinkedDocumentCell';
import type { MicrosoftReference } from '@/src/lib/m365/reference';
import { Harness } from './Harness';
import { renderViewer, target } from './testkit';

const MUTATIONS = /upload|replace|link|unlink|archive|remove|delete|approve|issue|status|edit|save/i;

describe('document-preview AC-011 read-only by construction', () => {
  it('the panel offers only Preview, Download, Open in source, Retry and Close: no mutation control, for any viewer', async () => {
    const t = target({ name: 'Plan.pdf', sourceLabel: 'SharePoint', download: vi.fn(), openInSource: { url: 'https://tenant.sharepoint.com/sites/x/Plan.pdf' }, result: { mode: 'image', url: 'https://signed.test/a.png' } });
    renderViewer(<Harness targets={[t]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.pdf' }));
    const panel = await screen.findByRole('dialog', { name: 'Plan.pdf' });
    const names = within(panel).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    expect(names).toEqual(expect.arrayContaining([expect.stringMatching(/Download/), expect.stringMatching(/Open in SharePoint/), expect.stringMatching(/Close/)]));
    for (const name of names) expect(name).not.toMatch(MUTATIONS);
    expect(within(panel).queryByRole('textbox')).toBeNull();
    expect(within(panel).queryByRole('combobox')).toBeNull();
  });

  it('a register file cell without write handlers offers no Upload or Replace, but still previews and downloads', () => {
    const onPreview = vi.fn();
    const onDownload = vi.fn();
    const { unmount } = render(<FileCell status="Draft" filePath="org/p/d/a.pdf" title="A" onPreview={onPreview} onDownload={onDownload} />);
    expect(screen.queryByRole('button', { name: /Replace|Upload/ })).toBeNull();
    unmount();
    render(<FileCell status="Approved" filePath="org/p/d/a.pdf" title="A" onPreview={onPreview} onDownload={onDownload} />);
    expect(screen.getByRole('button', { name: /Preview file for A/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Download file for A/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Replace|Upload/ })).toBeNull();
  });

  it('a linked-document cell previews for a reader and carries no link, unlink or status control', async () => {
    const ref: MicrosoftReference = { drive_id: 'd', item_id: 'i', web_url: 'https://tenant.sharepoint.com/sites/x/Plan.pdf', name: 'Plan.pdf', item_kind: 'file', linked_by: 'u', linked_at: '2026-10-01T00:00:00Z', last_verified_at: null };
    renderViewer(<LinkedDocumentCell reference={ref} owner={{ kind: 'budget', id: 'bl-1' }} />);
    expect(screen.getByRole('button', { name: /Preview Plan\.pdf/ })).toBeEnabled();
    for (const b of screen.getAllByRole('button')) expect(b.getAttribute('aria-label') ?? b.textContent ?? '').not.toMatch(/unlink|link from|approve|issue|archive|delete/i);
  });
});
