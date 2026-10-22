import type { ProjectDocumentRow } from '@/src/lib/db/documents';

/** Synthetic fixtures only (public repo): reserved example.invalid hosts, no real ids. */
export const ME = 'u-self';
export const OTHER = 'u-other';

export const REFERENCE = {
  drive_id: 'synthetic-drive',
  item_id: 'synthetic-item',
  web_url: 'https://contoso.sharepoint.com/sites/synthetic/Shared%20Documents/Synthetic.pdf',
  name: 'Synthetic.pdf',
  item_kind: 'file' as const,
};

const base: ProjectDocumentRow = {
  id: 'd1',
  project_id: 'p1',
  org_id: 'org-1',
  title: 'Foundation GA',
  code: 'DWG-001',
  category: 'Drawing',
  revision: 'A',
  status: 'Draft',
  author_id: ME,
  doc_date: '2026-06-01',
  file_path: null,
  parent_document_id: null,
  created_at: '2026-06-01T00:00:00Z',
  source: 'upload',
  ms_drive_id: null,
  ms_item_id: null,
  ms_web_url: null,
  ms_item_name: null,
  ms_item_kind: null,
  ms_linked_by: null,
  ms_linked_at: null,
  ms_last_verified_at: null,
  ms_content_tag_at_issue: null,
  ms_version_id_at_issue: null,
  ms_drift_state: null,
  ms_check_claim: null,
  ms_check_claimed_at: null,
};

export const makeDoc = (over: Partial<ProjectDocumentRow> = {}): ProjectDocumentRow => ({ ...base, ...over });

/** A complete Microsoft reference row (file by default). */
export const makeLinkedDoc = (over: Partial<ProjectDocumentRow> = {}): ProjectDocumentRow =>
  makeDoc({
    source: 'onedrive',
    ms_drive_id: REFERENCE.drive_id,
    ms_item_id: REFERENCE.item_id,
    ms_web_url: REFERENCE.web_url,
    ms_item_name: REFERENCE.name,
    ms_item_kind: 'file',
    ms_linked_by: ME,
    ms_linked_at: '2026-06-02T00:00:00Z',
    ...over,
  });
