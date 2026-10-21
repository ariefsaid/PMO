import { browseOneDrive, searchDrive, type GraphItem, type GraphPage } from './graphClient';
import type { MicrosoftLibraryDefault } from './reference';
import {
  folderMatches,
  recordFolderConvention,
  type PickerContext,
} from '../../../../supabase/functions/_shared/microsoftFolderConvention';

export type { PickerContext } from '../../../../supabase/functions/_shared/microsoftFolderConvention';
export { normalizeFolderParentPath } from '../../../../supabase/functions/_shared/microsoftFolderConvention';

export async function suggestFolders(
  library: MicrosoftLibraryDefault,
  context: PickerContext,
): Promise<GraphItem[]> {
  const convention = recordFolderConvention(context);
  if (!convention) return [];
  try {
    let page: GraphPage<GraphItem> = await searchDrive(library.drive_id, convention.term);
    const items: GraphItem[] = [];
    for (let index = 0; index < 3; index += 1) {
      items.push(...page.value);
      if (!page.next) return items.filter((item) => folderMatches(item, convention, library.drive_id));
      if (index === 2) return [];
      page = await browseOneDrive(page.next);
    }
    return [];
  } catch {
    return [];
  }
}
