import { describe, expect, it, vi } from 'vitest';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { projectRegisterTarget } from './projectRegister';

const getSignedUrl = vi.fn();
const base = { id: 'd1', title: 'Survey', status: 'Issued', file_path: null, source: 'upload' };
const doc = (over: Record<string, unknown>) => ({ ...base, ...over }) as unknown as ProjectDocumentRow;
const ms = {
  source: 'onedrive', ms_drive_id: 'drv', ms_item_id: 'itm', ms_item_name: 'Plan.pdf', ms_item_kind: 'file',
  ms_web_url: 'https://tenant.sharepoint.com/sites/x/Plan.pdf',
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

  it('AC-015 an invalid Microsoft URL returns null', () => {
    expect(projectRegisterTarget(doc({ ...ms, ms_web_url: 'https://evil.example/x' }), getSignedUrl)).toBeNull();
  });
});
