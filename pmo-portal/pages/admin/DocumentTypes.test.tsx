/** #2614 — Administration › Document types and warning days: states, writes, Admin-only, Bahasa. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { AuthContext, type Role } from '@/src/auth/AuthContext';
import { BahasaProvider } from '@/test/bahasa';

const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  effectiveRole: null as string | null,
  builtInRole: null as string | null,
  types: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  days: { data: [30, 14, 7] as number[] | undefined, isError: false, refetch: vi.fn() },
  create: vi.fn(), update: vi.fn(), archive: vi.fn(), setDays: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1', built_in_role: h.builtInRole } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: (h.effectiveRole ?? h.role) as Role }) }));
vi.mock('@/src/hooks/useDocumentExpiry', () => ({
  useAdminDocumentTypes: () => h.types,
  useDocumentWarningDays: () => h.days,
  useDocumentTypeMutations: () => ({ create: { mutateAsync: h.create }, update: { mutateAsync: h.update }, archive: { mutateAsync: h.archive, isPending: false } }),
  useSetDocumentWarningDays: () => ({ mutate: h.setDays, isPending: false }),
}));
import DocumentTypes from './DocumentTypes';
import { parseWarningDays } from '@/src/lib/db/documentExpiry';

const type = (over: Record<string, unknown> = {}) => ({ id: 't1', name: 'Safety passport', applies_to: 'person', is_medical: false, notify_roles: ['Admin'], notify_person: false, ...over });
const renderIt = (wrap = false) => {
  const tree = (
    <AuthContext.Provider value={{ currentUser: { id: 'u1', org_id: 'org-1', built_in_role: h.builtInRole }, role: h.role } as never}>
      <ToastProvider><DocumentTypes /></ToastProvider>
    </AuthContext.Provider>
  );
  return render(wrap ? <BahasaProvider>{tree}</BahasaProvider> : tree);
};

describe('Document types screen (#2614)', () => {
  beforeEach(() => {
    h.role = 'Admin';
    h.effectiveRole = null;
    h.builtInRole = null;
    h.types = { data: [type()], isPending: false, isError: false, refetch: vi.fn() };
    h.days = { data: [30, 14, 7], isError: false, refetch: vi.fn() };
    h.create.mockReset().mockResolvedValue({}); h.update.mockReset().mockResolvedValue(undefined);
    h.archive.mockReset().mockResolvedValue(undefined); h.setDays.mockReset();
  });

  it('lists types with kind and roles notified', () => {
    renderIt();
    expect(screen.getByText('Safety passport')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Safety passport' })).toBeInTheDocument();
  });

  it('empty state offers the first type to an Admin', () => {
    h.types = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText(/No document types yet/)).toBeInTheDocument();
  });

  it('loading and error-with-retry states', async () => {
    h.types = { data: [], isPending: true, isError: false, refetch: vi.fn() };
    const { unmount } = renderIt();
    expect(screen.queryByText('Safety passport')).toBeNull();
    unmount();
    h.types = { data: [], isPending: false, isError: true, refetch: vi.fn() };
    renderIt();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.types.refetch).toHaveBeenCalled();
  });

  it('adds an equipment type with the chosen roles', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Add document type' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText(/^Name/), 'Crane certificate');
    await user.selectOptions(dialog.getByLabelText('Applies to'), 'equipment');
    // the kind's default roles are pre-ticked (what the database would fill); untick Admin to keep only the Project Manager
    expect(dialog.getByRole('checkbox', { name: 'Admin' })).toBeChecked();
    expect(dialog.getByRole('checkbox', { name: 'Project Manager' })).toBeChecked();
    await user.click(dialog.getByRole('checkbox', { name: 'Admin' }));
    await user.click(dialog.getByRole('button', { name: 'Save document type' }));
    expect(h.create).toHaveBeenCalledWith({ name: 'Crane certificate', applies_to: 'equipment', is_medical: false, notify_roles: ['Project Manager'], notify_person: false });
  });

  it('AC-EXM-003 a person type can warn the manager only: untick every role', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Add document type' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText(/^Name/), 'Badge');
    await user.click(dialog.getByRole('checkbox', { name: 'Admin' }));
    await user.click(dialog.getByRole('button', { name: 'Save document type' }));
    expect(h.create).toHaveBeenCalledWith({ name: 'Badge', applies_to: 'person', is_medical: false, notify_roles: [], notify_person: false });
  });

  it('AC-EXM-002 "Also tell the person" is off by default, saved when ticked, offered for person types only, and shown in the list', async () => {
    const user = userEvent.setup();
    h.types = { data: [type(), type({ id: 't2', name: 'Told pass', notify_person: true }), type({ id: 't3', name: 'Gear', applies_to: 'equipment', notify_roles: [] })], isPending: false, isError: false, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText('Direct manager, Admin')).toBeInTheDocument();
    expect(screen.getByText('Direct manager, Admin, The person')).toBeInTheDocument();
    expect(screen.getByText('No one is warned')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit Safety passport' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('checkbox', { name: 'Also tell the person' })).not.toBeChecked();
    await user.click(dialog.getByRole('checkbox', { name: 'Also tell the person' }));
    await user.click(dialog.getByRole('button', { name: 'Save document type' }));
    expect(h.update).toHaveBeenCalledWith({ id: 't1', input: { name: 'Safety passport', notify_roles: ['Admin'], notify_person: true } });
  });

  it('an equipment type has no "Also tell the person" choice', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Add document type' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.selectOptions(dialog.getByLabelText('Applies to'), 'equipment');
    expect(dialog.queryByRole('checkbox', { name: 'Also tell the person' })).toBeNull();
  });

  it('renames a type (kind and medical flag are fixed)', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Edit Safety passport' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByLabelText('Applies to')).toBeNull();
    await user.clear(dialog.getByLabelText(/^Name/));
    await user.type(dialog.getByLabelText(/^Name/), 'Site pass');
    await user.click(dialog.getByRole('button', { name: 'Save document type' }));
    expect(h.update).toHaveBeenCalledWith({ id: 't1', input: { name: 'Site pass', notify_roles: ['Admin'], notify_person: false } });
  });

  it('archives after confirming', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Archive Safety passport' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
    expect(h.archive).toHaveBeenCalledWith('t1');
  });

  it('saves warning days sorted by the server; rejects more than five or out-of-range values', async () => {
    const user = userEvent.setup();
    renderIt();
    const field = screen.getByLabelText('Warn this many days before expiry');
    await user.clear(field); await user.type(field, '60, 30, 1');
    await user.click(screen.getByRole('button', { name: 'Save warning days' }));
    expect(h.setDays.mock.calls[0][0]).toEqual([60, 30, 1]);
    h.setDays.mockClear();
    await user.clear(field); await user.type(field, '1,2,3,4,5,6');
    await user.click(screen.getByRole('button', { name: 'Save warning days' }));
    expect(h.setDays).not.toHaveBeenCalled();
    expect(screen.getByText(/1 to 5 whole numbers/)).toBeInTheDocument();
  });

  it('a non-Admin sees the list and days but no write control', () => {
    h.role = 'Project Manager';
    renderIt();
    expect(screen.getByText('Safety passport')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add document type' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save warning days' })).toBeNull();
  });

  it('reads as Bahasa Indonesia', () => {
    renderIt(true);
    expect(screen.getByRole('heading', { name: 'Jenis dokumen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tambah jenis dokumen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simpan hari peringatan' })).toBeInTheDocument();
    expect(screen.queryByText('Add document type')).toBeNull();
  });

  it('AC-HMDT-001, AC-HMDT-003 HR Manager add form offers only non-medical person types and edits only non-medical person rows', async () => {
    const user = userEvent.setup();
    h.role = 'Project Manager';
    h.builtInRole = 'hr_manager';
    h.types = {
      data: [
        type({ id: 't1', name: 'Safety passport', applies_to: 'person', is_medical: false }),
        type({ id: 't2', name: 'Fitness check', applies_to: 'person', is_medical: true }),
        type({ id: 't3', name: 'Crane cert', applies_to: 'equipment', is_medical: false }),
      ],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderIt();
    expect(screen.getByRole('button', { name: 'Edit Safety passport' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Fitness check' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Crane cert' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add document type' }));
    const dialog = within(screen.getByRole('dialog'));
    const applies = dialog.getByLabelText('Applies to') as HTMLSelectElement;
    expect(Array.from(applies.options).map((o) => o.value)).toEqual(['person']);
    expect(dialog.queryByRole('option', { name: 'Equipment' })).toBeNull();
    expect(dialog.queryByRole('checkbox', { name: /Medical document/i })).toBeNull();

    await user.type(dialog.getByLabelText(/^Name/), 'Work permit');
    await user.click(dialog.getByRole('button', { name: 'Save document type' }));
    expect(h.create).toHaveBeenCalledWith({
      name: 'Work permit',
      applies_to: 'person',
      is_medical: false,
      notify_roles: ['Admin'],
      notify_person: false,
    });
  });

  it('AC-HMDT-002, AC-HMDT-004 Admin keeps Equipment and Medical options; HR Manager in Bahasa sees only Orang', async () => {
    const user = userEvent.setup();
    h.role = 'Admin';
    h.builtInRole = 'hr_manager';
    const { unmount } = renderIt();
    await user.click(screen.getByRole('button', { name: 'Add document type' }));
    const adminDialog = within(screen.getByRole('dialog'));
    expect(Array.from((adminDialog.getByLabelText('Applies to') as HTMLSelectElement).options).map((o) => o.value)).toEqual(['person', 'equipment']);
    expect(adminDialog.getByRole('checkbox', { name: /Medical document/i })).toBeInTheDocument();
    unmount();

    h.role = 'Project Manager';
    h.builtInRole = 'hr_manager';
    renderIt(true);
    await user.click(screen.getByRole('button', { name: 'Tambah jenis dokumen' }));
    const idDialog = within(screen.getByRole('dialog'));
    const idApplies = idDialog.getByLabelText('Berlaku untuk') as HTMLSelectElement;
    expect(Array.from(idApplies.options).map((o) => o.text)).toEqual(['Personel']);
    expect(idDialog.queryByRole('checkbox', { name: /Dokumen medis/i })).toBeNull();
  });
});

describe('medical expiry recipient explanation', () => {
  it('AC-SR-005 medical type shows the release rule instead of a worker expiry switch', async () => {
    h.role = 'Admin'; h.effectiveRole = null; h.builtInRole = null;
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole('button', { name: 'Add document type' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('checkbox', { name: /Medical document/i }));
    expect(dialog.queryByRole('checkbox', { name: 'Also tell the person' })).toBeNull();
    expect(dialog.getByText(/Expiry warnings go to the people team and direct manager/)).toBeInTheDocument();
  });
});

describe('parseWarningDays', () => {
  it.each([['30, 14, 7', [30, 14, 7]], ['7', [7]], ['', null], ['0', null], ['366', null], ['1.5', null], ['1 2 3 4 5 6', null]])('%j', (text, out) => {
    expect(parseWarningDays(text)).toEqual(out);
  });
});

it('uses translated notification role labels while saving stored role keys', async () => {
  h.role = 'Admin'; h.effectiveRole = null; h.builtInRole = null; h.update.mockClear();
  h.types = { data: [type()], isPending: false, isError: false, refetch: vi.fn() };
  renderIt(true);
  await userEvent.click(screen.getByRole('button', { name: /^(Edit|Ubah) Safety passport$/ }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Manajer proyek' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan jenis dokumen' }));
  expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ notify_roles: ['Admin', 'Project Manager'] }) }));
});
