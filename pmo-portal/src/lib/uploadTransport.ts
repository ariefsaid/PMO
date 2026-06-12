/**
 * XHR-based upload transport for Supabase Storage signed upload URLs.
 * Provides real progress percentage via XMLHttpRequest.upload.onprogress and
 * real cancel via AbortSignal → xhr.abort(). Replaces the fetch-based
 * supabase.storage.from(bucket).upload() which has no progress support.
 *
 * Usage: DAL creates a signed upload URL, then this util PUTs the file to it.
 */

export interface UploadTransportOptions {
  /** MIME type to set as Content-Type header. Use FILE_MIME_BY_EXT, not file.type. */
  contentType: string;
  /** Whether to allow overwriting an existing object at the same path. */
  upsert?: boolean;
  /** Called with 0–100 during the upload (real XHR progress). */
  onProgress?: (percent: number) => void;
  /** AbortSignal for cancellation. Wires directly to xhr.abort(). */
  signal?: AbortSignal;
}

/** Error thrown when the XHR upload fails with an HTTP status. */
export class TransportError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

/**
 * Upload a file to a signed URL via XHR PUT. Returns a promise that resolves
 * on success, rejects on HTTP error / network error / abort.
 */
export function uploadWithProgress(
  url: string,
  file: File | Blob,
  options: UploadTransportOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', options.contentType);
    if (options.upsert) {
      xhr.setRequestHeader('x-upsert', 'true');
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new TransportError(xhr.status, xhr.responseText || `Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      reject(new TransportError(0, 'Network error during upload'));
    };

    if (options.signal) {
      const onAbort = () => {
        xhr.abort();
        reject(new DOMException('Upload cancelled', 'AbortError'));
      };
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.send(file);
  });
}

// ── Error classification ────────────────────────────────────────────────────

export type UploadErrorType = 'oversize' | 'type' | 'network' | 'server' | 'cancel';

export interface ClassifiedUploadError {
  type: UploadErrorType;
  message: string;
}

/**
 * Classify an upload error (from transport or DAL) into a user-facing type + message.
 * Used by the hook to set the correct error state in the UI.
 */
export function classifyUploadError(
  error: unknown,
  maxFileSizeMB: number = 5,
): ClassifiedUploadError {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { type: 'cancel', message: 'Upload cancelled' };
  }
  if (error instanceof TransportError) {
    if (error.status === 0) {
      return { type: 'network', message: 'Upload failed — try again' };
    }
    if (
      error.status === 413 ||
      error.message.toLowerCase().includes('exceed') ||
      error.message.toLowerCase().includes('size') ||
      error.message.toLowerCase().includes('payload too large')
    ) {
      return { type: 'oversize', message: `File exceeds ${maxFileSizeMB} MB limit` };
    }
    if (
      error.message.toLowerCase().includes('mime') ||
      error.message.toLowerCase().includes('type') ||
      error.message.toLowerCase().includes('not allowed')
    ) {
      return { type: 'type', message: 'File type not allowed' };
    }
    return { type: 'server', message: 'Upload failed — try again' };
  }
  return { type: 'server', message: 'Upload failed — try again' };
}