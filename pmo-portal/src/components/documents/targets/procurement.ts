import type { ProcPhase, ProcurementFileRow } from '@/src/lib/db/procurementFiles';
import type { DocumentViewTarget } from '../types';
import { microsoftTarget } from './microsoft';
import { storageTarget, type SignedUrlAccessor } from './storage';

export type ProcurementFileLike = Pick<ProcurementFileRow, 'id' | 'title' | 'file_path' | 'source' | 'ms_web_url' | 'ms_item_name'>;

/** The file name the panel shows: the Microsoft item name, else the storage key's last segment, else the title. */
export function procurementFileName(file: ProcurementFileLike): string {
  if (file.source === 'onedrive' && file.ms_item_name) return file.ms_item_name;
  const fromPath = file.file_path?.split('/').pop();
  return fromPath || file.title || 'file';
}

/** A purchase phase attachment: SharePoint-backed rows go through custody, stored rows through a fresh signed URL. */
export function procurementFileTarget(input: { phase: ProcPhase; file: ProcurementFileLike; getSignedUrl: SignedUrlAccessor }): DocumentViewTarget {
  const { phase, file } = input;
  const name = procurementFileName(file);
  if (file.source === 'onedrive' && file.ms_web_url) {
    return microsoftTarget({ request: { kind: 'procurement_file', phase, id: file.id }, name, webUrl: file.ms_web_url });
  }
  return storageTarget({ key: `procurement-file:${phase}:${file.id}`, name, filePath: file.file_path, getSignedUrl: input.getSignedUrl });
}
