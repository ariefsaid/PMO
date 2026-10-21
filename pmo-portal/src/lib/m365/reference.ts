import type { Tables } from '@/src/lib/supabase/database.types';
import type { MicrosoftItemKind, MicrosoftReference } from '../../../../supabase/functions/_shared/microsoftDocumentReference';
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

// ---------------------------------------------------------------------------
// Row -> reference projections and display helpers (browser only). DB rows stay snake_case; these
// read the generated row shapes directly and return null unless the row is a COMPLETE Microsoft
// reference, so a legacy plain link or an upload can never be mistaken for one.
// ---------------------------------------------------------------------------

export type ReferenceOwner =
  | {
      kind: 'project'; id: string; status: string;
      content_tag_at_issue: string | null; version_id_at_issue: string | null;
      drift_state: 'clean' | 'drifted' | 'not_verified' | null; last_verified_at: string | null;
    }
  | { kind: 'procurement'; id: string }
  | { kind: 'budget'; id: string };

const asKind = (value: string | null): MicrosoftItemKind | null => (value === 'file' || value === 'folder' ? value : null);

interface RawReference {
  drive_id: string | null; item_id: string | null; web_url: string | null; name: string | null;
  kind: string | null; linked_by: string | null; linked_at: string | null; last_verified_at: string | null;
}

function toReference(raw: RawReference): MicrosoftReference | null {
  const kind = asKind(raw.kind);
  if (!raw.drive_id || !raw.item_id || !raw.web_url || !raw.name || !kind || !raw.linked_by || !raw.linked_at) return null;
  return {
    drive_id: raw.drive_id, item_id: raw.item_id, web_url: raw.web_url, name: raw.name, item_kind: kind,
    linked_by: raw.linked_by, linked_at: raw.linked_at, last_verified_at: raw.last_verified_at,
  };
}

export function projectReference(row: Tables<'project_documents'>): MicrosoftReference | null {
  if (row.source !== 'onedrive') return null;
  return toReference({
    drive_id: row.ms_drive_id, item_id: row.ms_item_id, web_url: row.ms_web_url, name: row.ms_item_name,
    kind: row.ms_item_kind, linked_by: row.ms_linked_by, linked_at: row.ms_linked_at, last_verified_at: row.ms_last_verified_at,
  });
}

export function projectOwner(row: Tables<'project_documents'>): ReferenceOwner {
  const drift = row.ms_drift_state;
  return {
    kind: 'project', id: row.id, status: row.status,
    content_tag_at_issue: row.ms_content_tag_at_issue, version_id_at_issue: row.ms_version_id_at_issue,
    drift_state: drift === 'clean' || drift === 'drifted' || drift === 'not_verified' ? drift : null,
    last_verified_at: row.ms_last_verified_at,
  };
}

/** Procurement keeps its sole browser URL in `link`; a plain legacy link without a source is NOT a reference. */
export function procurementReference(row: Tables<'procurement_documents'>): MicrosoftReference | null {
  if (row.source !== 'onedrive') return null;
  return toReference({
    drive_id: row.ms_drive_id, item_id: row.ms_item_id, web_url: row.link, name: row.ms_item_name,
    kind: row.ms_item_kind, linked_by: row.ms_linked_by, linked_at: row.ms_linked_at, last_verified_at: row.ms_last_verified_at,
  });
}

export function budgetReference(row: Tables<'budget_version_document_links'>): MicrosoftReference | null {
  return toReference({
    drive_id: row.ms_drive_id, item_id: row.ms_item_id, web_url: row.ms_web_url, name: row.ms_item_name,
    kind: row.ms_item_kind, linked_by: row.ms_linked_by, linked_at: row.ms_linked_at, last_verified_at: row.ms_last_verified_at,
  });
}

export type MicrosoftProvenance = 'SharePoint' | 'OneDrive' | 'Microsoft 365';

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Provenance from the stored URL's host, on a label boundary: `evilsharepoint.com` is not SharePoint. */
export function microsoftProvenance(url: string): MicrosoftProvenance {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return 'Microsoft 365'; }
  if (hostIs(host, 'sharepoint.com')) return 'SharePoint';
  if (hostIs(host, 'onedrive.live.com') || hostIs(host, 'onedrive.com') || hostIs(host, '1drv.ms')) return 'OneDrive';
  return 'Microsoft 365';
}
