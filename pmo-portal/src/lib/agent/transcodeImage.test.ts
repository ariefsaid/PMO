import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_ATTACHMENT_IMAGE_MAX_DIMENSION,
  AGENT_ATTACHMENT_IMAGE_QUALITY,
  transcodeImage,
} from './transcodeImage';

function imageFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function mockBitmap(width: number, height: number) {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close })));
  return { close };
}

function mockCanvas() {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob: vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
      callback(new Blob(['webp'], { type: type ?? 'image/webp' }));
      expect(type).toBe('image/webp');
      expect(quality).toBe(AGENT_ATTACHMENT_IMAGE_QUALITY);
    }),
  };
  const createElement = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    if (tagName === 'canvas') {
      return canvas as unknown as HTMLCanvasElement;
    }
    return document.createElement(tagName);
  });
  return { canvas, drawImage, createElement };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('agent attachment image transcode', () => {
  it('AC-AT2-003 large image downscaled/transcoded before upload', async () => {
    const bitmap = mockBitmap(4000, 2000);
    const { canvas, drawImage } = mockCanvas();

    const result = await transcodeImage(imageFile());

    expect(AGENT_ATTACHMENT_IMAGE_MAX_DIMENSION).toBe(1600);
    expect(result).toBeInstanceOf(File);
    expect(result.name).toBe('photo.webp');
    expect(result.type).toBe('image/webp');
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(800);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('returns small images unchanged and rejects non-image files', async () => {
    const small = imageFile('small.png', 'image/png');
    mockBitmap(800, 600);

    await expect(transcodeImage(small)).resolves.toBe(small);
    await expect(transcodeImage(new File(['pdf'], 'brief.pdf', { type: 'application/pdf' }))).rejects.toThrow(
      'Attachment is not an image',
    );
  });
});
