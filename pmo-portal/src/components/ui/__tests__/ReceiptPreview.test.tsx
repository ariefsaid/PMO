import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ReceiptPreview } from '../ReceiptPreview';

describe('ReceiptPreview', () => {
  it('AC-UXS-012 previews a signed image and restores focus after Escape', async () => {
    const user = userEvent.setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    render(<ReceiptPreview fileName="receipt.png" getPreviewUrl={vi.fn().mockResolvedValue('https://signed.test/receipt.png')} />);
    await user.click(screen.getByRole('button', { name: 'Preview receipt' }));
    expect(await screen.findByRole('img', { name: 'receipt.png' })).toHaveAttribute('src', 'https://signed.test/receipt.png');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Preview receipt' })).toHaveFocus();
    opener.remove();
  });

  it('AC-UXS-012 exposes loading, retrieval error, and unsupported-file download fallback', async () => {
    let resolve!: (url: string) => void;
    const getPreviewUrl = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const first = render(<ReceiptPreview fileName="receipt.pdf" getPreviewUrl={getPreviewUrl} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview receipt' }));
    expect(screen.getByText('Loading receipt…')).toBeInTheDocument();
    resolve('https://signed.test/receipt.pdf');
    await waitFor(() => expect(screen.getByRole('dialog').querySelector('iframe')).toHaveAttribute('src', 'https://signed.test/receipt.pdf'));
    expect(screen.getByRole('dialog').querySelector('iframe')).toHaveAttribute('tabindex', '0');
    first.unmount();

    const failed = render(<ReceiptPreview fileName="receipt.tiff" getPreviewUrl={vi.fn().mockRejectedValue(new Error('failed'))} onDownload={vi.fn()} />);
    await userEvent.click(failed.getByRole('button', { name: 'Preview receipt' }));
    expect(await failed.findByText('Preview is not available for this file type.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Download original' })).toHaveLength(1);
    failed.unmount();

    const retrievalFailure = render(<ReceiptPreview fileName="receipt.png" getPreviewUrl={vi.fn().mockRejectedValue(new Error('failed'))} onDownload={vi.fn()} />);
    await userEvent.click(retrievalFailure.getByRole('button', { name: 'Preview receipt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't preview this file.");
    expect(retrievalFailure.getByRole('button', { name: 'Download original' })).toBeInTheDocument();
  });
});
