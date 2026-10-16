import { browseOneDrive, searchDrive, type GraphItem, type GraphPage } from './graphClient';
import type { MicrosoftLibraryDefault } from './reference';

export type PickerContext =
  | { kind: 'project'; code: string | null }
  | { kind: 'procurement'; request_number: string | null; created_at: string }
  | { kind: 'budget' };

function normalizeParentPath(path: string | null, driveId: string): string | null {
  if (!path) return null;
  let suffix: string;
  const drivePrefix = `/drives/${driveId}/root:`;
  if (path.startsWith(drivePrefix)) suffix = path.slice(drivePrefix.length);
  else if (path.startsWith('/drive/root:')) suffix = path.slice('/drive/root:'.length);
  else return null;
  if (suffix !== '' && !suffix.startsWith('/')) return null;
  const segments: string[] = [];
  for (const raw of suffix.split('/').filter(Boolean)) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')
      || [...segment].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      })) return null;
    segments.push(segment);
  }
  return `/drive/root:${segments.length ? `/${segments.join('/')}` : ''}`;
}

function contextSearch(context: PickerContext): { term: string; parent: string } | null {
  if (context.kind === 'project') {
    const term = context.code?.trim();
    return term ? { term, parent: '/drive/root:/Projects' } : null;
  }
  if (context.kind === 'procurement') {
    const term = context.request_number?.trim();
    const createdAt = new Date(context.created_at);
    if (!term || Number.isNaN(createdAt.getTime())) return null;
    return { term, parent: `/drive/root:/Procurement/${createdAt.getUTCFullYear()}` };
  }
  return null;
}

export async function suggestFolders(
  library: MicrosoftLibraryDefault,
  context: PickerContext,
): Promise<GraphItem[]> {
  const search = contextSearch(context);
  if (!search) return [];
  try {
    let page: GraphPage<GraphItem> = await searchDrive(library.drive_id, search.term);
    const items: GraphItem[] = [];
    for (let index = 0; index < 3; index += 1) {
      items.push(...page.value);
      if (!page.next) {
        const prefix = search.term.toLocaleLowerCase('en');
        return items.filter((item) => item.drive_id === library.drive_id
          && item.item_kind === 'folder'
          && item.name.toLocaleLowerCase('en').startsWith(prefix)
          && normalizeParentPath(item.parent_path, library.drive_id) === search.parent);
      }
      if (index === 2) return [];
      page = await browseOneDrive(page.next);
    }
    return [];
  } catch {
    return [];
  }
}
