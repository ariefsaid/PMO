// @vitest-environment jsdom
// Uses XHR + ProgressEvent (DOM globals absent in the `node` test project — perf/test-speed split).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadWithProgress, TransportError, classifyUploadError } from './uploadTransport';

// ── XHR mock ────────────────────────────────────────────────────────────────
let xhrInstances: MockXHR[] = [];

type MockUploadProgressHandler = (event: ProgressEvent) => void;

class MockXHR {
  open = vi.fn<(method: string, url: string) => void>();
  send = vi.fn<(body?: Document | XMLHttpRequestBodyInit | null) => void>();
  abort = vi.fn<() => void>();
  setRequestHeader = vi.fn<(name: string, value: string) => void>();
  upload: { onprogress: MockUploadProgressHandler | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  timeout = 0;
  status = 200;
  responseText = '';

  constructor() {
    xhrInstances.push(this);
  }
}

beforeEach(() => {
  xhrInstances = [];
  vi.stubGlobal('XMLHttpRequest', MockXHR);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uploadWithProgress', () => {
  it('sends PUT with Content-Type and x-upsert headers', async () => {
    const promise = uploadWithProgress('http://example.com/upload', new Blob(['data']), {
      contentType: 'application/pdf',
      upsert: true,
    });
    const xhr = xhrInstances[0];
    expect(xhr.open).toHaveBeenCalledWith('PUT', 'http://example.com/upload');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('x-upsert', 'true');
    expect(xhr.send).toHaveBeenCalled();
    xhr.status = 200;
    xhr.onload?.();
    await promise;
  });

  it('AC-DOC-023 (transport): onProgress callback fires with real percentage', async () => {
    const onProgress = vi.fn();
    const promise = uploadWithProgress('http://example.com/upload', new Blob(['data']), {
      contentType: 'application/pdf',
      onProgress,
    });
    const xhr = xhrInstances[0];
    xhr.upload.onprogress?.(new ProgressEvent('progress', { lengthComputable: true, loaded: 2560, total: 5120 }));
    expect(onProgress).toHaveBeenCalledWith(50);
    xhr.upload.onprogress?.(new ProgressEvent('progress', { lengthComputable: true, loaded: 5120, total: 5120 }));
    expect(onProgress).toHaveBeenCalledWith(100);
    xhr.status = 200;
    xhr.onload?.();
    await promise;
  });

  it('AC-DOC-023 (transport): AbortSignal aborts the XHR and rejects with AbortError', async () => {
    const controller = new AbortController();
    const promise = uploadWithProgress('http://example.com/upload', new Blob(['data']), {
      contentType: 'application/pdf',
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toThrow('Upload cancelled');
    await expect(promise).rejects.toBeInstanceOf(DOMException);
  });

  it('rejects with TransportError on HTTP 413 (oversize)', async () => {
    const promise = uploadWithProgress('http://example.com/upload', new Blob(['data']), {
      contentType: 'application/pdf',
    });
    const xhr = xhrInstances[0];
    xhr.status = 413;
    xhr.responseText = 'Payload too large';
    xhr.onload?.();
    await expect(promise).rejects.toThrow(TransportError);
    try {
      await promise;
    } catch (error) {
      expect((error as TransportError).status).toBe(413);
    }
  });

  it('rejects with TransportError on network error', async () => {
    const promise = uploadWithProgress('http://example.com/upload', new Blob(['data']), {
      contentType: 'application/pdf',
    });
    const xhr = xhrInstances[0];
    xhr.onerror?.();
    await expect(promise).rejects.toThrow(TransportError);
    try {
      await promise;
    } catch (error) {
      expect((error as TransportError).status).toBe(0);
    }
  });

  it('harden #5: sets a default xhr.timeout so a stalled upload cannot hang forever', () => {
    uploadWithProgress('http://example.com/upload', new Blob(['data']), {
      contentType: 'application/pdf',
    });
    const xhr = xhrInstances[0];
    // A non-zero timeout MUST be armed (0 = XHR default of "never time out").
    expect(xhr.timeout).toBeGreaterThan(0);
  });

  it('harden #5: honors an explicit timeoutMs override', () => {
    uploadWithProgress('http://example.com/upload', new Blob(['data']), {
      contentType: 'application/pdf',
      timeoutMs: 1234,
    });
    expect(xhrInstances[0].timeout).toBe(1234);
  });

  it('harden #5: rejects with a classified timeout TransportError on ontimeout', async () => {
    const promise = uploadWithProgress('http://example.com/upload', new Blob(['data']), {
      contentType: 'application/pdf',
    });
    const xhr = xhrInstances[0];
    xhr.ontimeout?.();
    await expect(promise).rejects.toThrow(TransportError);
    try {
      await promise;
    } catch (error) {
      // Timeout is distinguishable from a plain network error so the UI can say "timed out".
      expect((error as TransportError).status).toBe(408);
      expect(classifyUploadError(error).type).toBe('timeout');
    }
  });
});

describe('classifyUploadError', () => {
  it('classifies AbortError as cancel', () => {
    const err = new DOMException('Upload cancelled', 'AbortError');
    const result = classifyUploadError(err);
    expect(result.type).toBe('cancel');
  });

  it('classifies TransportError 413 as oversize', () => {
    const err = new TransportError(413, 'Payload too large');
    const result = classifyUploadError(err);
    expect(result.type).toBe('oversize');
    expect(result.message).toContain('exceeds');
  });

  it('classifies TransportError 0 as network', () => {
    const err = new TransportError(0, 'Network error during upload');
    const result = classifyUploadError(err);
    expect(result.type).toBe('network');
    expect(result.message).toContain('try again');
  });

  it('classifies unknown TransportError as server', () => {
    const err = new TransportError(500, 'Internal server error');
    const result = classifyUploadError(err);
    expect(result.type).toBe('server');
    expect(result.message).toContain('try again');
  });

  it('AC-DOC-024: classifies structural AppErrors from the DAL as upload-failed copy', () => {
    const result = classifyUploadError({ code: '42501', message: 'storage unavailable' });
    expect(result).toEqual({ type: 'server', message: 'Upload failed — try again' });
  });
});
