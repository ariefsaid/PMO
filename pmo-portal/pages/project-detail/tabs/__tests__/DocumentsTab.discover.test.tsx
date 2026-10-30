import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ME, REFERENCE, makeDoc, makeLinkedDoc } from './m365Fixtures';

const h = vi.hoisted(() => ({
  docs: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  conn: { connection: { connected: true, status: 'active' } as unknown, isPending: false, refetch: vi.fn() },
  ensure: vi.fn(),
  create: vi.fn(),
  pickerOpens: 0,
  selectFromPicker: null as null | ((r: unknown) => Promise<void>),
}));

vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => h.docs,
  useDocumentMutations: () => ({
    create: { mutateAsync: h.create }, update: { mutateAsync: vi.fn() },
    transition: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
    link: { mutateAsync: vi.fn() }, unlink: { mutateAsync: vi.fn(), isPending: false },
  }),
  useChildDocument: () => ({ data: null, isPending: false }),
}));
vi.mock('@/src/hooks/useFileUpload', () => ({
  useFileUpload: () => ({ upload: { mutate: vi.fn() }, replace: { mutate: vi.fn() }, progress: {}, uploadErrors: {}, cancelUpload: vi.fn(), clearUploadError: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevision', () => ({ useRevision: () => ({ createRevision: { mutate: vi.fn(), isPending: false } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { document: {}, m365RecordFolders: { ensure: (...a: unknown[]) => h.ensure(...a) } } }));
const m365Feature = vi.hoisted(() => ({ on: true }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: (key: string) => key !== 'm365_integration' || m365Feature.on }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: ME, org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({ useMicrosoftDocuments: () => h.conn }));
vi.mock('@/src/components/m365/MicrosoftDocumentPicker', () => ({
  MicrosoftDocumentPicker: (props: { onSelect: (r: unknown) => Promise<void> }) => {
    h.pickerOpens += 1;
    h.selectFromPicker = props.onSelect;
    return <div role="dialog" aria-label="Synthetic picker" />;
  },
}));

import DocumentsTab from '../DocumentsTab';

const renderTab = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ImpersonationProvider realRole="Project Manager">
          <ToastProvider><DocumentsTab projectId="p1" projectCode="PRJ-1" /></ToastProvider>
        </ImpersonationProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  h.docs.data = [makeDoc()];
  h.conn.connection = { connected: true, status: 'active' };
  h.conn.isPending = false;
  h.ensure.mockReset();
  h.create.mockReset();
  h.pickerOpens = 0;
  h.selectFromPicker = null;
});

const ACCESS = /Access depends on your Microsoft permissions/;

describe('F1: register rows stay short', () => {
  it('F1: a Microsoft row opens its full linked-document cell in the preview; the access sentence appears once', async () => {
    h.docs.data = [makeLinkedDoc({ id: 'a' }), makeLinkedDoc({ id: 'b', title: 'Second' })];
    renderTab();
    expect(screen.queryAllByText(ACCESS)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'View Foundation GA' }));
    const preview = screen.getByRole('complementary');
    expect(within(preview).getByRole('button', { name: /^Open in SharePoint:/ })).toBeEnabled();
    expect(within(preview).getAllByText(ACCESS)).toHaveLength(1);
  });

  it('F1: the Date value never wraps mid-date', () => {
    h.docs.data = [makeLinkedDoc()];
    renderTab();
    expect(screen.getByText('Jun 1, 2026')).toHaveClass('whitespace-nowrap');
  });
});

describe('F4/F17: header actions', () => {
  it('F4/F17: the primary actions share one wrapping group, labelled "Link from Microsoft 365", and the folder action is outside the heading row', () => {
    renderTab();
    const link = screen.getByRole('button', { name: 'Link from Microsoft 365' });
    const add = screen.getByRole('button', { name: 'Add document' });
    expect(link.parentElement).toBe(add.parentElement);
    expect(link.parentElement).toHaveClass('flex-wrap');
    expect(screen.queryByRole('button', { name: 'From Microsoft 365' })).not.toBeInTheDocument();
    expect(link.parentElement).not.toBe(screen.getByRole('button', { name: 'Create folder in SharePoint' }).parentElement);
  });
});

describe('F5: ambiguous folder match', () => {
  it('F5: "Choose existing folder" opens the picker for the project', async () => {
    h.ensure.mockResolvedValue({ state: 'needs_choice' });
    renderTab();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Create folder in SharePoint' }));
    await user.click(await screen.findByRole('button', { name: 'Choose existing folder' }));
    expect(await screen.findByRole('dialog', { name: 'Synthetic picker' })).toBeInTheDocument();
  });
});

describe('F6: setup link', () => {
  it('F6: when Microsoft is not connected a Project Manager is sent to My integrations, not the Admin area', async () => {
    h.conn.connection = { connected: false, status: null };
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    expect(screen.getByRole('link', { name: 'My integrations' })).toHaveAttribute('href', '/integrations');
    expect(document.querySelector('a[href="/administration/integrations"]')).toBeNull();
  });
});

describe('F7: Add document from a Microsoft item', () => {
  async function pick(name: string, kind: 'file' | 'folder' = 'file') {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await screen.findByRole('dialog', { name: 'Synthetic picker' });
    await waitFor(() => expect(h.selectFromPicker).toBeTruthy());
    await act(async () => {
      await h.selectFromPicker!({ ...REFERENCE, name, item_kind: kind });
    });
  }

  it('F7: shows the chosen item, seeds the title without the file extension, and no longer promises a later upload', async () => {
    await pick('Specification rev C.pdf');
    const dialog = await screen.findByRole('dialog', { name: 'Add document' });
    expect(within(dialog).getByTestId('document-linked-item')).toHaveTextContent('Specification rev C.pdf');
    expect(within(dialog).getByRole('textbox', { name: /Title/ })).toHaveValue('Specification rev C');
    expect(within(dialog).queryByText(/Upload a file once the Draft row is created/)).not.toBeInTheDocument();
  });

  it('F7: a folder keeps its full name as the title', async () => {
    await pick('PRJ-1 Site v1.2', 'folder');
    const dialog = await screen.findByRole('dialog', { name: 'Add document' });
    expect(within(dialog).getByRole('textbox', { name: /Title/ })).toHaveValue('PRJ-1 Site v1.2');
  });

  it('F7: "Change" returns to the picker', async () => {
    await pick('Plan.docx');
    const dialog = await screen.findByRole('dialog', { name: 'Add document' });
    h.pickerOpens = 0;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change' }));
    expect(await screen.findByRole('dialog', { name: 'Synthetic picker' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Add document' })).not.toBeInTheDocument();
  });
});
