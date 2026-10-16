export type MicrosoftItemKind = 'file' | 'folder';

export interface MicrosoftReferenceInput {
  drive_id: string;
  item_id: string;
  web_url: string;
  name: string;
  item_kind: MicrosoftItemKind;
}

export interface MicrosoftReference extends MicrosoftReferenceInput {
  linked_by: string;
  linked_at: string;
  last_verified_at: string | null;
}

export interface MicrosoftLibraryDefault {
  site_id: string;
  site_name: string;
  drive_id: string;
  drive_name: string;
}

export function validMicrosoftBrowserUrl(value: unknown): value is string {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function itemKind(item: Record<string, unknown>): MicrosoftItemKind | null {
  const file = item.file != null;
  const folder = item.folder != null;
  return file === folder ? null : file ? 'file' : 'folder';
}

export function assertMicrosoftReference(value: unknown): asserts value is MicrosoftReferenceInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid Microsoft reference');
  const candidate = value as Record<string, unknown>;
  const textFields = ['drive_id', 'item_id', 'web_url', 'name'] as const;
  if (
    !textFields.every((field) => typeof candidate[field] === 'string' && candidate[field].trim() !== '') ||
    !validMicrosoftBrowserUrl(candidate.web_url) ||
    (candidate.item_kind !== 'file' && candidate.item_kind !== 'folder')
  ) {
    throw new Error('Invalid Microsoft reference');
  }
}
