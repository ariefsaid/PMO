// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerBlobDownload } from './download';

describe('triggerBlobDownload', () => {
  let clicked: Array<{ href: string; download: string; attached: boolean }>;

  beforeEach(() => {
    vi.useFakeTimers();
    clicked = [];
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), writable: true, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true, configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download, attached: this.isConnected });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('saves the blob under the given name and leaves no anchor behind', () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    triggerBlobDownload(blob, 'ACC-SINV-2026-00001.pdf');
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:mock', download: 'ACC-SINV-2026-00001.pdf', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('revokes the object URL only after the click has been handed to the browser', () => {
    triggerBlobDownload(new Blob(['x']), 'x.csv');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
