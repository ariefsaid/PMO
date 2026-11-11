import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import enProject from '@/public/locales/en/project.json';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { makeDoc, makeLinkedDoc } from './m365Fixtures';

const h = vi.hoisted(() => ({
  currentUser: { id: 'user-1', org_id: 'org-1' },
  rows: [] as ProjectDocumentRow[],
  list: vi.fn(),
  check: vi.fn(),
  invoke: vi.fn(),
  getChild: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  transition: vi.fn(),
  remove: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    document: {
      list: h.list,
      getChild: h.getChild,
      create: h.create,
      update: h.update,
      transition: h.transition,
      delete: h.remove,
      linkMicrosoftDocument: h.link,
      unlinkMicrosoftDocument: h.unlink,
      getSignedUrl: h.getSignedUrl,
    },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: h.currentUser }) }));
vi.mock('@/src/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    upload: { mutate: vi.fn(), isPending: false },
    replace: { mutate: vi.fn(), isPending: false },
    progress: {}, uploadErrors: {}, cancelUpload: vi.fn(), clearUploadError: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useRevision', () => ({
  useRevision: () => ({ createRevision: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({
  useMicrosoftDocuments: () => ({ connection: undefined, isPending: true, refetch: vi.fn() }),
}));
vi.mock('@/src/components/m365/RecordFolderAction', () => ({ RecordFolderAction: () => null }));
vi.mock('@/src/components/m365/MicrosoftDocumentPicker', () => ({ MicrosoftDocumentPicker: () => null }));
vi.mock('@/src/lib/m365/graphClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/m365/graphClient')>();
  return { ...actual, checkMicrosoftDocuments: h.check };
});

import DocumentsTab from '../DocumentsTab';

const pageI18n = createInstance();
const HOUR = 3_600_000;

function controlledFile(id: string, title: string, overrides: Partial<ProjectDocumentRow> = {}) {
  return makeLinkedDoc({
    id,
    title,
    status: 'Approved',
    ms_content_tag_at_issue: 'baseline-content',
    ms_version_id_at_issue: '2.0',
    ms_drift_state: 'clean',
    ms_last_verified_at: new Date(Date.now() - 30 * HOUR).toISOString(),
    ...overrides,
  });
}

const renderTree = (client: QueryClient) => (
  <I18nextProvider i18n={pageI18n}>
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ImpersonationProvider realRole="Admin">
          <ToastProvider>
            <DocumentsTab projectId="p1" />
          </ToastProvider>
        </ImpersonationProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </I18nextProvider>
);

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return { client, ...render(renderTree(client)) };
}

function mobileMediaQuery() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

beforeAll(async () => {
  await pageI18n.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'project',
    resources: { en: { project: enProject } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  h.currentUser = { id: 'user-1', org_id: 'org-1' };
  h.rows = [];
  h.list.mockImplementation(async () => h.rows);
  h.check.mockReset();
  h.check.mockResolvedValue(undefined);
  h.getChild.mockResolvedValue(null);
  h.getSignedUrl.mockResolvedValue('https://example.invalid/document');
  mobileMediaQuery();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DocumentsTab display-triggered Microsoft verification', () => {
  it('AC-M365DOC-064 shares one visible multirow check with the open drawer and renders refreshed drift without looping', async () => {
    const oldCheck = new Date(Date.now() - 30 * HOUR).toISOString();
    const alpha = controlledFile('doc-alpha', 'Alpha File', { ms_drift_state: 'drifted', ms_last_verified_at: oldCheck });
    const beta = controlledFile('doc-beta', 'Beta File', { ms_last_verified_at: oldCheck });
    h.rows = [beta, alpha];

    let resolveCheck!: () => void;
    h.check.mockImplementation(() => new Promise<void>((resolve) => { resolveCheck = resolve; }));

    const view = renderTab();
    await waitFor(() => expect(h.check).toHaveBeenCalledTimes(1));
    expect(h.check).toHaveBeenCalledWith(['doc-alpha', 'doc-beta']);

    await userEvent.click(screen.getByRole('button', { name: 'View Alpha File' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('SharePoint file')).toBeInTheDocument();
    expect(screen.getAllByText('Checking Microsoft file content…').length).toBeGreaterThanOrEqual(2);

    view.rerender(renderTree(view.client));
    expect(h.check).toHaveBeenCalledTimes(1);

    h.rows = [
      controlledFile('doc-alpha', 'Alpha File', {
        ms_drift_state: 'drifted', ms_last_verified_at: new Date().toISOString(),
      }),
      controlledFile('doc-beta', 'Beta File', { ms_last_verified_at: new Date().toISOString() }),
    ];
    resolveCheck();

    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText(
      'File content differs from its issue-time baseline.',
    )).toBeInTheDocument());
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
    expect(h.check).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/Checked /).length).toBeGreaterThan(0);
  });

  it('AC-M365DOC-064 keeps last-known as-of copy after a failed check and retries only on an explicit drawer action', async () => {
    const oldCheck = new Date(Date.now() - 30 * HOUR).toISOString();
    h.rows = [controlledFile('doc-failure', 'Failure File', { ms_last_verified_at: oldCheck })];
    h.check.mockRejectedValueOnce(new Error('private upstream detail'))
      .mockResolvedValueOnce(undefined);

    renderTab();
    await waitFor(() => expect(screen.getAllByText(
      "Couldn't check with Microsoft. This status may be out of date.",
    ).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Checked /).length).toBeGreaterThan(0);
    expect(screen.queryByText('private upstream detail')).not.toBeInTheDocument();
    expect(h.check).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'View Failure File' }));
    const drawer = screen.getByRole('dialog');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Retry check' }));
    await waitFor(() => expect(h.check).toHaveBeenCalledTimes(2));
    expect(h.check.mock.calls.map(([ids]) => ids)).toEqual([['doc-failure'], ['doc-failure']]);
  });

  it('AC-M365DOC-064 retains a partial batch failure until drawer retry', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    h.rows = ids.map((id, i) => controlledFile(id, `File ${i + 1}`));
    const actual = await vi.importActual<typeof import('@/src/lib/m365/graphClient')>('@/src/lib/m365/graphClient');
    h.check.mockImplementation(actual.checkMicrosoftDocuments);
    const invoke = h.invoke.mockReset().mockImplementation(async (_name, options) => {
      const batch = (options?.body as { document_ids: string[] }).document_ids;
      if (batch.length === 20) {
        h.rows = h.rows.map((row) => batch.includes(row.id) ? { ...row, ms_last_verified_at: new Date().toISOString() } : row);
        return { data: { checked: 20 }, error: null } as never;
      }
      if (invoke.mock.calls.length === 2) return { data: null, error: new Error('private upstream detail') } as never;
      h.rows = h.rows.map((row) => row.id === ids[20] ? { ...row, ms_last_verified_at: new Date().toISOString(), ms_drift_state: 'drifted' } : row);
      return { data: { checked: 1 }, error: null } as never;
    });
    try {
      renderTab();
      await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getAllByText("Couldn't check with Microsoft. This status may be out of date.").length).toBeGreaterThan(0));
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(screen.getAllByText("Couldn't check with Microsoft. This status may be out of date.")).toHaveLength(1);
      expect(screen.getAllByText(/Checked /).length).toBeGreaterThan(0);
      expect(screen.queryByText('private upstream detail')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'View File 21' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retry check' }));
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
      expect((invoke.mock.calls[2][1]?.body as { document_ids: string[] }).document_ids).toEqual([ids[20]]);
      await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('File content differs from its issue-time baseline.')).toBeInTheDocument());
      expect(invoke).toHaveBeenCalledTimes(3);
    } finally { invoke.mockReset(); }
  });

  it('AC-M365DOC-064 retries only the open mobile drawer when the register is hidden by an error', async () => {
    h.rows = [controlledFile('doc-a', 'Alpha File'), controlledFile('doc-b', 'Beta File')];
    let rejectCheck!: (error: Error) => void;
    h.check.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectCheck = reject; }))
      .mockResolvedValueOnce(undefined);
    h.list.mockResolvedValueOnce(h.rows).mockRejectedValueOnce(new Error('register unavailable'));
    renderTab();
    await waitFor(() => expect(h.check).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'View Alpha File' }));
    rejectCheck(new Error('check unavailable'));
    await waitFor(() => expect(screen.getByText("Couldn't load documents")).toBeInTheDocument());
    const drawer = screen.getByRole('dialog');
    await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Retry check' })).toBeInTheDocument());
    await userEvent.click(within(drawer).getByRole('button', { name: 'Retry check' }));
    await waitFor(() => expect(h.check).toHaveBeenCalledTimes(2));
    expect(h.check.mock.calls[1][0]).toEqual(['doc-a']);
  });

  it('AC-M365DOC-064 rechecks the same stale display after an account switch', async () => {
    h.rows = [controlledFile('doc-account', 'Account File')];
    const view = renderTab();
    await waitFor(() => expect(h.check).toHaveBeenCalledTimes(1));

    h.currentUser = { id: 'user-2', org_id: 'org-1' };
    view.rerender(renderTree(view.client));

    await waitFor(() => expect(h.check).toHaveBeenCalledTimes(2));
    expect(h.check.mock.calls.map(([ids]) => ids)).toEqual([['doc-account'], ['doc-account']]);
  });

  it('AC-M365DOC-064 sends only the displayed file at the 24-hour boundary, excluding fresh files, Drafts, folders, and uploads', async () => {
    const now = Date.now();
    h.rows = [
      controlledFile('doc-24h', 'Boundary File', { ms_last_verified_at: new Date(now - 24 * HOUR).toISOString() }),
      controlledFile('doc-fresh', 'Fresh File', { ms_last_verified_at: new Date(now - 23 * HOUR).toISOString() }),
      makeLinkedDoc({ id: 'doc-draft', title: 'Draft File', status: 'Draft', ms_last_verified_at: null }),
      makeLinkedDoc({ id: 'doc-folder', title: 'Reference Folder', ms_item_kind: 'folder', ms_last_verified_at: null }),
      makeDoc({ id: 'doc-upload', title: 'Uploaded File', source: 'upload', status: 'Issued', file_path: 'file.pdf' }),
    ];

    renderTab();
    await waitFor(() => expect(h.check).toHaveBeenCalledTimes(1));
    expect(h.check).toHaveBeenCalledWith(['doc-24h']);
  });
});
