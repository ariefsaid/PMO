export {
  assertMicrosoftReference,
  itemKind,
  validMicrosoftBrowserUrl,
} from '../../../../supabase/functions/_shared/microsoftDocumentReference';
export type {
  MicrosoftItemKind,
  MicrosoftLibraryDefault,
  MicrosoftReference,
  MicrosoftReferenceInput,
} from '../../../../supabase/functions/_shared/microsoftDocumentReference';

import { validMicrosoftBrowserUrl } from '../../../../supabase/functions/_shared/microsoftDocumentReference';
import type { GraphItem } from './graphClient';

export function buildVersionHistoryUrl(item: Pick<GraphItem, 'web_url' | 'sharepoint_ids'>): string | null {
  const identifiers = item.sharepoint_ids;
  if (!identifiers || !validMicrosoftBrowserUrl(identifiers.site_url)
      || !validMicrosoftBrowserUrl(item.web_url)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifiers.list_id)
      || !/^[1-9][0-9]*$/.test(identifiers.list_item_id)) return null;
  try {
    const site = new URL(identifiers.site_url);
    const itemUrl = new URL(item.web_url);
    if (site.origin !== itemUrl.origin) return null;
    const base = new URL(site.pathname.endsWith('/') ? site.pathname : `${site.pathname}/`, site.origin);
    const history = new URL('_layouts/15/Versions.aspx', base);
    history.searchParams.set('list', `{${identifiers.list_id}}`);
    history.searchParams.set('ID', identifiers.list_item_id);
    return history.toString();
  } catch {
    return null;
  }
}
