// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { AuthContext, type AuthContextValue, type Profile, type Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui/Toast';
import i18n from '@/src/lib/i18n';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';

const state = vi.hoisted(() => ({
  featureM365: true,
  destination: { kind: 'microsoft' as 'microsoft' | 'private' | 'unknown' },
  viewerOpen: vi.fn(),
  createDoc: vi.fn(),
  ensureFolder: vi.fn(),
  uploadRecordFile: vi.fn(),
  attachMicrosoftUpload: vi.fn(),
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
  cleanupObject: vi.fn(),
  listChildren: vi.fn(),
  categories: [{ id: 'cat-1', name: 'Drawing', is_system: true, sort_order: 10, roles: ['Admin', 'Engineer', 'Project Manager'], hidden_job_roles: [] }],
}));

vi.mock('@/src/auth/useFeature', () => ({ useFeature: (k: string) => k === 'm365_integration' ? state.featureM365 : true }));
vi.mock('@/src/hooks/useUploadDestination', async (orig) => ({
  ...(await orig<typeof import('@/src/hooks/useUploadDestination')>()),
  useUploadDestination: () => state.destination,
}));
vi.mock('@/src/components/documents/viewerContext', () => ({ useViewerOnDemand: () => ({ open: state.viewerOpen }) }));
vi.mock('@/src/hooks/useDocumentCategories', () => ({ useViewableCategories: () => state.categories }));
vi.mock('@/src/lib/m365/uploadClient', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/m365/uploadClient')>()),
  uploadRecordFile: (...args: unknown[]) => state.uploadRecordFile(...args),
}));
vi.mock('@/src/lib/m365/graphClient', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/m365/graphClient')>()),
  listChildren: (...args: unknown[]) => state.listChildren(...args),
}));
vi.mock('@/src/lib/uploadTransport', () => ({
  uploadWithProgress: vi.fn().mockResolvedValue(undefined),
  classifyUploadError: () => ({ type: 'server', message: 'Upload failed — try again' }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    document: {
      create: (...a: unknown[]) => state.createDoc(...a),
      prepareUpload: (...a: unknown[]) => state.prepareUpload(...a),
      confirmUpload: (...a: unknown[]) => state.confirmUpload(...a),
      cleanupObject: (...a: unknown[]) => state.cleanupObject(...a),
      attachMicrosoftUpload: (...a: unknown[]) => state.attachMicrosoftUpload(...a),
      getSignedUrl: vi.fn().mockResolvedValue('https://example.invalid/signed'),
    },
    m365RecordFolders: {
      ensure: (...a: unknown[]) => state.ensureFolder(...a),
    },
  },
}));

import { DocumentsSection } from './DocumentsSection';

const WO_ID = '11111111-1111-4111-8111-111111111111';
const PROJ_ID = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '33333333-3333-4333-8333-333333333333';

const baseDoc = (over: Partial<ProjectDocumentRow> = {}): ProjectDocumentRow => ({
  id: DOC_ID,
  org_id: 'org-1',
  project_id: PROJ_ID,
  work_order_id: WO_ID,
  author_id: 'user-pa',
  category: 'Drawing',
  category_id: 'cat-1',
  code: null,
  created_at: '2026-11-01T00:00:00Z',
  doc_date: null,
  file_path: null,
  ms_check_claim: null,
  ms_check_claimed_at: null,
  ms_content_tag_at_issue: null,
  ms_drift_state: null,
  ms_drive_id: null,
  ms_item_id: null,
  ms_item_kind: null,
  ms_item_name: null,
  ms_last_verified_at: null,
  ms_linked_at: null,
  ms_linked_by: null,
  ms_version_id_at_issue: null,
  ms_web_url: null,
  parent_document_id: null,
  revision: null,
  source: null,
  status: 'Draft',
  title: 'WO Site Sketch',
  ...over,
});

function makeAuthValue(user: Profile, role: Role): AuthContextValue {
  return {
    session: null,
    currentUser: user,
    role,
    loading: false,
    profileError: null,
    profileErrorKind: null,
    signInWithPassword: async () => ({ error: null }),
    signInWithMagicLink: async () => ({ error: null }),
    signInWithMicrosoft: async () => ({ error: null }),
    requestPasswordReset: async () => ({ error: null }),
    updatePassword: async () => ({ error: null }),
    resendEmailConfirmation: async () => ({ error: null }),
    signOut: async () => undefined,
    refreshCurrentUser: async () => ({ error: null }),
  };
}

function renderSection(opts: {
  role?: Role;
  builtInRole?: string | null;
  userId?: string;
  documents?: ProjectDocumentRow[];
  folderDoc?: ProjectDocumentRow | null;
} = {}) {
  const {
    role = 'Engineer',
    builtInRole = 'project_administrator',
    userId = 'user-pa',
    documents = [],
    folderDoc = null,
  } = opts;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = {
    id: userId,
    org_id: 'org-1',
    role,
    built_in_role: builtInRole,
    full_name: 'Actor',
    email: 'actor@example.test',
    status: 'active',
  } as unknown as Profile;
  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={makeAuthValue(user, role)}>
        <ImpersonationProvider realRole={role} demoEligibility="ineligible">
          <ToastProvider>
            <MemoryRouter>
              <DocumentsSection
                workOrderId={WO_ID}
                projectId={PROJ_ID}
                documents={documents}
                folderDoc={folderDoc}
                isPending={false}
                isError={false}
                onRetry={vi.fn()}
              />
            </MemoryRouter>
          </ToastProvider>
        </ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
  state.featureM365 = true;
  state.destination = { kind: 'microsoft' };
  state.createDoc.mockResolvedValue(baseDoc());
  state.ensureFolder.mockResolvedValue({ state: 'created', document_id: 'wo-folder-doc' });
  state.uploadRecordFile.mockResolvedValue({
    drive_id: 'drv-1',
    item_id: 'ms-file-1',
    web_url: 'https://contoso.sharepoint.com/sites/a/file.pdf',
    name: 'plan.pdf',
    item_kind: 'file',
  });
  state.attachMicrosoftUpload.mockResolvedValue(undefined);
  state.prepareUpload.mockResolvedValue({ signedUrl: 'https://storage.test/up', path: 'org-1/p/d/plan.pdf', oldPath: null });
  state.confirmUpload.mockResolvedValue(undefined);
  state.listChildren.mockResolvedValue({ items: [], nextLink: null });
});

describe('TC-PA-13 WorkOrder DocumentsSection', () => {
  it('Project Administrator creates a work-order document and first M365 upload ensures the work-order folder', async () => {
    const { container, rerender } = renderSection({ documents: [] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add document' }));
    await user.type(screen.getByLabelText(/Title/), 'WO Site Sketch');
    await user.click(screen.getByRole('button', { name: 'Add document' }));

    await waitFor(() => expect(state.createDoc).toHaveBeenCalledWith(
      PROJ_ID,
      expect.objectContaining({ title: 'WO Site Sketch' }),
      'user-pa',
      WO_ID,
    ));
    void rerender;

    // Upload on the newly created Draft row without an existing WO folder -> ensures WO folder first, then uploads to custody
    const paUser = { id: 'user-pa', org_id: 'org-1', role: 'Engineer', built_in_role: 'project_administrator', full_name: 'PA', email: 'pa@example.test', status: 'active' } as unknown as Profile;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuthContext.Provider value={makeAuthValue(paUser, 'Engineer')}>
          <ImpersonationProvider realRole="Engineer" demoEligibility="ineligible">
            <ToastProvider><MemoryRouter>
              <DocumentsSection workOrderId={WO_ID} projectId={PROJ_ID} documents={[baseDoc()]} folderDoc={null} isPending={false} isError={false} onRetry={vi.fn()} />
            </MemoryRouter></ToastProvider>
          </ImpersonationProvider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: /Upload/i }));
    const input = document.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'plan.pdf', { type: 'application/pdf' });
    await user.upload(input, file);

    await waitFor(() => expect(state.ensureFolder).toHaveBeenCalledWith({ kind: 'work_order', id: WO_ID }));
    await waitFor(() => expect(state.uploadRecordFile).toHaveBeenCalledWith({ kind: 'project_document', id: DOC_ID }, file, expect.any(AbortSignal)));
    await waitFor(() => expect(state.attachMicrosoftUpload).toHaveBeenCalledWith(DOC_ID, expect.objectContaining({ item_id: 'ms-file-1' })));
    expect(state.prepareUpload).not.toHaveBeenCalled();
    void container;
  });

  it('uses private storage unchanged when M365 default library is disconnected', async () => {
    state.featureM365 = false;
    state.destination = { kind: 'private' };
    renderSection({ documents: [baseDoc()] });
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Create folder in SharePoint' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Upload/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'plan.pdf', { type: 'application/pdf' });
    await user.upload(input, file);
    await waitFor(() => expect(state.prepareUpload).toHaveBeenCalledWith(DOC_ID, 'plan.pdf'));
    await waitFor(() => expect(state.confirmUpload).toHaveBeenCalledWith(DOC_ID, 'org-1/p/d/plan.pdf'));
    expect(state.ensureFolder).not.toHaveBeenCalled();
  });

  it('plain Engineer sees read-only list with no Add, Upload, or Create-folder buttons', () => {
    renderSection({ builtInRole: null, userId: 'user-eng', documents: [baseDoc({ author_id: 'user-eng' })] });
    expect(screen.queryByRole('button', { name: 'Add document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create folder in SharePoint' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull();
  });
});
