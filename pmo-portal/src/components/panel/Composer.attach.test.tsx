import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';
import { AGENT_ATTACHMENT_MAX_BYTES } from '@/src/lib/agent/attachmentMime';

function renderComposer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const props: React.ComponentProps<typeof Composer> = {
    value: 'still send this',
    onChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    running: false,
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
}

function attachInput(): HTMLInputElement {
  // IMPORTANT-4: the hidden file input is taken out of the a11y tree (no aria-label), so
  // query it by element type rather than by accessible name.
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function mockLargeImageTranscode() {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4000, height: 2000, close: vi.fn() })),
  );
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    toBlob: vi.fn((callback: BlobCallback, type?: string) => {
      callback(new Blob(['webp'], { type: type ?? 'image/webp' }));
    }),
  };
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    if (tagName === 'canvas') {
      return canvas as unknown as HTMLCanvasElement;
    }
    return originalCreateElement(tagName);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Composer attachment affordance', () => {
  it('AC-AT2-002 composer attach rejects oversize and keeps text-send', async () => {
    const user = userEvent.setup();
    const onAttachmentError = vi.fn();
    const onAttachFile = vi.fn();
    const props = renderComposer({ onAttachmentError, onAttachFile });

    const input = attachInput();
    await user.upload(
      input,
      new File([new Uint8Array(AGENT_ATTACHMENT_MAX_BYTES + 1)], 'large.pdf', {
        type: 'application/pdf',
      }),
    );

    expect(onAttachmentError).toHaveBeenCalledWith({
      type: 'oversize',
      message: 'File exceeds 8 MB limit',
    });
    expect(onAttachFile).not.toHaveBeenCalled();

    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeEnabled();
    await user.click(send);
    expect(props.onSend).toHaveBeenCalledOnce();
  });

  it('AC-AT2-003 composer attach transcodes images before handing them to upload', async () => {
    const user = userEvent.setup();
    const onAttachFile = vi.fn();
    mockLargeImageTranscode();
    renderComposer({ onAttachFile });

    const input = attachInput();
    await user.upload(input, new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(onAttachFile).toHaveBeenCalledWith(expect.any(File)));
    const prepared = onAttachFile.mock.calls[0][0] as File;
    expect(prepared.name).toBe('photo.webp');
    expect(prepared.type).toBe('image/webp');
  });

  it('IMPORTANT-3 an upload failure is not collapsed to a generic server error (hook owns classification)', async () => {
    // FR-AT2-ATT-009: a network/timeout upload error must surface its SPECIFIC classification
    // (timeout/cancel/network), set inside useAgentAttachments — the Composer must NOT
    // override it with a generic {type:'server'} message.
    const onAttachmentError = vi.fn();
    const onAttachFile = vi.fn().mockRejectedValue(new Error('network down'));
    renderComposer({ onAttachmentError, onAttachFile });

    const input = attachInput();
    fireEvent.change(input, {
      target: { files: { 0: new File(['pdf'], 'quote.pdf', { type: 'application/pdf' }), length: 1 } },
    });

    await waitFor(() => expect(onAttachFile).toHaveBeenCalled());
    // The hook recorded its own classified error before rejecting; the Composer does not
    // translate/override it.
    expect(onAttachmentError).not.toHaveBeenCalled();
  });

  it('IMPORTANT-3 a transcode failure surfaces a transcode-specific error (not a generic upload error)', async () => {
    const onAttachmentError = vi.fn();
    const onAttachFile = vi.fn();
    // transcodeImage rejects (e.g. a corrupt bitmap) — the Composer owns THIS classification.
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad bitmap'); }));
    renderComposer({ onAttachmentError, onAttachFile });

    const input = attachInput();
    fireEvent.change(input, {
      target: { files: { 0: new File(['x'], 'photo.jpg', { type: 'image/jpeg' }), length: 1 } },
    });

    await waitFor(() =>
      expect(onAttachmentError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'type' }),
      ),
    );
    // The upload handler is never reached when the transcode itself fails.
    expect(onAttachFile).not.toHaveBeenCalled();
  });

  it('IMPORTANT-4 the visible button is the sole accessible "Attach file" control', () => {
    renderComposer({ onAttachFile: vi.fn(), onAttachmentError: vi.fn() });

    // Exactly one accessible control is named "Attach file" — the visible button.
    expect(screen.getAllByRole('button', { name: /attach file/i })).toHaveLength(1);

    // The hidden file input is functional (for programmatic click + Playwright setInputFiles)
    // but removed from the a11y + tab tree so it does not double the accessible name.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute('aria-label')).toBeNull();
    expect(input.getAttribute('aria-hidden')).toBe('true');
    expect(input.tabIndex).toBe(-1);
  });

  it('IMPORTANT-9 dropping a file routes through the same upload handler as the attach button', async () => {
    const onAttachFile = vi.fn().mockResolvedValue(undefined);
    renderComposer({ onAttachFile });

    // The composer container (the drop target) wraps the input row.
    const dropzone = document.querySelector('input[type="file"]')
      ?.closest('div')?.parentElement as HTMLElement;
    expect(dropzone).not.toBeNull();

    fireEvent.dragOver(dropzone, {
      dataTransfer: { files: [new File(['pdf'], 'drop.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(['pdf'], 'drop.pdf', { type: 'application/pdf' })] },
    });

    await waitFor(() =>
      expect(onAttachFile).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'drop.pdf' }),
      ),
    );
  });
});
