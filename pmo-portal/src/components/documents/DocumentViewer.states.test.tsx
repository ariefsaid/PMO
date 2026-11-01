import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/src/lib/appError';
import { PreviewFailure, type PreviewFailureKind } from './types';
import { renderViewer, target } from './testkit';
import { Harness } from './Harness';

afterEach(() => vi.useRealTimers());

const failing = (kind: PreviewFailureKind, retryAfter?: number, over = {}) =>
  target({ sourceLabel: 'SharePoint', openInSource: { url: 'https://tenant.sharepoint.com/sites/x/a.docx' }, download: vi.fn(), load: async () => { throw new PreviewFailure(kind, retryAfter); }, ...over });

async function open(t = failing('access_denied')) {
  renderViewer(<Harness targets={[t]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
  return t;
}

describe('document-preview AC-004 recovery states', () => {
  it('access denied: plain account explanation, Open in SharePoint, no Reconnect', async () => {
    await open();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Your Microsoft account can't open this file. Ask the owner for access, or open it in SharePoint.");
    expect(screen.getByRole('button', { name: 'Open in SharePoint' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /integrations/i })).not.toBeInTheDocument();
  });

  it.each(['not_connected', 'connection_stale'] as const)('%s: connect copy, the integrations entry, Open in source', async (kind) => {
    await open(failing(kind));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connect your Microsoft account to preview this file.');
    expect(screen.getByRole('link', { name: 'Open My integrations' })).toHaveAttribute('href', '/integrations');
    expect(screen.getByRole('button', { name: 'Open in SharePoint' })).toBeInTheDocument();
  });

  it('consent_needed: reconnect copy with the integrations entry', async () => {
    await open(failing('consent_needed'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect your Microsoft account to preview this file.');
    expect(screen.getByRole('link', { name: 'Open My integrations' })).toBeInTheDocument();
  });

  it('unsupported: copy and Download, no Retry', async () => {
    await open(failing('unsupported'));
    expect(await screen.findByRole('alert')).toHaveTextContent("Preview isn't available for this file type.");
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it.each(['expired', 'unavailable'] as const)('%s: Retry, Download and Open in source', async (kind) => {
    await open(failing(kind));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in SharePoint' })).toBeInTheDocument();
  });

  it('not_found: its own copy, no Retry loop', async () => {
    await open(failing('not_found'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not available. It may have been moved or deleted.');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('no_file: "No file is attached." with no Download and no preview', async () => {
    await open(failing('no_file', undefined, { openInSource: undefined }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No file is attached.');
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Plan.png')).not.toBeInTheDocument();
  });

  it('rate_limited: Retry is disabled until the retry-after has elapsed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); // only the countdown is faked
    await open(failing('rate_limited', 3));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Retry in 3s' })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('every state keeps a named dialog with a Close action', async () => {
    await open(failing('access_denied'));
    const dialog = await screen.findByRole('dialog', { name: 'Plan.png' });
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled();
  });
});

describe('document-preview AC-005 Download is independent of the preview (FR-010)', () => {
  it('a download denial states the reason and does not imply a fallback grants access', async () => {
    const download = vi.fn().mockRejectedValue(new AppError('You do not have access to download this file.', 'FORBIDDEN'));
    await open(failing('unavailable', undefined, { download }));
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }));
    expect(download).toHaveBeenCalledOnce();
    expect(await screen.findByText('You do not have access to download this file.')).toBeInTheDocument();
  });

  it('an unclassified download failure shows the generic line, never the raw error', async () => {
    const download = vi.fn().mockRejectedValue(new Error('secret internal detail'));
    await open(failing('unavailable', undefined, { download }));
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }));
    expect(await screen.findByText('The file could not be downloaded.')).toBeInTheDocument();
    expect(screen.queryByText(/secret internal detail/)).not.toBeInTheDocument();
  });
});
