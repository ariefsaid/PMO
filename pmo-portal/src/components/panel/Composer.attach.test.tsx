import { render, screen, waitFor } from '@testing-library/react';
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
  return screen.getByLabelText('Attach file', { selector: 'input' }) as HTMLInputElement;
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
});
