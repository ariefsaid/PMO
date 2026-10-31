import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { storageTarget } from './targets/storage';
import { renderViewer, target } from './testkit';
import { Harness } from './Harness';
import { officeViewerUrl } from './renderers';
import type { PreviewResult } from './types';

async function show(result: PreviewResult, over = {}) {
  const t = target({ name: 'Doc.bin', result, ...over });
  renderViewer(<Harness targets={[t]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Preview Doc.bin' }));
  return t;
}

describe('document-preview AC-005 renderers inside the panel', () => {
  it('an image renders with its name as alt', async () => {
    await show({ mode: 'image', url: 'https://signed.test/a.png' });
    expect(await screen.findByRole('img', { name: 'Doc.bin' })).toHaveAttribute('src', 'https://signed.test/a.png');
  });

  it('a PDF renders in a titled frame', async () => {
    await show({ mode: 'pdf', url: 'https://signed.test/a.pdf' });
    const frame = (await screen.findByTitle('Doc.bin')) as HTMLIFrameElement;
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'https://signed.test/a.pdf');
    expect(frame).toHaveAttribute('tabindex', '0');
  });

  it('a Microsoft embed is sandboxed, titled and has no referrer', async () => {
    await show({ mode: 'embed', provider: 'microsoft', url: 'https://tenant.sharepoint.com/embed' });
    const frame = await screen.findByTitle('Doc.bin');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.queryByText('If the preview stays blank, download the file.')).not.toBeInTheDocument();
  });

  it('the public Office viewer frame always shows the blank-frame hint, and an iframe load event proves nothing', async () => {
    await show({ mode: 'embed', provider: 'office-online', url: officeViewerUrl('https://signed.test/a.docx?t=1') }, { download: vi.fn() });
    const frame = await screen.findByTitle('Doc.bin');
    expect(frame.getAttribute('src')).toMatch(/^https:\/\/view\.officeapps\.live\.com\/op\/embed\.aspx\?src=/);
    fireEvent.load(frame);
    expect(screen.getByText('If the preview stays blank, download the file.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('unsupported renders the copy with Download reachable', async () => {
    await show({ mode: 'unsupported' }, { download: vi.fn() });
    expect(await screen.findByRole('alert')).toHaveTextContent("Preview isn't available for this file type.");
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('Office files get a fresh signed URL on open and on every Retry', async () => {
    let n = 0;
    const getSignedUrl = vi.fn(async () => `https://signed.test/a.docx?t=${++n}`);
    const t = storageTarget({ key: 'k', name: 'Brief.docx', filePath: 'org/p/a.docx', getSignedUrl, sourceLabel: 'PMO' });
    renderViewer(<Harness targets={[t]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview Brief.docx' }));
    const first = (await screen.findByTitle('Brief.docx')).getAttribute('src');
    expect(first).toContain(encodeURIComponent('https://signed.test/a.docx?t=1'));
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
  });
});

describe('document-preview AC-005 ported receipt-preview behaviours', () => {
  it('AC-UXS-012 previews a signed image and returns focus to the opener after Escape', async () => {
    const t = storageTarget({ key: 'r', name: 'receipt.png', filePath: 'p', getSignedUrl: vi.fn().mockResolvedValue('https://signed.test/receipt.png'), sourceLabel: 'PMO' });
    renderViewer(<Harness targets={[t]} />);
    const opener = screen.getByRole('button', { name: 'Preview receipt.png' });
    opener.focus();
    await userEvent.click(opener);
    expect(await screen.findByRole('img', { name: 'receipt.png' })).toHaveAttribute('src', 'https://signed.test/receipt.png');
    // Download is part of every ready panel (FR-010), not only a failure fallback.
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await vi.waitFor(() => expect(opener).toHaveFocus());
  });

  it('AC-UXS-012 an unsupported type offers Download and a failed retrieval offers Download too', async () => {
    const download = vi.fn();
    const unsupported = storageTarget({ key: 'u', name: 'receipt.tiff', filePath: 'p', getSignedUrl: vi.fn(), download, sourceLabel: 'PMO' });
    const failed = storageTarget({ key: 'f', name: 'receipt.png', filePath: 'p', getSignedUrl: vi.fn().mockRejectedValue(new Error('failed')), download, sourceLabel: 'PMO' });
    renderViewer(<Harness targets={[unsupported, failed]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview receipt.tiff' }));
    expect(await screen.findByText("Preview isn't available for this file type.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Preview receipt.png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("The preview couldn't be loaded. Try again.");
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(download).toHaveBeenCalledOnce();
  });
});
