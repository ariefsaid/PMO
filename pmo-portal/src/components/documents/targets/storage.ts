import { AppError } from '@/src/lib/appError';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { MAX_FILE_SIZE_BYTES, OFFICE_PREVIEW_URL_SECONDS } from '@/src/lib/fileConstants';
import { parseDxf } from '../dxf';
import { officeViewerUrl, selectRenderer } from '../renderers';
import { PreviewFailure, type DocumentViewTarget, type PreviewResult } from '../types';

/** The most of a plain-text file the panel shows; the rest is a Download away. */
export const TEXT_PREVIEW_BYTES = 256 * 1024;

/**
 * The file's bytes, read once from a fresh signed URL; any refusal or network failure is an unavailable preview.
 * With `limit`, Storage is asked for only the first `limit` bytes (Range), and at most that many are read even
 * when the server ignores the range and sends the whole file.
 */
async function readBytes(url: string, signal: AbortSignal, limit?: number): Promise<Uint8Array> {
  try {
    const response = await fetch(url, {
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      ...(limit === undefined ? {} : { headers: { Range: `bytes=0-${limit - 1}` } }),
    });
    if (!response.ok) throw new PreviewFailure('unavailable');
    if (limit === undefined || !response.body) {
      const all = new Uint8Array(await response.arrayBuffer());
      return limit === undefined ? all : all.subarray(0, limit);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    if (size >= limit) void reader.cancel().catch(() => {});
    const bytes = new Uint8Array(Math.min(size, limit));
    let at = 0;
    for (const chunk of chunks) {
      const part = chunk.subarray(0, bytes.byteLength - at);
      bytes.set(part, at);
      at += part.byteLength;
    }
    return bytes;
  } catch (err) {
    throw err instanceof PreviewFailure ? err : new PreviewFailure('unavailable');
  }
}

/** Plain text and DXF drawings are read in the browser and shown as text / as a drawing, never as markup. */
async function readLocally(renderer: 'native-text' | 'native-cad', url: string, signal: AbortSignal): Promise<PreviewResult> {
  if (renderer === 'native-text') {
    // One byte past the cap tells a cut file from one that fits exactly.
    const bytes = await readBytes(url, signal, TEXT_PREVIEW_BYTES + 1);
    const truncated = bytes.byteLength > TEXT_PREVIEW_BYTES;
    // `stream: true` holds back a character split by the cut instead of showing U+FFFD.
    const text = truncated
      ? new TextDecoder().decode(bytes.subarray(0, TEXT_PREVIEW_BYTES), { stream: true })
      : new TextDecoder().decode(bytes);
    return { mode: 'text', text, truncated };
  }
  const bytes = await readBytes(url, signal);
  if (bytes.byteLength > MAX_FILE_SIZE_BYTES) return { mode: 'unsupported' };
  const drawing = parseDxf(new TextDecoder().decode(bytes));
  return drawing ? { mode: 'drawing', drawing } : { mode: 'unsupported' };
}

export type SignedUrlAccessor = (path: string, opts?: { download?: boolean; expiresIn?: number }) => Promise<string>;

export interface StorageTargetInput {
  key: string;
  name: string;
  /** The private Storage key; absent means the record has no file attached. */
  filePath: string | null;
  /** The parent-authorized accessor of the surface (document / procurement-file repository, receipt reader). */
  getSignedUrl: SignedUrlAccessor;
  sourceLabel?: string;
  /** Replaces the default signed-URL download (receipts bring their own parent-authorized accessor). */
  download?: () => void | Promise<void>;
}

/** A classified, user-readable download refusal (FR-010): the panel states the reason. */
async function downloadFile(filePath: string, getSignedUrl: SignedUrlAccessor): Promise<void> {
  let url: string;
  try {
    url = await getSignedUrl(filePath, { download: true });
  } catch (err) {
    const { headline, detail } = classifyMutationError(err);
    throw new AppError(detail ?? headline);
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filePath.split('/').pop() || 'file';
  a.click();
}

/**
 * One adapter for every private-Storage document: project files, purchase attachments and receipts. The
 * signed URL is acquired on open and on every Retry (never cached or prefetched, NFR-002/004); Office files
 * go to Microsoft's public viewer with that fresh URL (FR-009), plain text and DXF drawings are read here
 * (#1588), and anything else is a Download-only panel.
 */
export function storageTarget(input: StorageTargetInput): DocumentViewTarget {
  const { key, name, filePath, getSignedUrl } = input;
  const download = input.download
    ? async () => { await input.download!(); }
    : filePath ? () => downloadFile(filePath, getSignedUrl) : undefined;
  return {
    key,
    name,
    sourceLabel: input.sourceLabel ?? 'PMO',
    download,
    async load(signal): Promise<PreviewResult> {
      if (!filePath) throw new PreviewFailure('no_file');
      // The display name decides the renderer; the storage key is the fallback when the title has no extension.
      const renderer = selectRenderer({ name: /\.[a-z0-9]+$/iu.test(name) ? name : filePath, source: 'private' });
      if (renderer === 'unsupported' || renderer === 'microsoft') return { mode: 'unsupported' };
      let url: string;
      try {
        // The public Office viewer fetches the file once on open, so its link is short-lived.
        url = renderer === 'native-pdf' || renderer === 'native-image' || renderer === 'native-text' || renderer === 'native-cad'
          ? await getSignedUrl(filePath)
          : await getSignedUrl(filePath, { expiresIn: OFFICE_PREVIEW_URL_SECONDS });
      } catch {
        throw new PreviewFailure('unavailable');
      }
      if (renderer === 'native-text' || renderer === 'native-cad') return readLocally(renderer, url, signal);
      if (renderer === 'native-pdf') return { mode: 'pdf', url };
      if (renderer === 'native-image') return { mode: 'image', url };
      return { mode: 'embed', provider: 'office-online', url: officeViewerUrl(url) };
    },
  };
}
