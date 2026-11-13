import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { toast as sonnerToast } from 'sonner';
import { act } from 'react';
import { ToastProvider } from '@/src/components/ui';
import { DocumentViewerProvider } from '@/src/components/documents';

// Same harness as DocumentsTab.test.tsx — the real register tab; its reads and writes are faked.
const { listState, mutations, fileUploadState, revisionState, repositoryState, profilesState } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
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
    progress: {} as Record<string, number>,
    uploadErrors: {} as Record<string, { message: string }>,
    cancelUpload: vi.fn(),
    clearUploadError: vi.fn(),
  },
  revisionState: { createRevision: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false } },
  repositoryState: { document: { getSignedUrl: vi.fn() } },
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

vi.mock('@/src/hooks/useUploadDestination', async (orig) => ({
  ...(await orig<typeof import('@/src/hooks/useUploadDestination')>()),
  useUploadDestination: () => ({ kind: 'private' }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => listState,
  useDocumentMutations: () => mutations,
  useChildDocument: () => ({ data: null, isPending: false }),
}));
vi.mock('@/src/hooks/useFileUpload', () => ({ useFileUpload: () => fileUploadState }));
vi.mock('@/src/hooks/useRevision', () => ({ useRevision: () => revisionState }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => profilesState }));
vi.mock('@/src/lib/repositories', () => ({ repositories: repositoryState }));
vi.mock('@/src/components/m365/DocumentLinkPermissions', () => ({
  useDocumentLinkPermissions: () => ({
    projectCreate: () => realRole !== 'Engineer',
    projectEdit: () => realRole !== 'Engineer',
  }),
}));
// The picker is stubbed like DocumentsTab.folder-link.test.tsx does: choosing a file hands
// a Microsoft reference to the tab's link flow.
const FOLDER = { drive_id: 'drive-1', item_id: 'file-9', web_url: 'https://contoso.sharepoint.com/sites/x/GA.pdf', name: 'GA.pdf', item_kind: 'file' as const };
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({
  useMicrosoftDocuments: () => ({ connection: { connected: true, status: 'active' }, isPending: false, refetch: vi.fn() }),
}));
vi.mock('@/src/components/m365/MicrosoftDocumentPicker', () => ({
  MicrosoftDocumentPicker: (props: { onSelect: (ref: unknown) => Promise<void> }) => (
    <div role="dialog" aria-label="Synthetic picker">
      <button type="button" onClick={() => void props.onSelect(FOLDER)}>Select synthetic file</button>
    </div>
  ),
}));
vi.mock('@/src/components/m365/RecordFolderAction', () => ({ RecordFolderAction: () => null }));

let realRole: Role = 'Admin';
let currentUserId = 'pm-1';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' } }),
}));

import DocumentsTab from '../DocumentsTab';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';

const testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const RouteSearch = () => {
  const location = useLocation();
  return <output data-testid="route-search">{location.pathname + location.search}</output>;
};

const seed = [
  { id: 'd1', project_id: 'p1', code: 'DOC-001', category: 'Drawing', title: 'Site Plan', revision: 'A', status: 'Draft', author_id: 'pm-1', doc_date: '2026-06-01', org_id: 'org-1', file_path: null, parent_document_id: null, created_at: '2026-06-01T00:00:00Z' },
  { id: 'd2', project_id: 'p1', code: 'DOC-002', category: 'Specification', title: 'Steel Spec', revision: 'B', status: 'Issued', author_id: 'pm-1', doc_date: '2026-06-02', org_id: 'org-1', file_path: 'org-1/p1/d2/steel-spec-rev-b.pdf', parent_document_id: null, created_at: '2026-06-02T00:00:00Z' },
  { id: 'd3', project_id: 'p1', code: 'DOC-003', category: 'Report', title: 'Survey Report', revision: 'A', status: 'Approved', author_id: 'admin-1', doc_date: null, org_id: 'org-1', file_path: 'org-1/p1/d3/survey-report-rev-a.pdf', parent_document_id: null, created_at: '2026-06-03T00:00:00Z' },
];

const linkedDraft = {
  ...seed[0], title: 'Linked GA', source: 'onedrive', file_path: null,
  ms_drive_id: 'drive-1', ms_item_id: 'file-1', ms_web_url: 'https://tenant.sharepoint.com/sites/project/GA.pdf',
  ms_item_name: 'GA.pdf', ms_item_kind: 'file', ms_linked_by: 'pm-1', ms_linked_at: '2026-06-01T00:00:00Z',
};

const renderTab = (role: Role = 'Admin', uid = 'pm-1', initialEntry = '/projects/p1/documents') => {
  realRole = role;
  currentUserId = uid;
  return render(
    <QueryClientProvider client={testQueryClient}><ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <RouteSearch />
        <DocumentViewerProvider><DocumentsTab projectId="p1" /></DocumentViewerProvider>
      </MemoryRouter>
    </ToastProvider></QueryClientProvider>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  repositoryState.document.getSignedUrl.mockReset();
  repositoryState.document.getSignedUrl.mockResolvedValue('https://signed.example/file');
  act(() => { sonnerToast.dismiss(); });
});

describe('DocumentsTab floor', () => {
  it('floor: Category filter narrows the register to that category', async () => {
    renderTab();
    expect(screen.getByText('Site Plan')).toBeInTheDocument();
    expect(screen.getByText('Survey Report')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'Drawing');
    expect(screen.getByText('Site Plan')).toBeInTheDocument();
    expect(screen.queryByText('Survey Report')).not.toBeInTheDocument();
    expect(screen.queryByText('Steel Spec')).not.toBeInTheDocument();
  });

  it('floor: Document column sort flips the register order between ascending and descending', async () => {
    renderTab();
    const first = screen.getByText('Site Plan').closest('tr')!;
    const second = screen.getByText('Steel Spec').closest('tr')!;
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Document' }));
    const firstDesc = screen.getByText('Site Plan').closest('tr')!;
    const secondDesc = screen.getByText('Steel Spec').closest('tr')!;
    expect(secondDesc.compareDocumentPosition(firstDesc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('floor: Search narrows a long register to the typed title', async () => {
    listState.data = [
      ...seed,
      ...Array.from({ length: 10 }, (_, index) => ({
        ...seed[0], id: `extra-${index}`, code: `DOC-EXTRA-${index}`, title: `Additional Document ${index}`,
      })),
    ];
    renderTab();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search documents' }), 'Steel');
    expect(screen.getByText('Steel Spec')).toBeInTheDocument();
    expect(screen.queryByText('Site Plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Survey Report')).not.toBeInTheDocument();
  });

  it('floor: Export register writes exactly the selected rows to the CSV', async () => {
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    let csv = '';
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      void (blob as Blob).text().then((text) => { csv = text; });
      return 'blob:mock';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    renderTab();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Site Plan' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Steel Spec' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export register' }));

    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe('project-p1-document-register.csv');
    await vi.waitFor(() => expect(csv).toContain('Site Plan'));
    expect(csv).toContain('Steel Spec');
    expect(csv).not.toContain('Survey Report');
    vi.restoreAllMocks();
  });

  it('floor: Bulk status change confirms then transitions the selected rows', async () => {
    listState.data = [seed[0], { ...seed[0], id: 'd7', code: 'DOC-007', title: 'Field Notes' }];
    renderTab();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Site Plan' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Field Notes' }));

    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    await userEvent.selectOptions(await screen.findByLabelText('Change status'), 'Issued');
    await userEvent.click(screen.getByRole('button', { name: 'Review change' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm status change' }));

    expect(mutations.transition.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'd1', status: 'Issued' });
    expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'd7', status: 'Issued' });
  });

  it('floor: Bulk Download fetches only the selected documents with files', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Steel Spec' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Survey Report' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Site Plan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));

    // d2 and d3 have files; the file-less Draft (d1) is skipped.
    expect(repositoryState.document.getSignedUrl).toHaveBeenCalledTimes(2);
    expect(repositoryState.document.getSignedUrl).toHaveBeenCalledWith('org-1/p1/d2/steel-spec-rev-b.pdf', { download: true });
    expect(repositoryState.document.getSignedUrl).toHaveBeenCalledWith('org-1/p1/d3/survey-report-rev-a.pdf', { download: true });
  });

  it('floor: Unlink Microsoft item confirms then removes the PMO reference', async () => {
    listState.data = [linkedDraft];
    renderTab();

    await userEvent.click(within(screen.getByText('Linked GA').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unlink Microsoft item' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }));

    await findToastAnnouncement('status', /Reference removed/i);
    expect(mutations.unlink.mutateAsync).toHaveBeenCalledWith('d1');
  });

  it('floor: Link from Microsoft 365 links the chosen item to the Draft', async () => {
    listState.data = [seed[0]];
    renderTab();

    await userEvent.click(within(screen.getByText('Site Plan').closest('tr')!).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Link from Microsoft 365' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select synthetic file' }));

    expect(mutations.link.mutateAsync).toHaveBeenCalledWith({ id: 'd1', reference: FOLDER });
    await findToastAnnouncement('status', /Microsoft item linked/i);
  });

  it('floor: Open full page clears ?open on the same Documents route', async () => {
    renderTab('Admin', 'pm-1', '/projects/p1/documents?open=d1');
    const drawer = await screen.findByRole('dialog', { name: 'Site Plan' });
    await userEvent.click(within(drawer).getByRole('link', { name: 'Open full page' }));

    expect(screen.getByTestId('route-search')).toHaveTextContent('/projects/p1/documents');
    expect(screen.queryByRole('dialog', { name: 'Site Plan' })).not.toBeInTheDocument();
  });
});
