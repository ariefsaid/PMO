import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

// ── Repository-seam-backed hooks are mocked; the tab is the unit under test. ──
const { listState, childDocs, mutations, fileUploadState, revisionState, repositoryState } = vi.hoisted(() => ({
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

vi.mock('@/src/lib/repositories', () => ({
  repositories: repositoryState,
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

const renderTab = (role: Role = 'Admin', uid = 'admin-1') => {
  realRole = role;
  currentUserId = uid;
  return render(
    <ToastProvider>
      <MemoryRouter>
        <DocumentsTab projectId="p1" />
      </MemoryRouter>
    </ToastProvider>,
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
  realRole = 'Admin';
  currentUserId = 'admin-1';
});

describe('DocumentsTab — register rows (AC-DOC-001)', () => {
  it('AC-DOC-001: renders the seeded document rows with code + title + status', () => {
    renderTab();
    expect(screen.getByText('Site Plan')).toBeInTheDocument();
    expect(screen.getByText('Steel Spec')).toBeInTheDocument();
    expect(screen.getByText('DOC-001')).toBeInTheDocument();
    // status pills present
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Issued').length).toBeGreaterThan(0);
  });

  it('M-3: gives the desktop Status column a dedicated non-clipping width', () => {
    renderTab();
    const statusHeader = screen.getByRole('columnheader', { name: 'Status' });
    expect(statusHeader.className).toContain('min-w-[112px]');
    expect(statusHeader.className).toContain('w-[112px]');
  });

  it('AC-DOC-001: search filters rows by title/code', async () => {
    renderTab();
    await userEvent.type(screen.getByLabelText(/Search documents/i), 'steel');
    expect(screen.queryByText('Site Plan')).not.toBeInTheDocument();
    expect(screen.getByText('Steel Spec')).toBeInTheDocument();
  });

  // Polish #6 — the toolbar gains a left-aligned "N documents" count (matching the
  // Admin Users toolbar pattern) so the previously-empty left side reads as anchored.
  it('polish#6: the toolbar shows a left-aligned document count (6 documents)', () => {
    renderTab();
    const count = screen.getByTestId('documents-count');
    expect(count).toBeInTheDocument();
    expect(count).toHaveTextContent(/^6 documents$/);
  });

  it('polish#6: the count uses the singular noun for a single document', () => {
    listState.data = [seed[0]];
    renderTab();
    expect(screen.getByTestId('documents-count')).toHaveTextContent(/^1 document$/);
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

  it('AC-DOC-001: empty state teaches with a gated Add document action', () => {
    listState.data = [];
    renderTab('Admin');
    expect(screen.getByText(/No documents yet/i)).toBeInTheDocument();
  });
});

describe('DocumentsTab — file upload integration copy (AC-DOC-085)', () => {
  it('AC-DOC-085: subtitle teaches upload-on-draft behavior and keeps fake attach buttons absent', () => {
    renderTab('Admin');
    expect(screen.queryByRole('button', { name: /Attach file/i })).toBeNull();
    expect(
      screen.getByText(/Drawings, specifications, and transmittals for this project\. Upload files on Draft rows\./i),
    ).toBeInTheDocument();
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

  it('AC-DOC-007 / A-7: a NON-author PM does NOT see Edit on someone else’s document', async () => {
    // pm-2 opens "Site Plan" (authored by pm-1) → no Edit (author rule). The row may still hold
    // status actions, but the metadata Edit is hidden for a non-author.
    renderTab('Project Manager', 'pm-2');
    await userEvent.click(
      within(screen.getByText('Site Plan').closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    expect(screen.queryByRole('menuitem', { name: /^Edit$/i })).not.toBeInTheDocument();
  });

  it('AC-DOC-007: Engineer is read-only — no Add document and no row action menu', () => {
    renderTab('Engineer', 'eng-1');
    expect(screen.queryByRole('button', { name: /Add document/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
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
    const toast = await screen.findByRole('status');
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
  it('AC-DOC-080: renders the File column between Code and Category with upload/download affordances', () => {
    renderTab('Admin', 'admin-1');
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim());
    expect(headers).toContain('File');
    expect(headers.indexOf('Code')).toBeLessThan(headers.indexOf('File'));
    expect(headers.indexOf('File')).toBeLessThan(headers.indexOf('Category'));

    expect(screen.getByRole('button', { name: /Upload file for Site Plan/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download file for Survey Report/i })).toBeInTheDocument();
  });

  it('AC-DOC-081 / AC-DOC-082: renders the Superseded pill, lineage links, and continue-on microcopy', () => {
    renderTab('Admin', 'admin-1');
    expect(screen.getAllByText('Superseded').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /View revision A of Structural calculation report/i })).toHaveTextContent('← Rev A');
    expect(screen.getByRole('button', { name: /View revision B of Structural calculation report/i })).toHaveTextContent('→ Rev B');
    expect(screen.getByText(/continue on Rev B/i)).toBeInTheDocument();
  });

  it('AC-DOC-082 M1: clicking a lineage link navigates to the linked row by opening that document in the drawer', async () => {
    renderTab('Admin', 'admin-1');
    await userEvent.click(screen.getByRole('button', { name: /View revision B of Structural calculation report/i }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getAllByText('Issued').length).toBeGreaterThan(0);
    expect(document.getElementById(drawer.getAttribute('aria-labelledby')!)?.textContent).toContain('Structural calculation report');
    expect(within(drawer).getByText('Rev B')).toBeInTheDocument();
  });

  it('AC-DOC-050: New revision is visible on Issued/Approved rows only', () => {
    renderTab('Admin', 'admin-1');
    expect(within(screen.getByText('Steel Spec').closest('tr')!).getByRole('button', { name: /Create new revision for Steel Spec/i })).toBeInTheDocument();
    expect(within(screen.getByText('Survey Report').closest('tr')!).getByRole('button', { name: /Create new revision for Survey Report/i })).toBeInTheDocument();
    expect(within(screen.getByText('Site Plan').closest('tr')!).queryByRole('button', { name: /Create new revision/i })).not.toBeInTheDocument();
    expect(within(screen.getByText('Cover Note').closest('tr')!).queryByRole('button', { name: /Create new revision/i })).not.toBeInTheDocument();
    expect(within(screen.getAllByText('Structural calculation report')[0].closest('tr')!).queryByRole('button', { name: /Create new revision/i })).not.toBeInTheDocument();
  });

  it('AC-DOC-050 C1: New revision persists edited modal fields instead of silently copying the parent', async () => {
    renderTab('Admin', 'admin-1');
    await userEvent.click(
      within(screen.getByText('Survey Report').closest('tr')!).getByRole('button', { name: /Create new revision for Survey Report/i }),
    );
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

  it('C2: a read-only Engineer sees no upload/replace affordance on Draft rows but can still download read-only files', () => {
    renderTab('Engineer', 'eng-1');
    expect(screen.queryByRole('button', { name: /Upload file for Site Plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Replace file for/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download file for Survey Report/i })).toBeInTheDocument();
  });

  it('AC-DOC-024 AC-DOC-090 AC-DOC-092: a client-side upload error is shown and Remove returns the row to the no-file state', async () => {
    renderTab('Admin', 'admin-1');
    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    await userEvent.click(screen.getByRole('button', { name: /Upload file for Site Plan/i }));
    const oversize = new File(['x'], 'too-big.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversize, 'size', { value: 6 * 1024 * 1024 });
    await userEvent.upload(fileInput, oversize);
    expect(screen.getByRole('alert')).toHaveTextContent('File exceeds 5 MB limit');
    await userEvent.click(screen.getByRole('button', { name: /Remove failed upload for Site Plan/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload file for Site Plan/i })).toBeInTheDocument();
  });

  it('AC-DOC-020: selecting a valid file from Upload dispatches the upload mutation', async () => {
    renderTab('Admin', 'admin-1');
    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['x'], 'drawing.pdf', { type: 'application/pdf' });

    await userEvent.click(screen.getByRole('button', { name: /Upload file for Site Plan/i }));
    await userEvent.upload(fileInput, file);
    expect(fileUploadState.upload.mutate).toHaveBeenCalledWith({ docId: 'd1', file });
  });

  it('AC-DOC-021: selecting a valid file from Replace dispatches the replace mutation', async () => {
    listState.data = seed.map((doc) => doc.id === 'd1' ? { ...doc, file_path: 'org-1/p1/d1/site-plan.pdf' } : doc);
    renderTab('Admin', 'admin-1');
    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['x'], 'drawing.pdf', { type: 'application/pdf' });

    await userEvent.click(screen.getByRole('button', { name: /Replace file for Site Plan/i }));
    await userEvent.upload(fileInput, file);
    expect(fileUploadState.replace.mutate).toHaveBeenCalledWith({ docId: 'd1', file });
  });

  it('AC-DOC-040: download affordances generate a signed URL in both the table and drawer', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderTab('Admin', 'admin-1');

    await userEvent.click(screen.getByRole('button', { name: /Download file for Survey Report/i }));
    // Download forces attachment so all file types download rather than open inline.
    expect(repositoryState.document.getSignedUrl).toHaveBeenCalledWith('org-1/p1/d3/survey-report-rev-a.pdf', { download: true });
    expect(anchorClick).toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole('button', { name: /View Structural calculation report/i })[0]);
    const drawer = screen.getByRole('dialog');
    await userEvent.click(within(drawer).getByRole('button', { name: /Download structural-calc-rev-a\.pdf/i }));
    expect(repositoryState.document.getSignedUrl).toHaveBeenCalledWith('org-1/p1/d5/structural-calc-rev-a.pdf', { download: true });
  });

  it('AC-DOC-041: preview affordances open the signed URL in a new tab', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderTab('Admin', 'admin-1');
    await userEvent.click(screen.getByRole('button', { name: /Preview file for Survey Report/i }));
    expect(repositoryState.document.getSignedUrl).toHaveBeenCalledWith('org-1/p1/d3/survey-report-rev-a.pdf');
    expect(openSpy).toHaveBeenCalledWith('https://signed.example.com/file', '_blank', 'noopener,noreferrer');
  });

  it('AC-DOC-083: mobile card affordances keep the touch-target hook on file actions', () => {
    renderTab('Admin', 'admin-1');
    const upload = screen.getAllByRole('button', { name: /Upload file for Site Plan/i })[0];
    const download = screen.getAllByRole('button', { name: /Download file for Survey Report/i })[0];
    expect(upload.className).toContain('touch-target');
    expect(download.className).toContain('touch-target');
  });
});

describe('DocumentsTab — detail drawer D12 (AC-W5-C6-D12)', () => {
  const openDrawer = async (title: string, index = 0) => {
    await userEvent.click(screen.getAllByRole('button', { name: `View ${title}` })[index]);
    return screen.getByRole('dialog');
  };

  it('AC-W5-C6-D12: activating a row opens a read-first drawer titled with the document', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openDrawer('Site Plan');
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    const labelId = drawer.getAttribute('aria-labelledby');
    expect(document.getElementById(labelId!)?.textContent).toContain('Site Plan');
    // Read-first body: code (mono), category, status pill.
    expect(within(drawer).getByText('DOC-001')).toBeInTheDocument();
    expect(within(drawer).getByText('Drawing')).toBeInTheDocument();
  });

  it('AC-DOC-082 / AC-DOC-080: drawer shows superseding lineage and file information for superseded rows', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openDrawer('Structural calculation report', 0);
    expect(within(drawer).getByText(/Superseded by/i)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /View revision B of Structural calculation report/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /Download structural-calc-rev-a\.pdf/i })).toBeInTheDocument();
  });

  it('AC-W5-C6-D12: a Draft document shows an Issue status button in the drawer (workflow promoted out of ⋯)', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openDrawer('Site Plan');
    expect(within(drawer).getByRole('button', { name: /^Issue$/i })).toBeInTheDocument();
  });

  it('AC-W5-C6-D12: a reviewer (non-author) sees Approve + Reject on an Issued doc; Approve routes through the confirm', async () => {
    // d2 (Steel Spec) is Issued, authored by pm-1; the current user is admin-1 (≠ author).
    renderTab('Admin', 'admin-1');
    const drawer = await openDrawer('Steel Spec');
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
    const drawer = await openDrawer('Steel Spec');
    expect(within(drawer).queryByRole('button', { name: /^Approve$/i })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /^Reject$/i })).not.toBeInTheDocument();
    const gate = within(drawer).getByTestId('drawer-sod-gate');
    expect(gate).toHaveTextContent(/can't approve your own document/i);
    expect(gate).toHaveTextContent(/segregation-of-duties/i);
  });

  it('AC-W5-C6-D12: footer Edit closes the drawer then opens the edit form pre-filled', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openDrawer('Site Plan');
    await userEvent.click(within(drawer).getByRole('button', { name: /^Edit$/i }));
    const titleInput = (await screen.findByLabelText(/^Title/i)) as HTMLInputElement;
    expect(titleInput.value).toBe('Site Plan');
  });

  it('AC-DOC-082: drawer lineage links navigate between parent and child revisions', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openDrawer('Structural calculation report', 1);
    await userEvent.click(within(drawer).getByRole('button', { name: /View revision A of Structural calculation report/i }));
    const linkedDrawer = screen.getByRole('dialog');
    expect(document.getElementById(linkedDrawer.getAttribute('aria-labelledby')!)?.textContent).toContain('Structural calculation report');
    expect(within(linkedDrawer).getByText('Superseded by')).toBeInTheDocument();
  });

  it('AC-W5-C6-D12: footer Delete (Admin) closes the drawer then opens the destructive confirm', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openDrawer('Site Plan');
    await userEvent.click(within(drawer).getByRole('button', { name: /^Delete$/i }));
    expect(await screen.findByText(/Delete Site Plan\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Delete document/i }));
    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('d1'));
  });

  it('I7: cancelling the destructive delete confirm closes it without deleting', async () => {
    renderTab('Admin', 'admin-1');
    const drawer = await openDrawer('Site Plan');
    await userEvent.click(within(drawer).getByRole('button', { name: /^Delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByText(/Delete Site Plan\?/i)).not.toBeInTheDocument();
    expect(mutations.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it('M1: the action-section heading is "Update status", not "Status" (no duplicate label with the def-list STATUS row)', async () => {
    // The def-list has a "STATUS" field showing the current-state pill.
    // The action section heading must be "Update status" — renaming eliminates the
    // duplicate "STATUS" label that the rendered design-review flagged.
    renderTab('Admin', 'admin-1');
    const drawer = await openDrawer('Site Plan');
    // The action heading must read "Update status" (case-insensitive), not bare "STATUS"/"Status".
    expect(within(drawer).getByRole('heading', { name: /update status/i })).toBeInTheDocument();
    // The old bare "Status" heading must not exist as a heading element inside the drawer.
    // (The def-list <dt> "STATUS" is not a heading, so this only catches the <h3>.)
    const headings = within(drawer).queryAllByRole('heading');
    const statusHeadings = headings.filter(
      (h) => h.textContent?.trim().toLowerCase() === 'status',
    );
    expect(statusHeadings).toHaveLength(0);
  });
});
