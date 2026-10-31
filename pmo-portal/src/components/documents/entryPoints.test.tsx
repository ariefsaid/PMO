// @vitest-environment jsdom
import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MicrosoftReference, ReferenceOwner } from '@/src/lib/m365/reference';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { ToastProvider } from '@/src/components/ui';
import { DocumentViewerContext, type DocumentViewerApi } from './viewerContext';
import type { DocumentViewTarget } from './types';

const h = vi.hoisted(() => ({ children: vi.fn() }));
vi.mock('@/src/lib/m365/graphClient', () => ({
  listChildren: (...a: unknown[]) => h.children(...a),
  getItem: vi.fn(), listVersions: vi.fn(),
}));
vi.mock('@/src/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    upload: { mutate: vi.fn() }, replace: { mutate: vi.fn() }, progress: {}, uploadErrors: {},
    cancelUpload: vi.fn(), clearUploadError: vi.fn(),
  }),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { document: { getSignedUrl: vi.fn() } } }));
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: () => ({
    list: { data: [], isPending: false, isError: false }, upload: { mutate: vi.fn(), isPending: false },
    archive: { mutate: vi.fn(), isPending: false }, download: vi.fn(), progress: null, uploadError: null,
    clearUploadError: vi.fn(),
  }),
}));

import { LinkedDocumentCell } from '@/src/components/m365/LinkedDocumentCell';
import { LinkedFolderFiles } from '@/src/components/m365/LinkedFolderFiles';
import { ProcurementFilesSubsection } from '@/pages/procurement/ProcurementFilesSubsection';
import { useDocumentFiles } from '@/pages/project-detail/tabs/useDocumentFiles';
import { ReceiptPreviewButton } from './targets/ReceiptPreviewButton';

const SP = 'https://tenant.sharepoint.com/sites/x/Plan.pdf';
const file: MicrosoftReference = { drive_id: 'd', item_id: 'i', web_url: SP, name: 'Plan.pdf', item_kind: 'file', linked_by: 'u', linked_at: '2026-10-01T00:00:00Z', last_verified_at: null };
const folder: MicrosoftReference = { ...file, item_id: 'folder-1', name: 'Folder', item_kind: 'folder', web_url: 'https://tenant.sharepoint.com/sites/x/Folder' };
const project: ReferenceOwner = { kind: 'project', id: 'doc-1', status: 'Draft', content_tag_at_issue: null, version_id_at_issue: null, drift_state: null, last_verified_at: null };

const row = { id: 'doc-2', title: 'Survey', status: 'Issued', file_path: 'org/p/doc-2/survey.pdf', source: 'upload' } as unknown as ProjectDocumentRow;
function RegisterRow() {
  const { fileCell } = useDocumentFiles('p1', [row], () => false);
  return <>{fileCell(row)}</>;
}

const where = () => <Where />;
function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

interface Surface { name: string; fileName: string; ui: ReactNode; control: RegExp; preList?: () => void }
const surfaces: Surface[] = [
  { name: 'project register row', fileName: 'Survey', ui: <RegisterRow />, control: /Preview file for Survey/i },
  { name: 'project quick view', fileName: 'Plan.pdf', ui: <LinkedDocumentCell reference={file} owner={project} />, control: /Preview Plan\.pdf/ },
  { name: 'purchase Microsoft reference', fileName: 'Plan.pdf', ui: <LinkedDocumentCell reference={file} owner={{ kind: 'procurement', id: 'pd-1' }} />, control: /Preview Plan\.pdf/ },
  {
    name: 'purchase phase file', fileName: 'scan.png',
    ui: <ProcurementFilesSubsection phase="quotation" parentId="q1" procurementId="pr-1" canWrite={false} uploadedById={null}
      files={[{ id: 'f1', title: null, file_path: 'org/pr-1/quotation/f1/scan.png', archived_at: null }]} />,
    control: /Preview file scan\.png/i,
  },
  { name: 'budget link', fileName: 'Plan.pdf', ui: <LinkedDocumentCell reference={file} owner={{ kind: 'budget', id: 'bl-1' }} />, control: /Preview Plan\.pdf/ },
  {
    name: 'folder child', fileName: 'Spec.pdf',
    ui: <LinkedFolderFiles reference={folder} owner={{ kind: 'procurement', id: 'pd-1' }} />,
    control: /Preview Spec\.pdf/,
    preList: () => h.children.mockResolvedValue({
      value: [{ drive_id: 'd', item_id: 'child-1', name: 'Spec.pdf', item_kind: 'file', modified_at: null, web_url: 'https://tenant.sharepoint.com/sites/x/Folder/Spec.pdf', parent_path: null, content_tag: null, sharepoint_ids: null }],
      next: null,
    }),
  },
  { name: 'expense receipt', fileName: 'taxi.png', ui: <ReceiptPreviewButton id="r1" fileName="taxi.png" filePath="claim/taxi.png" getSignedUrl={vi.fn()} />, control: /Preview receipt/ },
];

beforeEach(() => h.children.mockReset());

describe('document-preview AC-001 every entry point opens the side-panel viewer', () => {
  it.each(surfaces)('$name', async ({ ui, control, fileName, preList }) => {
    preList?.();
    const open = vi.fn<DocumentViewerApi['open']>();
    const winOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={['/projects/p1?filter=open']}>
        <ToastProvider>
          <DocumentViewerContext.Provider value={{ open, close: vi.fn() }}>{ui}{where()}</DocumentViewerContext.Provider>
        </ToastProvider>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: control }));
    expect(open).toHaveBeenCalledTimes(1);
    const target: DocumentViewTarget = open.mock.calls[0][0];
    expect(target.name).toBe(fileName);
    expect(winOpen).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p1?filter=open');
    winOpen.mockRestore();
    anchorClick.mockRestore();
  });
});
