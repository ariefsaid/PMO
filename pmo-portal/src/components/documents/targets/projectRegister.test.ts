import { describe, expect, it, vi } from 'vitest';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { projectRegisterTarget } from './projectRegister';

const getSignedUrl = vi.fn();
const base = { id: 'd1', title: 'Survey', status: 'Issued', file_path: null, source: 'upload' };
const doc = (over: Record<string, unknown>) => ({ ...base, ...over }) as unknown as ProjectDocumentRow;
const ms = {
  source: 'onedrive', ms_drive_id: 'drv', ms_item_id: 'itm', ms_item_name: 'Plan.pdf', ms_item_kind: 'file',
  ms_web_url: 'https://tenant.sharepoint.com/sites/x/Plan.pdf',
  // A COMPLETE reference: `projectReference` refuses a row missing its provenance, so a fixture without
  // these is not a Microsoft reference at all (and would pass this test for the wrong reason).
  ms_linked_by: 'u1', ms_linked_at: '2026-10-01T00:00:00Z',
};

describe('projectRegisterTarget', () => {
  it('AC-015 a stored file opens the project-document storage target', () => {
    const t = projectRegisterTarget(doc({ file_path: 'org/p/d1/s.pdf' }), getSignedUrl);
    expect(t?.key).toBe('project-document:d1');
    expect(t?.name).toBe('Survey');
  });

  it('AC-015 a SharePoint reference opens the project_document Graph target', () => {
    const t = projectRegisterTarget(doc(ms), getSignedUrl);
    expect(t).not.toBeNull();
    expect(t?.name).toBe('Survey');
    expect(t?.key).not.toBe('project-document:d1');
  });

  it('AC-015 no file and no reference returns null', () => {
    expect(projectRegisterTarget(doc({}), getSignedUrl)).toBeNull();
  });

  // `validMicrosoftBrowserUrl` (the shipped rule, shared with `useDocumentFiles`) refuses a URL that is not a
  // browser-safe https URL — never credentials, control characters or a non-https scheme. It does NOT pin the
  // host: the preview itself reads by typed id (`project_document`), so the URL only feeds "open in source".
  // (An earlier version of this test used `https://evil.example/x`, which is a VALID browser URL — it passed
  // only because the fixture was an incomplete reference.)
  it.each(['http://tenant.sharepoint.com/sites/x/Plan.pdf', 'javascript:alert(1)', 'https://user:pw@tenant.sharepoint.com/x'])(
    'AC-015 a URL that is not a safe https link (%s) returns null',
    (ms_web_url) => {
      expect(projectRegisterTarget(doc({ ...ms, ms_web_url }), getSignedUrl)).toBeNull();
    },
  );
});
