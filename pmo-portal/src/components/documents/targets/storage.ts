import { AppError } from '@/src/lib/appError';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { officeViewerUrl, selectRenderer } from '../renderers';
import { PreviewFailure, type DocumentViewTarget, type PreviewResult } from '../types';

export type SignedUrlAccessor = (path: string, opts?: { download?: boolean }) => Promise<string>;

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
 * go to Microsoft's public viewer with that fresh URL (FR-009), and anything else is a Download-only panel.
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
    async load(): Promise<PreviewResult> {
      if (!filePath) throw new PreviewFailure('no_file');
      // The display name decides the renderer; the storage key is the fallback when the title has no extension.
      const renderer = selectRenderer({ name: /\.[a-z0-9]+$/iu.test(name) ? name : filePath, source: 'private' });
      if (renderer === 'unsupported' || renderer === 'microsoft') return { mode: 'unsupported' };
      let url: string;
      try {
        url = await getSignedUrl(filePath);
      } catch {
        throw new PreviewFailure('unavailable');
      }
      if (renderer === 'native-pdf') return { mode: 'pdf', url };
      if (renderer === 'native-image') return { mode: 'image', url };
      return { mode: 'embed', provider: 'office-online', url: officeViewerUrl(url) };
    },
  };
}
