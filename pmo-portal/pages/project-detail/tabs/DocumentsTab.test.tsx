import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { DocumentViewerProvider } from '@/src/components/documents';
import { AppError } from '@/src/lib/appError';

// ── Repository-seam-backed hooks are mocked; the tab is the unit under test. ──
const { listState, childDocs, mutations, fileUploadState, revisionState, repositoryState, profilesState } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  childDocs: {} as Record<string, unknown>,
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    link: { mutateAsync: vi.fn(), isPending: false },
    unlink: { mutateAsync: vi.fn(), isPending: false },
  },
  fileUploadState: {
    upload: { mutate: vi.fn(), isPending: false },
    replace: { mutate: vi.fn(), isPending: false },
    progress: {} as Record<string, number>,
    uploadErrors: {} as Record<string, { message: string }>,
    cancelUpload: vi.fn(),
    clearUploadError: vi.fn(),
  },
  revisionState: {
    createRevision: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  },
  repositoryState: {
    document: { getSignedUrl: vi.fn() },
  },
  profilesState: {
    data: [
      { id: 'pm-1', full_name: 'Morgan PM' },
      { id: 'pm-2', full_name: 'Casey PM' },
      { id: 'admin-1', full_name: 'Avery Admin' },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => listState,
  useDocumentMutations: () => mutations,
  useChildDocument: (parentId: string | null) => ({
    data: parentId ? childDocs[parentId] ?? null : null,
    isPending: false,
  }),
}));

vi.mock('@/src/hooks/useFileUpload', () => ({
  useFileUpload: () => fileUploadState,
}));

vi.mock('@/src/hooks/useRevision', () => ({
  useRevision: () => revisionState,
}));
vi.mock('@/src/hooks/useTasks', () => ({
  useAssignableProfiles: () => profilesState,
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: repositoryState,
}));
vi.mock('@/src/components/m365/DocumentLinkPermissions', () => ({
  useDocumentLinkPermissions: () => ({
    projectCreate: () => realRole !== 'Engineer',
    projectEdit: () => realRole !== 'Engineer',
  }),
}));

// usePermission reads the REAL JWT role; the SoD also reads the current user id.
let realRole: Role = 'Admin';
let currentUserId = 'admin-1';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' } }),
}));

import DocumentsTab from './DocumentsTab';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
// The register mounts RecordFolderAction, which reads the query cache (#1020).
const testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const RouteSearch = () => <output data-testid="route-search">{useLocation().search}</output>;
const RouteBack = () => {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Navigate back</button>;
};

// d1 Draft (authored by pm-1), d2 Issued (authored by pm-1, awaiting approval),
// d3 Approved (authored by admin-1), d4 Rejected (authored by pm-1).
const seed = [
  { id: 'd1', project_id: 'p1', code: 'DOC-001', category: 'Drawing', title: 'Site Plan', revision: 'A', status: 'Draft', author_id: 'pm-1', doc_date: '2026-06-01', org_id: 'org-1', file_path: null, parent_document_id: null, created_at: '2026-06-01T00:00:00Z' },
  { id: 'd2', project_id: 'p1', code: 'DOC-002', category: 'Specification', title: 'Steel Spec', revision: 'B', status: 'Issued', author_id: 'pm-1', doc_date: '2026-06-02', org_id: 'org-1', file_path: 'org-1/p1/d2/steel-spec-rev-b.pdf', parent_document_id: null, created_at: '2026-06-02T00:00:00Z' },
  { id: 'd3', project_id: 'p1', code: 'DOC-003', category: 'Report', title: 'Survey Report', revision: 'A', status: 'Approved', author_id: 'admin-1', doc_date: null, org_id: 'org-1', file_path: 'org-1/p1/d3/survey-report-rev-a.pdf', parent_document_id: null, created_at: '2026-06-03T00:00:00Z' },
  { id: 'd4', project_id: 'p1', code: null, category: 'Transmittal', title: 'Cover Note', revision: null, status: 'Rejected', author_id: 'pm-1', doc_date: null, org_id: 'org-1', file_path: null, parent_document_id: null, created_at: '2026-06-04T00:00:00Z' },
  { id: 'd5', project_id: 'p1', code: 'RPT-003', category: 'Report', title: 'Structural calculation report', revision: 'A', status: 'Superseded', author_id: 'pm-1', doc_date: '2026-04-20', org_id: 'org-1', file_path: 'org-1/p1/d5/structural-calc-rev-a.pdf', parent_document_id: null, created_at: '2026-04-20T00:00:00Z' },
  { id: 'd6', project_id: 'p1', code: 'RPT-003', category: 'Report', title: 'Structural calculation report', revision: 'B', status: 'Issued', author_id: 'pm-2', doc_date: '2026-05-20', org_id: 'org-1', file_path: 'org-1/p1/d6/structural-calc-rev-b.pdf', parent_document_id: 'd5', created_at: '2026-05-20T00:00:00Z' },
];

const linkedFolder = {
  ...seed[0],
  id: 'folder-1',
  title: 'Reference set',
  category: 'Reference',
  code: null,
  revision: null,
  source: 'onedrive',
  ms_drive_id: 'drive-1',
  ms_item_id: 'folder-1',
  ms_web_url: 'https://tenant.sharepoint.com/sites/project/ReferenceSet',
  ms_item_name: 'Reference set',
  ms_item_kind: 'folder',
  ms_linked_by: 'pm-1',
  ms_linked_at: '2026-06-01T00:00:00Z',
};

const linkedApprovedFile = {
  ...seed[2],
  source: 'onedrive',
  file_path: null,
  ms_drive_id: 'drive-1',
  ms_item_id: 'file-1',
  ms_web_url: 'https://tenant.sharepoint.com/sites/project/ApprovedDrawing.pdf',
  ms_item_name: 'ApprovedDrawing.pdf',
  ms_item_kind: 'file',
  ms_linked_by: 'admin-1',
  ms_linked_at: '2026-06-03T00:00:00Z',
  ms_version_id_at_issue: 'version-23',
  ms_content_tag_at_issue: 'etag-23',
  ms_drift_state: 'clean',
  ms_last_verified_at: '2026-06-03T00:00:00Z',
};

const withDocumentCount = (count: number) => [
  ...seed,
  ...Array.from({ length: Math.max(0, count - seed.length) }, (_, index) => ({
    ...seed[0],
    id: `extra-${index + 1}`,
    code: `DOC-EXTRA-${index + 1}`,
    title: `Additional Document ${index + 1}`,
    parent_document_id: null,
  })),
];

const renderTab = (role: Role = 'Admin', uid = 'admin-1', initialEntry = '/', showBack = false, onCountChange?: (count: number | null) => void) => {
  realRole = role;
  currentUserId = uid;
  return render(
    <QueryClientProvider client={testQueryClient}><ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <RouteSearch />
        {showBack && <RouteBack />}
        <DocumentViewerProvider><DocumentsTab projectId="p1" onCountChange={onCountChange} /></DocumentViewerProvider>
      </MemoryRouter>
    </ToastProvider></QueryClientProvider>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  listState.refetch.mockClear();
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  Object.keys(childDocs).forEach((key) => delete childDocs[key]);
  childDocs.d5 = seed[5];
  fileUploadState.upload.mutate.mockReset();
  fileUploadState.replace.mutate.mockReset();
  fileUploadState.cancelUpload.mockReset();
  fileUploadState.clearUploadError.mockReset();
  fileUploadState.progress = {};
  fileUploadState.uploadErrors = {};
  revisionState.createRevision.mutate.mockReset();
  revisionState.createRevision.mutateAsync.mockReset();
  revisionState.createRevision.isPending = false;
  repositoryState.document.getSignedUrl.mockReset();
  repositoryState.document.getSignedUrl.mockResolvedValue('https://signed.example.com/file');
  profilesState.isPending = false;
  profilesState.isError = false;
  profilesState.refetch.mockReset();
  realRole = 'Admin';
  currentUserId = 'admin-1';
});

describe('DocumentsTab — register rows (AC-DOC-001)', () => {
  it('reports the loaded document register count from its existing query', () => {
    const onCountChange = vi.fn();
    renderTab('Admin', 'admin-1', '/', false, onCountChange);
    expect(onCountChange).toHaveBeenCalledWith(seed.length);
  });

  it('AC-DOC-001: renders the seeded document rows with code + title + status', () => {
    renderTab();
    expect(screen.getByText('Site Plan')).toBeInTheDocument();
    expect(screen.getByText('Steel Spec')).toBeInTheDocument();
    expect(screen.getByText(/DOC-001/)).toBeInTheDocument();
    // status pills present
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Issued').length).toBeGreaterThan(0);
  });

  it('SP-6 shows the File column only when the current document view includes a file', async () => {
    renderTab();
    expect(screen.getByRole('columnheader', { name: 'File' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'Drawing');
    expect(screen.queryByRole('columnheader', { name: 'File' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'Specification');
    expect(screen.getByRole('columnheader', { name: 'File' })).toBeInTheDocument();
  });

  it('AC-DOC-001: search filters rows by title/code', async () => {
    listState.data = withDocumentCount(11);
    renderTab();
    await userEvent.type(screen.getByLabelText(/Search documents/i), 'steel');
    expect(screen.queryByText('Site Plan')).not.toBeInTheDocument();
    expect(screen.getByText('Steel Spec')).toBeInTheDocument();
  });

  it('B7: offers search only beyond ten documents and keeps the action banner honest when nothing is missing or expired', () => {
    const view = renderTab();
    expect(screen.queryByLabelText(/Search documents/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/documents need action/i)).not.toBeInTheDocument();
    view.unmount();
    listState.data = withDocumentCount(11);
    renderTab();
    expect(screen.getByLabelText(/Search documents/i)).toBeInTheDocument();
    // SUB-E: the toolbar shows search but no "N documents" count restating the table.
    expect(screen.queryByTestId('documents-count')).toBeNull();
    expect(screen.queryByText(/^\d+ documents?$/)).toBeNull();
  });

  it('C4: an owner whose name is not visible is left blank, never "Name unavailable"', () => {
    listState.data = [{ ...seed[0], author_id: 'someone-hidden' }];
    renderTab();
    expect(screen.queryByText(/Name unavailable/)).not.toBeInTheDocument();
  });

  it('AC-1402: category, status, and source filters narrow the register', async () => {
    renderTab();
    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'Drawing');
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Draft');
    await userEvent.selectOptions(screen.getByLabelText('Filter by source'), 'upload');
    expect(screen.getByText('Site Plan')).toBeInTheDocument();
    expect(screen.queryByText('Steel Spec')).not.toBeInTheDocument();
  });
});

describe('DocumentsTab — register views and selection', () => {
  it('AC-1402: switches to grouped documents and stores the view in URL state', async () => {
    renderTab();
    const grouped = screen.getByRole('button', { name: 'Grouped' });
    await userEvent.click(grouped);

    expect(grouped).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('route-search')).toHaveTextContent('documentsView=grouped');
    expect(screen.getByRole('button', { name: /^Drawing\s*1$/ })).toBeInTheDocument();
    expect(screen.getByText('Site Plan')).toBeInTheDocument();
  });

  it('AC-1402: document drawer uses ?open for deep links and browser back', async () => {
    renderTab('Admin', 'admin-1', '/projects/p1?documentsView=grouped', true);
    await userEvent.click(screen.getByRole('button', { name: 'View Site Plan' }));
    expect(screen.getByTestId('route-search')).toHaveTextContent('open=d1');
    expect(screen.getByRole('complementary', { name: 'Site Plan' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Navigate back' }));
    await waitFor(() => expect(screen.getByTestId('route-search')).not.toHaveTextContent('open='));
    expect(screen.queryByRole('complementary', { name: 'Site Plan' })).not.toBeInTheDocument();
  });

  it('AC-1402: a shared ?open document link restores its detail view', () => {
    renderTab('Admin', 'admin-1', '/projects/p1?open=d1');
    expect(screen.getByRole('complementary', { name: 'Site Plan' })).toBeInTheDocument();
  });

  it('C4: the document drawer leaves out empty fields and reads the date as a date, never a raw "—" or ISO string', () => {
    renderTab('Admin', 'admin-1', '/projects/p1?open=d4');
    const drawer = screen.getByRole('complementary', { name: 'Cover Note' });
    expect(within(drawer).queryByText('Code')).toBeNull();
    expect(within(drawer).queryByText('Document date')).toBeNull();
    expect(within(drawer).queryByText('File')).toBeNull();
    expect(within(drawer).queryByText('—')).toBeNull();
  });

  it('C4: a dated document reads its date formatted in the drawer', () => {
    renderTab('Admin', 'admin-1', '/projects/p1?open=d2');
    const drawer = screen.getByRole('complementary', { name: 'Steel Spec' });
    expect(within(drawer).getByText('Document date')).toBeInTheDocument();
    expect(within(drawer).queryByText('2026-06-02')).toBeNull();
  });

  it('AC-1402: selecting rows reveals bulk actions and limits actions to selected documents', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Steel Spec' }));

    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export register' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Change status' })).toBeEnabled();
  });

  it('AC-1402: offers only status changes allowed for every selected document', async () => {
    listState.data = [seed[0], { ...seed[0], id: 'd7', code: 'DOC-007', title: 'Field Notes' }];
    renderTab('Admin', 'admin-1');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Site Plan' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Field Notes' }));

    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    const statusSelect = screen.getByLabelText('Change status');
    expect(within(statusSelect).getByRole('option', { name: 'Issue' })).toBeInTheDocument();
    expect(within(statusSelect).queryByRole('option', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('AC-1402: confirms and applies a bulk status transition to selected documents', async () => {
    renderTab('Admin', 'admin-1');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Site Plan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    await userEvent.selectOptions(screen.getByLabelText('Change status'), 'Issued');
    await userEvent.click(screen.getByRole('button', { name: 'Review change' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm status change' }));

    await waitFor(() => expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'd1', status: 'Issued' }));
  });

  it('AC-1402: bulk Download and Export register use only the selected document', async () => {
    const originalCreateUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevokeUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const createUrl = vi.fn(() => 'blob:documents-export');
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      renderTab('Admin', 'admin-1');
      await userEvent.click(screen.getByRole('checkbox', { name: 'Select Steel Spec' }));
      await userEvent.click(screen.getByRole('button', { name: 'Download' }));
      await waitFor(() => expect(repositoryState.document.getSignedUrl).toHaveBeenCalledWith(
        'org-1/p1/d2/steel-spec-rev-b.pdf',
        { download: true },
      ));
      await userEvent.click(screen.getByRole('button', { name: 'Export register' }));

      expect(createUrl).toHaveBeenCalledOnce();
      expect(revokeUrl).toHaveBeenCalledWith('blob:documents-export');
      expect(anchorClick).toHaveBeenCalled();
    } finally {
      if (originalCreateUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', originalCreateUrlDescriptor);
      else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      if (originalRevokeUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeUrlDescriptor);
      else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
      anchorClick.mockRestore();
    }
  });
});

describe('DocumentsTab — states', () => {
  it('AC-DOC-001: loading skeleton while pending', () => {
    listState.isPending = true;
    renderTab();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('AC-DOC-001: error state with retry', async () => {
    listState.isError = true;
    renderTab();
    const retry = screen.getByRole('button', { name: /Retry/i });
    await userEvent.click(retry);
    expect(listState.refetch).toHaveBeenCalled();
  });

  it('AC-DOC-001 (SUB-E): empty state shows the header Add document action once, not a second one', () => {
    listState.data = [];
    renderTab('Admin');
    expect(screen.getByText(/No documents yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Add document/i })).toHaveLength(1);
  });
});

describe('DocumentsTab — file upload integration copy (AC-DOC-085)', () => {
  it('AC-DOC-085 (SUB-E): the restating subtitle is gone and fake attach buttons stay absent', () => {
    renderTab('Admin');
    expect(screen.queryByRole('button', { name: /Attach file/i })).toBeNull();
    expect(screen.queryByText(/Drawings, specifications, and transmittals for this project/i)).toBeNull();
  });
});

describe('DocumentsTab — RBAC affordance gating (AC-DOC-007)', () => {
  it('AC-DOC-007: Admin sees Add document + row Edit + Delete', async () => {
    renderTab('Admin');
    expect(screen.getByRole('button', { name: /Add document/i })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByText('Site Plan').closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument();
  });

  it('AC-DOC-007: a PM who AUTHORED the doc sees Add document + Edit but NOT Delete (Admin-only)', async () => {
    // A-7 author rule (rbac-visibility §H): Edit is author-scoped. "Site Plan" is authored by
    // pm-1, so the PM editing it must BE pm-1 — a different PM (pm-2) would NOT see Edit.
    renderTab('Project Manager', 'pm-1');
    expect(screen.getByRole('button', { name: /Add document/i })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByText('Site Plan').closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument();
  });

  it('AC-DOC-007: Finance can create and review documents but cannot delete them', async () => {
    renderTab('Finance', 'finance-1');
    expect(screen.getByRole('button', { name: /Add document/i })).toBeInTheDocument();
    await userEvent.click(within(screen.getByText('Steel Spec').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: /Approve/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Delete$/i })).not.toBeInTheDocument();
  });

  it('AC-DOC-007 / A-7: a NON-author PM does NOT see Edit on someone else’s document', async () => {
    // pm-2 opens "Site Plan" (authored by pm-1) → no Edit (author rule). The row may still hold
    // status actions, but the metadata Edit is hidden for a non-author.
    renderTab('Project Manager', 'pm-2');
    await userEvent.click(
      within(screen.getByText('Site Plan').closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    expect(screen.queryByRole('menuitem', { name: /^Edit$/i })).not.toBeInTheDocument();
  });

  it('AC-DOC-007: Engineer is read-only — no Add, edit, delete, or money columns', async () => {
    renderTab('Engineer', 'eng-1');
    expect(screen.queryByRole('button', { name: /Add document/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Row actions/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('columnheader', { name: /Budget|Cost|Value/i })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByText('Site Plan').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    expect(screen.queryByRole('menuitem', { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Delete$/i })).not.toBeInTheDocument();
  });
});

describe('DocumentsTab — create / edit metadata form (AC-DOC-003 / AC-DOC-004)', () => {
  it('AC-DOC-003: Add document opens the modal; a blank required title keeps submit disabled (F8 readiness)', async () => {
    renderTab('Admin');
    await userEvent.click(screen.getByRole('button', { name: /Add document/i }));
    const dialog = screen.getByRole('dialog');
    // F8 (AC-IXD-FORM-F8): the blank required title disables submit (category defaults
    // to a value), so the user cannot silently submit a blank document and no create fires.
    const submit = within(dialog).getByRole('button', { name: /^Add document$/i });
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-DOC-003: a valid create submits the metadata fields to the mutation', async () => {
    renderTab('Admin');
    await userEvent.click(screen.getByRole('button', { name: /Add document/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/i), 'Foundation Drawing');
    await userEvent.type(within(dialog).getByLabelText(/^Code/i), 'DOC-010');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Category/i), 'Drawing');
    await userEvent.type(within(dialog).getByLabelText(/Revision/i), 'A');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Add document$/i }));
    await waitFor(() =>
      expect(mutations.create.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Foundation Drawing', code: 'DOC-010', category: 'Drawing', revision: 'A' }),
      ),
    );
  });

  it('AC-DOC-003: a create rejected by RLS (42501) surfaces a classified warning toast', async () => {
    mutations.create.mutateAsync.mockRejectedValue(new AppError('not permitted', '42501'));
    renderTab('Admin');
    await userEvent.click(screen.getByRole('button', { name: /Add document/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/i), 'Blocked Doc');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Category/i), 'Drawing');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Add document$/i }));
    const toast = await findToastAnnouncement('alert', /don't have permission/i);
    expect(toast).toHaveTextContent(/don't have permission/i);
  });

  it('AC-DOC-004: Edit pre-fills the row and submits an update', async () => {
    renderTab('Admin');
    await userEvent.click(
      within(screen.getByText('Site Plan').closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    const titleInput = screen.getByLabelText(/Title/i) as HTMLInputElement;
    expect(titleInput.value).toBe('Site Plan');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Site Plan v2');
    await userEvent.click(screen.getByRole('button', { name: /^Save document$/i }));
    await waitFor(() =>
      expect(mutations.update.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1', input: expect.objectContaining({ title: 'Site Plan v2' }) }),
      ),
    );
  });
});

describe('DocumentsTab — status workflow (AC-DOC-005)', () => {
  it('AC-DOC-005: a Draft document shows an Issue action that transitions to Issued via a confirm', async () => {
    renderTab('Admin');
    const row = screen.getByText('Site Plan').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Issue/i }));
    // confirm dialog, mutation not yet called
    expect(mutations.transition.mutateAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Issue document/i }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'd1', status: 'Issued' }),
    );
  });

  it('AC-DOC-005: an Issued document offers Approve + Reject when the viewer is NOT the author (SoD ok)', async () => {
    // d2 authored by pm-1; current admin user (admin-1) is NOT the author → may approve/reject.
    renderTab('Admin', 'admin-1');
    const row = screen.getByText('Steel Spec').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: /Approve/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Reject/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /Approve/i }));
    await userEvent.click(screen.getByRole('button', { name: /Approve document/i }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'd2', status: 'Approved' }),
    );
  });

  it('AC-DOC-005: the AUTHOR of an Issued document cannot Approve/Reject it (approver ≠ author SoD) — a GateNotice explains', async () => {
    // current user is pm-1, who authored d2 (Issued). Approve/Reject must be HIDDEN.
    renderTab('Project Manager', 'pm-1');
    const row = screen.getByText('Steel Spec').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /Row actions/i }));
    expect(screen.queryByRole('menuitem', { name: /Approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Reject/i })).not.toBeInTheDocument();
    // The SoD reason is surfaced on demand (not a silent omission) via a menu item that opens
    // a GateNotice explaining approver ≠ author.
    await userEvent.click(screen.getByRole('menuitem', { name: /Why is review unavailable/i }));
    const gate = screen.getByTestId('document-sod-gate');
    expect(gate).toHaveTextContent(/can't approve your own document/i);
  });

  it('AC-DOC-005: an Approved document offers Close (terminal) via a confirm', async () => {
    renderTab('Admin', 'admin-1');
    const row = screen.getByText('Survey Report').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Close/i }));
    await userEvent.click(screen.getByRole('button', { name: /Close document/i }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'd3', status: 'Closed' }),
    );
  });
});

describe('DocumentsTab — delete (AC-DOC-006)', () => {
  it('AC-DOC-006: Delete routes through a destructive confirm and calls the mutation (Admin)', async () => {
    renderTab('Admin');
    await userEvent.click(
      within(screen.getByText('Site Plan').closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete document/i }));
    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('d1'));
  });
});

describe('DocumentsTab — file upload integration (AC-DOC-050 / AC-DOC-080 / AC-DOC-081 / AC-DOC-082 / AC-DOC-083)', () => {
  it('AC-DOC-080: shows each document source and keeps Draft upload available in the preview', async () => {
    renderTab('Admin', 'admin-1');
    expect(screen.getByRole('columnheader', { name: 'Source' })).toBeInTheDocument();
    expect(screen.getAllByText('Upload').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'View Site Plan' }));
    const draftPreview = screen.getByRole('complementary');
    expect(within(draftPreview).getByRole('button', { name: /Upload file for Site Plan/i })).toBeInTheDocument();
  });

  it('keeps Microsoft 365 linking and document creation available from the register toolbar', () => {
    renderTab('Admin', 'admin-1');
    const linkAction = screen.getByRole('button', { name: /Link from Microsoft 365/i });
    expect(linkAction).toBeEnabled();
    expect(screen.getByRole('button', { name: /Add document/i })).toBeEnabled();

    const filter = screen.getByRole('combobox', { name: 'Filter by category' });
    const toolbar = filter.parentElement?.parentElement;
    expect(toolbar?.className).toContain('mb-[var(--space-group)]');
    expect(toolbar?.className).not.toContain('mb-3.5');
  });

  it('AC-DOC-M365: linked folder contents remain expandable and the footer opens SharePoint', async () => {
    listState.data = [linkedFolder];
    renderTab('Admin', 'admin-1');
    await userEvent.click(screen.getByRole('button', { name: 'View Reference set' }));
    const preview = screen.getByRole('complementary');
    expect(within(preview).getByRole('button', { name: 'Show files' })).toBeInTheDocument();
    expect(within(preview).getByRole('link', { name: 'Open in SharePoint' })).toHaveAttribute(
      'href',
      linkedFolder.ms_web_url,
    );
  });

  it('AC-DOC-M365: issued SharePoint documents retain their pinned version and approved history action', async () => {
    listState.data = [linkedApprovedFile];
    renderTab('Admin', 'admin-1');
    await userEvent.click(screen.getByRole('button', { name: 'View Survey Report' }));
    const preview = screen.getByRole('complementary');
    expect(within(preview).getByText('Approved version version-23')).toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: /View approved version history/i })).toBeInTheDocument();
  });

  it('AC-DOC-M365: Draft SharePoint references keep the unlink confirmation', async () => {
    listState.data = [{ ...linkedFolder, ms_item_kind: 'file', status: 'Draft' }];
    renderTab('Admin', 'admin-1');
    const row = screen.getByText('Reference set').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Unlink Microsoft item/i }));
    expect(screen.getByText(/Only the PMO reference is removed/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(mutations.unlink.mutateAsync).toHaveBeenCalledWith('folder-1'));
  });

  it('AC-DOC-081 / AC-DOC-082: renders the Superseded pill, lineage links, and continue-on microcopy', () => {
    renderTab('Admin', 'admin-1');
    expect(screen.getAllByText('Superseded').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /View revision A of Structural calculation report/i })).toHaveTextContent('← Rev A');
    expect(screen.getByRole('button', { name: /View revision B of Structural calculation report/i })).toHaveTextContent('→ Rev B');
    expect(screen.getByText(/continue on Rev B/i)).toBeInTheDocument();
  });

  it('shows every successor and its status in the table and drawer', async () => {
    listState.data = [...seed, { ...seed[5], id: 'd7', revision: 'C', status: 'Draft' }];
    renderTab('Admin', 'admin-1');
    const row = screen.getAllByText('Structural calculation report')[0].closest('tr')!;
    expect(within(row).getByRole('button', { name: /View revision B of Structural calculation report/i })).toHaveTextContent('Issued');
    expect(within(row).getByRole('button', { name: /View revision C of Structural calculation report/i })).toHaveTextContent('Draft');
    await userEvent.click(within(row).getByRole('button', { name: 'View Structural calculation report' }));
    const drawer = screen.getByRole('complementary');
    expect(within(drawer).getByRole('button', { name: /View revision B of Structural calculation report/i })).toHaveTextContent('Issued');
    await userEvent.click(within(drawer).getByRole('button', { name: /View revision C of Structural calculation report/i }));
    expect(within(screen.getByRole('complementary')).getByText('Rev C')).toBeInTheDocument();
  });

  it('AC-DOC-082 M1: clicking a lineage link navigates to the linked row by opening that document in the drawer', async () => {
    renderTab('Admin', 'admin-1');
    await userEvent.click(screen.getByRole('button', { name: /View revision B of Structural calculation report/i }));
    const preview = screen.getByRole('complementary');
    expect(within(preview).getAllByText('Issued').length).toBeGreaterThan(0);
    expect(document.getElementById(preview.getAttribute('aria-labelledby')!)?.textContent).toContain('Structural calculation report');
    expect(within(preview).getByText('Rev B')).toBeInTheDocument();
  });

  it('AC-DOC-050 (SUB-E): New revision is a row-menu item on Issued/Approved rows only — never a column of buttons', async () => {
    renderTab('Admin', 'admin-1');
    expect(screen.queryByRole('button', { name: /Create new revision/i })).toBeNull();
    const menuOf = async (title: string, index = 0) => {
      await userEvent.click(within(screen.getAllByText(title)[index].closest('tr')!).getByRole('button', { name: /Row actions/i }));
    };
    await menuOf('Steel Spec');
    expect(screen.getByRole('menuitem', { name: 'New revision' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await menuOf('Survey Report');
    expect(screen.getByRole('menuitem', { name: 'New revision' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await menuOf('Site Plan');
    expect(screen.queryByRole('menuitem', { name: 'New revision' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await menuOf('Cover Note');
    expect(screen.queryByRole('menuitem', { name: 'New revision' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await menuOf('Structural calculation report');
    expect(screen.queryByRole('menuitem', { name: 'New revision' })).not.toBeInTheDocument();
  });

  it('AC-DOC-050 C1: New revision persists edited modal fields instead of silently copying the parent', async () => {
    renderTab('Admin', 'admin-1');
    await userEvent.click(
      within(screen.getByText('Survey Report').closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'New revision' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /New revision/i })).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText(/Title/i));
    await userEvent.type(within(dialog).getByLabelText(/Title/i), 'Survey Report Rev B');
    await userEvent.clear(within(dialog).getByLabelText(/^Code/i));
    await userEvent.type(within(dialog).getByLabelText(/^Code/i), 'DOC-003B');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Category/i), 'Specification');
    await userEvent.type(within(dialog).getByLabelText(/Document date/i), '2026-06-12');
    await userEvent.click(within(dialog).getByRole('button', { name: /Create revision/i }));
    expect(revisionState.createRevision.mutate).toHaveBeenCalledWith(
      {
        parentId: 'd3',
        title: 'Survey Report Rev B',
        code: 'DOC-003B',
        category: 'Specification',
        revision: 'B',
        doc_date: '2026-06-12',
      },
      expect.any(Object),
    );
  });

  it('offers draft attachment actions to the author and Admin', async () => {
    renderTab('Project Manager', 'pm-1');
    await userEvent.click(screen.getByText('Site Plan'));
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: /Upload file for Site Plan/i })).toBeInTheDocument();
  });

  it('does not offer draft upload to another writer', async () => {
    listState.data = [seed[0]];
    renderTab('Finance', 'other');
    await userEvent.click(screen.getByText('Site Plan'));
    expect(within(screen.getByRole('complementary')).queryByRole('button', { name: /Upload file for Site Plan/i })).not.toBeInTheDocument();
  });

  it('does not offer draft attachment actions to another writer', async () => {
    listState.data = [{ ...seed[0], file_path: 'file.pdf' }];
    renderTab('Finance', 'other');
    await userEvent.click(screen.getByText('Site Plan'));
    expect(within(screen.getByRole('complementary')).queryByRole('button', { name: /Replace file for Site Plan/i })).not.toBeInTheDocument();
  });

  it('C2: a read-only Engineer sees no upload/replace affordance but can still download read-only files', async () => {
    renderTab('Engineer', 'eng-1');
    await userEvent.click(screen.getByRole('button', { name: 'View Site Plan' }));
    expect(screen.queryByRole('button', { name: /Upload file for Site Plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Replace file for/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    await userEvent.click(screen.getByRole('button', { name: 'View Survey Report' }));
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: /Download file for Survey Report/i })).toBeInTheDocument();
  });

  it('AC-DOC-024 AC-DOC-090 AC-DOC-092: a client-side upload error is shown and Remove returns the row to the no-file state', async () => {
    renderTab('Admin', 'admin-1');
    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    await userEvent.click(screen.getByRole('button', { name: 'View Site Plan' }));
    const preview = screen.getByRole('complementary');
    await userEvent.click(within(preview).getByRole('button', { name: /Upload file for Site Plan/i }));
    const oversize = new File(['x'], 'too-big.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversize, 'size', { value: 6 * 1024 * 1024 });
    await userEvent.upload(fileInput, oversize);
    expect(within(preview).getByText('File exceeds 5 MB limit')).toHaveTextContent('File exceeds 5 MB limit');
    await userEvent.click(within(preview).getByRole('button', { name: /Remove failed upload for Site Plan/i }));
    expect(screen.queryByText('File exceeds 5 MB limit')).not.toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: /Upload file for Site Plan/i })).toBeInTheDocument();
  });

  it('AC-DOC-020: selecting a valid file from Upload dispatches the upload mutation', async () => {
    renderTab('Admin', 'admin-1');
    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['x'], 'drawing.pdf', { type: 'application/pdf' });

    await userEvent.click(screen.getByRole('button', { name: 'View Site Plan' }));
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /Upload file for Site Plan/i }));
    await userEvent.upload(fileInput, file);
    expect(fileUploadState.upload.mutate).toHaveBeenCalledWith({ docId: 'd1', file });
  });

  it('AC-DOC-021: selecting a valid file from Replace dispatches the replace mutation', async () => {
    listState.data = seed.map((doc) => doc.id === 'd1' ? { ...doc, file_path: 'org-1/p1/d1/site-plan.pdf' } : doc);
    renderTab('Admin', 'admin-1');
    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['x'], 'drawing.pdf', { type: 'application/pdf' });

    await userEvent.click(screen.getByRole('button', { name: 'View Site Plan' }));
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /Replace file for Site Plan/i }));
    await userEvent.upload(fileInput, file);
    expect(fileUploadState.replace.mutate).toHaveBeenCalledWith({ docId: 'd1', file });
  });

  it('AC-DOC-040: download affordances generate a signed URL in the preview', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderTab('Admin', 'admin-1');

    await userEvent.click(screen.getByRole('button', { name: 'View Survey Report' }));
    const preview = screen.getByRole('complementary');
    await userEvent.click(within(preview).getByRole('button', { name: /Download file for Survey Report/i }));
    // Download forces attachment so all file types download rather than open inline.
    expect(repositoryState.document.getSignedUrl).toHaveBeenCalledWith('org-1/p1/d3/survey-report-rev-a.pdf', { download: true });
    expect(anchorClick).toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole('button', { name: /View Structural calculation report/i })[0]);
    const drawer = screen.getByRole('complementary');
    await userEvent.click(within(drawer).getByRole('button', { name: /Download file for Structural calculation report/i }));
    expect(repositoryState.document.getSignedUrl).toHaveBeenCalledWith('org-1/p1/d5/structural-calc-rev-a.pdf', { download: true });
  });

  it('AC-DOC-041: preview affordances open the side-panel viewer with a fresh signed URL (document-preview AC-001)', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderTab('Admin', 'admin-1');
    await userEvent.click(screen.getByRole('button', { name: 'View Survey Report' }));
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /Preview file for Survey Report/i }));
    expect(await screen.findByRole('dialog', { name: 'Survey Report' })).toBeInTheDocument();
    expect(repositoryState.document.getSignedUrl).toHaveBeenCalledWith('org-1/p1/d3/survey-report-rev-a.pdf', undefined);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('AC-DOC-083: preview file actions are available after opening a document', async () => {
    renderTab('Admin', 'admin-1');
    await userEvent.click(screen.getByRole('button', { name: 'View Site Plan' }));
    const upload = within(screen.getByRole('complementary')).getByRole('button', { name: /Upload file for Site Plan/i });
    expect(upload).toBeEnabled();
    // AC-DOC-083: file actions keep the touch-target hook (WCAG 2.5.8 minimum target) on phone.
    expect(upload.className).toContain('touch-target');
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    await userEvent.click(screen.getByRole('button', { name: 'View Survey Report' }));
    const download = within(screen.getByRole('complementary')).getByRole('button', { name: /Download file for Survey Report/i });
    expect(download).toBeEnabled();
    expect(download.className).toContain('touch-target');
  });
});

describe('DocumentsTab — document preview (AC-W5-C6-D12)', () => {
  const openPreview = async (title: string, index = 0) => {
    await userEvent.click(screen.getAllByRole('button', { name: `View ${title}` })[index]);
    return screen.getByRole('complementary');
  };

  it('AC-W5-C6-D12: activating a row opens a read-first preview titled with the document', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openPreview('Site Plan');
    const labelId = drawer.getAttribute('aria-labelledby');
    expect(document.getElementById(labelId!)?.textContent).toContain('Site Plan');
    // Read-first body: code (mono), category, status pill.
    expect(within(drawer).getByText('DOC-001')).toBeInTheDocument();
    expect(within(drawer).getByText('Drawing')).toBeInTheDocument();
  });

  it('AC-DOC-082 / AC-DOC-080: drawer shows superseding lineage and file information for superseded rows', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openPreview('Structural calculation report', 0);
    expect(within(drawer).getByText(/Superseded by/i)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /View revision B of Structural calculation report/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /Download file for Structural calculation report/i })).toBeInTheDocument();
  });

  it('AC-W5-C6-D12: a Draft document shows an Issue status button in the drawer (workflow promoted out of ⋯)', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openPreview('Site Plan');
    expect(within(drawer).getByRole('button', { name: /^Issue$/i })).toBeInTheDocument();
  });

  it('AC-W5-C6-D12: a reviewer (non-author) sees Approve + Reject on an Issued doc; Approve routes through the confirm', async () => {
    // d2 (Steel Spec) is Issued, authored by pm-1; the current user is admin-1 (≠ author).
    renderTab('Admin', 'admin-1');
    const drawer = await openPreview('Steel Spec');
    expect(within(drawer).getByRole('heading', { name: 'Steel Spec', level: 3 })).toBeInTheDocument();
    expect(within(drawer).getByRole('heading', { name: 'Update status', level: 4 })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /^Reject$/i })).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: /^Approve$/i }));
    // Consequential move keeps its ConfirmDialog (OD-UX-1).
    await userEvent.click(screen.getByRole('button', { name: /Approve document/i }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'd2', status: 'Approved' }),
    );
  });

  it('AC-W5-C6-D12: SoD — the author of their own Issued doc sees the inline reason, not Approve/Reject', async () => {
    // d2 (Steel Spec) is Issued, authored by pm-1; render as pm-1 (the author).
    renderTab('Project Manager', 'pm-1');
    const drawer = await openPreview('Steel Spec');
    expect(within(drawer).queryByRole('button', { name: /^Approve$/i })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /^Reject$/i })).not.toBeInTheDocument();
    const gate = within(drawer).getByTestId('drawer-sod-gate');
    expect(gate).toHaveTextContent(/can't approve your own document/i);
    expect(gate).toHaveTextContent(/segregation-of-duties/i);
  });

  it('AC-W5-C6-D12: footer Edit closes the preview then opens the edit form pre-filled', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openPreview('Site Plan');
    await userEvent.click(within(drawer).getByRole('button', { name: /^Edit$/i }));
    const titleInput = (await screen.findByLabelText(/^Title/i)) as HTMLInputElement;
    expect(titleInput.value).toBe('Site Plan');
  });

  it('AC-DOC-082: drawer lineage links navigate between parent and child revisions', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openPreview('Structural calculation report', 1);
    await userEvent.click(within(drawer).getByRole('button', { name: /View revision A of Structural calculation report/i }));
    const linkedDrawer = screen.getByRole('complementary');
    expect(document.getElementById(linkedDrawer.getAttribute('aria-labelledby')!)?.textContent).toContain('Structural calculation report');
    expect(within(linkedDrawer).getByText('Superseded by')).toBeInTheDocument();
  });

  it('AC-W5-C6-D12: footer Delete (Admin) closes the preview then opens the destructive confirm', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openPreview('Site Plan');
    await userEvent.click(within(drawer).getByRole('button', { name: /^Delete$/i }));
    expect(await screen.findByText(/Delete Site Plan\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Delete document/i }));
    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('d1'));
  });

  it('I7: cancelling the destructive delete confirm closes it without deleting', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openPreview('Site Plan');
    await userEvent.click(within(drawer).getByRole('button', { name: /^Delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByText(/Delete Site Plan\?/i)).not.toBeInTheDocument();
    expect(mutations.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-1402: the primary status action sits in the preview header beside current status', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openPreview('Site Plan');
    expect(within(drawer).getByRole('button', { name: 'Issue' })).toBeInTheDocument();
    expect(within(drawer).getByText('Draft')).toBeInTheDocument();
    expect(within(drawer).queryByRole('heading', { name: /^status$/i })).not.toBeInTheDocument();
  });

  it('AC-1402: phone opens the shared Drawer with the full page header link', async () => {
    const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
        media: '(min-width: 768px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList),
    });
    try {
      renderTab('Admin', 'admin-1');
      await userEvent.click(screen.getByRole('button', { name: 'View Site Plan' }));
      const drawer = screen.getByRole('dialog', { name: 'Site Plan' });
      expect(within(drawer).getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/projects/p1/documents');
      expect(within(drawer).getByRole('button', { name: /Upload file for Site Plan/i })).toBeInTheDocument();
    } finally {
      if (originalMatchMediaDescriptor) Object.defineProperty(window, 'matchMedia', originalMatchMediaDescriptor);
      else delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    }
  });

  it('AC-1402: phone document status follows the drawer title in the heading hierarchy', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
      matches: false, media: '(min-width: 768px)', addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as MediaQueryList) });
    try {
      renderTab('Admin', 'admin-1');
      await userEvent.click(screen.getByRole('button', { name: 'View Steel Spec' }));
      const drawer = screen.getByRole('dialog', { name: 'Steel Spec' });
      expect(within(drawer).getByRole('heading', { name: 'Steel Spec', level: 1 })).toBeInTheDocument();
      expect(within(drawer).getByRole('heading', { name: 'Update status', level: 2 })).toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    }
  });
});
