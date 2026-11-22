import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { AuthContext, type AuthContextValue, type Role } from '@/src/auth/AuthContext';

const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  key: null as string | null,
  docs: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  types: { data: [] as unknown[] },
  create: vi.fn(), update: vi.fn(), archive: vi.fn(),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));
vi.mock('@/src/hooks/useDocumentExpiry', () => ({
  useSubjectDocuments: () => h.docs,
  useDocumentTypes: () => h.types,
  useExpiryDocumentMutations: () => ({
    create: { mutateAsync: h.create }, update: { mutateAsync: h.update }, archive: { mutateAsync: h.archive },
  }),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { documentExpiry: { attachmentUrl: vi.fn() } } }));

import { ExpiryDocumentsCard } from './ExpiryDocumentsCard';

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1', subject_kind: 'equipment', person_id: null, asset_id: 'a1', type_id: 't1', number: 'EC-1', issued_on: '2026-01-01',
  expires_on: '2026-12-31', location_note: null, attachment_path: null, medical_status: null, is_medical: false, archived_at: null, ...over,
});
const type = (over: Record<string, unknown> = {}) => ({ id: 't1', name: 'Equipment certificate', applies_to: 'equipment', is_medical: false, ...over });
const renderCard = (kind: 'person' | 'equipment' = 'equipment') => render(
  <AuthContext.Provider value={{ currentUser: { id: 'me', built_in_role: h.key } } as AuthContextValue}>
    <MemoryRouter><ToastProvider><ExpiryDocumentsCard kind={kind} subjectId="a1" /></ToastProvider></MemoryRouter>
  </AuthContext.Provider>);
const typeDate = async (user: ReturnType<typeof userEvent.setup>, name: RegExp, value: string) => {
  await user.type(screen.getByRole('textbox', { name }), value);
  await user.tab();
};

describe('ExpiryDocumentsCard (#2542)', () => {
  beforeEach(() => {
    h.role = 'Admin';
    h.key = null;
    h.docs = { data: [doc()], isPending: false, isError: false, refetch: vi.fn() };
    h.types = { data: [type(), type({ id: 't2', name: 'Medical check', is_medical: true, applies_to: 'person' })] };
    h.create.mockReset().mockResolvedValue({}); h.update.mockReset().mockResolvedValue(undefined); h.archive.mockReset().mockResolvedValue(undefined);
  });

  it('AC-DEE-001 adds a document with type, number and expiry date', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Add document' }));
    await user.selectOptions(screen.getByLabelText(/Document type/), 't1');
    await user.type(within(screen.getByRole('dialog')).getByLabelText(/^Number/), 'EC-9');
    await typeDate(user, /Expiry date/, '2027-03-01');
    await user.click(screen.getByRole('button', { name: 'Save document' }));
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ type_id: 't1', number: 'EC-9', expires_on: '2027-03-01', file: null }));
  });

  it('fix/walk-people item 5: a new medical document starts with no status and will not save until fit or unfit is chosen', async () => {
    const user = userEvent.setup();
    renderCard('person');
    await user.click(screen.getByRole('button', { name: 'Add document' }));
    await user.selectOptions(screen.getByLabelText(/Document type/), 't2');
    const status = screen.getByLabelText(/Medical status/) as HTMLSelectElement;
    expect(status.value).toBe('');
    await typeDate(user, /Expiry date/, '2027-03-01');
    await user.click(screen.getByRole('button', { name: 'Save document' }));
    expect(h.create).not.toHaveBeenCalled();
    await user.selectOptions(status, 'unfit');
    await user.click(screen.getByRole('button', { name: 'Save document' }));
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ type_id: 't2', medical_status: 'unfit' }));
  });

  it('AC-DEE-002 edits only the editable fields of an existing document', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Edit EC-1/ }));
    const field = screen.getByRole('textbox', { name: /Expiry date/ });
    await user.clear(field);
    await user.type(field, '2028-01-15');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save document' }));
    expect(h.update).toHaveBeenCalledWith({
      id: 'd1', previousPath: null, file: null,
      fields: { number: 'EC-1', issued_on: '2026-01-01', expires_on: '2028-01-15', location_note: null, medical_status: null },
    });
  });

  it('AC-DEE-003 archives only after confirmation', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Archive EC-1/ }));
    expect(h.archive).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(h.archive).toHaveBeenCalledWith('d1');
  });

  it('AC-DEE-004 a medical type offers a status and no number, note or file', async () => {
    const user = userEvent.setup();
    renderCard('person');
    await user.click(screen.getByRole('button', { name: 'Add document' }));
    await user.selectOptions(screen.getByLabelText(/Document type/), 't2');
    expect(screen.getByLabelText(/Medical status/)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(/^Number/)).toBeNull();
    expect(within(dialog).queryByLabelText(/Kept at/)).toBeNull();
    expect(within(dialog).queryByLabelText(/Attachment/)).toBeNull();
  });

  it('AC-DEE-005 hides add, edit and archive from roles that may not write', () => {
    h.role = 'Finance';
    renderCard();
    expect(screen.getByText('EC-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add document' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit EC-1/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Archive EC-1/ })).toBeNull();
  });

  it('AC-DEE-005 a Project Manager writes equipment documents but not a person\'s', () => {
    h.role = 'Project Manager';
    const { unmount } = renderCard('equipment');
    expect(screen.getByRole('button', { name: 'Add document' })).toBeInTheDocument();
    unmount();
    renderCard('person');
    expect(screen.queryByRole('button', { name: 'Add document' })).toBeNull();
  });

  it('AC-DEE-006 blocks a save whose expiry is before its issue date', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Add document' }));
    await user.selectOptions(screen.getByLabelText(/Document type/), 't1');
    await typeDate(user, /Issue date/, '2027-05-01');
    await typeDate(user, /Expiry date/, '2027-03-01');
    await user.click(screen.getByRole('button', { name: 'Save document' }));
    expect(h.create).not.toHaveBeenCalled();
    expect(screen.getAllByText('Expiry date must be on or after the issue date').length).toBeGreaterThan(0);
  });

  it('AC-RCG-023 a holder of the people-documents capability adds and edits non-medical person documents, with no medical type to choose', async () => {
    const user = userEvent.setup();
    h.role = 'Engineer';
    h.key = 'hr_officer';
    h.docs.data = [doc({ id: 'd2', subject_kind: 'person', number: 'WP-1' }), doc({ id: 'd3', subject_kind: 'person', number: null, type_id: 't2', is_medical: true, medical_status: 'fit' })];
    h.types = { data: [type({ id: 't1', name: 'Work permit', applies_to: 'person' }), type({ id: 't2', name: 'Medical check', is_medical: true, applies_to: 'person' })] };
    renderCard('person');
    expect(screen.getByRole('button', { name: /Edit WP-1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Medical check/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add document' }));
    const options = within(screen.getByLabelText(/Document type/)).getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Work permit');
    expect(options).not.toContain('Medical check');
  });

  it('AC-RCG-023 an Engineer with another built-in role gets no document actions on a person', () => {
    h.role = 'Engineer';
    h.key = 'planner';
    renderCard('person');
    expect(screen.queryByRole('button', { name: 'Add document' })).toBeNull();
  });

  it('explains an empty record and offers retry on a failed read', () => {
    h.docs.data = [];
    const { unmount } = renderCard();
    expect(screen.getByText('No documents on this record')).toBeInTheDocument();
    unmount();
    h.docs = { data: [], isPending: false, isError: true, refetch: vi.fn() };
    renderCard();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
