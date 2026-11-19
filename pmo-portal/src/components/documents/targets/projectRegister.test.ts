import { describe, expect, it, vi } from 'vitest';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { projectRegisterTarget } from './projectRegister';

const getSignedUrl = vi.fn();
const base = { id: 'd1', title: 'Survey', status: 'Issued', file_path: null, source: 'upload' };
const doc = (over: Record<string, unknown>) => ({ ...base, ...over }) as unknown as ProjectDocumentRow;
const microsoft = {
  source: 'onedrive', ms_drive_id: 'drv', ms_item_id: 'itm', ms_item_name: 'Plan.pdf', ms_item_kind: 'file',
  ms_web_url: 'https://tenant.sharepoint.com/sites/x/Plan.pdf', ms_linked_by: 'u1', ms_linked_at: '2026-10-01T00:00:00Z',
};

describe('projectRegisterTarget', () => {
  it('document-preview AC-015 uses the project-document key for a stored file', () => {
    const target = projectRegisterTarget(doc({ file_path: 'org/p/d1/s.pdf' }), getSignedUrl);
    expect(target?.key).toBe('project-document:d1');
    expect(target?.name).toBe('Survey');
  });

  it('document-preview AC-015 uses the typed project reference for a SharePoint file', () => {
    const target = projectRegisterTarget(doc(microsoft), getSignedUrl);
    expect(target).not.toBeNull();
    expect(target?.name).toBe('Survey');
    expect(target?.key).not.toBe('project-document:d1');
  });

  it('document-preview AC-015 returns null when neither storage nor a valid reference exists', () => {
    expect(projectRegisterTarget(doc({}), getSignedUrl)).toBeNull();
  });

  it.each(['http://tenant.sharepoint.com/sites/x/Plan.pdf', 'javascript:alert(1)', 'https://user:pw@tenant.sharepoint.com/x'])(
    'document-preview AC-015 refuses a browser-unsafe reference URL (%s)',
    (ms_web_url) => expect(projectRegisterTarget(doc({ ...microsoft, ms_web_url }), getSignedUrl)).toBeNull(),
  );
});
