import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';
import { ownershipMock } from '@/test/domainOwnershipMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { firstInstantOfZonedCalendarDay, formatDay } from '@/src/lib/format';

// ── The single-contact hook + activities + mutations + the companies list are mocked. ──
const { detailState, activitiesState, mutations, companiesState, companyRefState } = vi.hoisted(() => ({
  detailState: {
    data: undefined as Record<string, unknown> | null | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  activitiesState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    archive: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    logActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    updateActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    deleteActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
  companiesState: {
    data: [{ id: 'co1', name: 'Cascade Port Authority', type: 'Client' }],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  companyRefState: {
    data: undefined as Record<string, unknown> | null | undefined,
    isPending: false,
    isError: false,
  },
}));
const permissionOverrides = vi.hoisted(() => ({
  contactView: null as boolean | null,
  contactActivityCreate: null as boolean | null,
}));

vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));
vi.mock('@/src/auth/usePermission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/auth/usePermission')>();
  return {
    ...actual,
    usePermission: () => {
      const may = actual.usePermission();
      return (action: Parameters<typeof may>[0], entity: Parameters<typeof may>[1], context?: Parameters<typeof may>[2]) => {
        if (action === 'view' && entity === 'contact' && permissionOverrides.contactView !== null) {
          return permissionOverrides.contactView;
        }
        if (action === 'create' && entity === 'contactActivity' && permissionOverrides.contactActivityCreate !== null) {
          return permissionOverrides.contactActivityCreate;
        }
        return may(action, entity, context);
      };
    },
  };
});

vi.mock('@/src/hooks/useContacts', () => ({
  useContact: () => detailState,
  useContactActivities: () => activitiesState,
  // DD-MTG-6 (I7): the timeline's meetings half — empty by default in these suites.
  useContactMeetings: () => ({ data: [], isPending: false, isError: false }),
  useContactMutations: () => mutations,
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => companiesState,
  useCompany: () => companyRefState,
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import ContactDetail from './ContactDetail';

const contact = {
  id: 'ct1',
  org_id: 'org-1',
  company_id: 'co1',
  full_name: 'Jane Doe',
  title: 'Procurement Lead',
  email: 'jane@example.com',
  phone: '+1 555 010 0000',
  notes: 'Key contact',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

// list-working-set-return (#683): reads the URL + router state a Contacts/Companies-index Route
// landed on. `data-state` (not visible text) so existing exact-text assertions stay unaffected.
const IndexProbe: React.FC<{ label: string }> = ({ label }) => {
  const location = useLocation();
  return (
    <div data-testid={`${label}-probe`} data-state={JSON.stringify(location.state ?? null)}>
      {label}
      {location.search}
    </div>
  );
};

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/contacts/ct1']}>
        <Routes>
          <Route path="/contacts/:contactId" element={<ContactDetail />} />
          <Route path="/contacts" element={<IndexProbe label="Contacts index" />} />
          <Route path="/companies/:companyId" element={<IndexProbe label="Company record" />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
};

// AC-LRC-007: the record was opened FROM a narrowed Contacts list (captured in router state).
const renderPageWithReturnContext = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/contacts/ct1',
            state: {
              pmoListReturn: {
                list: 'contacts',
                path: '/contacts?company=22222222-2222-4222-8222-222222222222',
              },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/contacts/:contactId" element={<ContactDetail />} />
          <Route path="/contacts" element={<IndexProbe label="Contacts index" />} />
          <Route path="/companies/:companyId" element={<IndexProbe label="Company record" />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
};

const openRecordActions = async () => {
  await userEvent.click(screen.getByRole('button', { name: /more actions/i }));
};

beforeEach(() => {
  permissionOverrides.contactView = null;
  permissionOverrides.contactActivityCreate = null;
  ownershipMock.override = null;
  ownershipMock.retry.mockClear();
  clearOwnershipCache();
  detailState.data = contact;
  detailState.isPending = false;
  detailState.isError = false;
  companiesState.data = [{ id: 'co1', name: 'Cascade Port Authority', type: 'Client' }];
  companiesState.isPending = false;
  companiesState.isError = false;
  companiesState.refetch.mockClear();
  companyRefState.data = undefined;
  companyRefState.isPending = false;
  companyRefState.isError = false;
  activitiesState.data = [];
  activitiesState.isPending = false;
  activitiesState.isError = false;
  activitiesState.refetch.mockClear();
  mutations.update.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.archive.mutateAsync.mockClear().mockResolvedValue(undefined);
  mutations.logActivity.mutateAsync.mockClear().mockResolvedValue(undefined);
  realRole = 'Admin';
});

describe('ContactDetail', () => {
  it('holds contact detail actions when ownership fails', async () => {
    ownershipMock.override = 'error';
    renderPage('Admin');
    expect(screen.getByText(/ownership could not be loaded/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(ownershipMock.retry).toHaveBeenCalled();
  });

  it('renders the contact name and all key contact facts in the record header', () => {
    renderPage();
    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(header).queryByText('Contact')).not.toBeInTheDocument();
    expect(within(header).getByText('Procurement Lead')).toBeInTheDocument();
    expect(screen.getAllByText('Procurement Lead')).toHaveLength(1);
    expect(within(header).getByText('Company')).toBeInTheDocument();
    expect(within(header).getByText('Email')).toBeInTheDocument();
    expect(within(header).getByText('Phone')).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'Cascade Port Authority' })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: 'jane@example.com' })).toHaveAttribute('href', 'mailto:jane@example.com');
    expect(within(header).getByRole('link', { name: '+1 555 010 0000' })).toHaveAttribute('href', 'tel:+15550100000');
    expect(screen.getByText('Key contact')).toBeInTheDocument();
  });

  it('keeps the title fact visible when the contact has no title value', () => {
    detailState.data = { ...contact, title: null };
    renderPage();
    expect(within(screen.getByTestId('record-header')).getByText('—')).toBeInTheDocument();
  });

  it('B4 keeps Log activity and Edit visible in the header while Archive stays in the action menu', async () => {
    renderPage();
    const header = screen.getByTestId('record-header');
    expect(within(header).getByRole('button', { name: /log activity/i })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    await openRecordActions();
    expect(screen.getByRole('menuitem', { name: /^archive$/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^edit$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /^archive$/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Jane Doe?' });
    expect(dialog).toHaveTextContent(
      'They will be hidden from the default list. Existing activity stays intact. You can restore them any time.',
    );
  });

  it('hides Log activity when the viewer may see contacts but cannot create contact activities', () => {
    permissionOverrides.contactView = true;
    permissionOverrides.contactActivityCreate = false;
    renderPage('Engineer');
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /log activity/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/subject/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^archive$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument();
  });

  it('B5 Admin sees Edit, Archive in the action menu, and Log activity under the real policy', async () => {
    renderPage('Admin');
    const header = screen.getByTestId('record-header');
    expect(within(header).getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /log activity/i })).toBeInTheDocument();
    await openRecordActions();
    expect(screen.getByRole('menuitem', { name: /^archive$/i })).toBeInTheDocument();
  });

  it('B5 Project Manager sees Edit and Log activity but no Archive under the real policy', () => {
    renderPage('Project Manager');
    const header = screen.getByTestId('record-header');
    expect(within(header).getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /log activity/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^archive$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument();
  });

  it('explains an unavailable company in visible text', () => {
    detailState.data = { ...contact, company_id: 'co-missing' };
    companiesState.data = [];
    companyRefState.isError = true;
    renderPage();
    expect(screen.getByText('This company is not in your company directory.')).toBeVisible();
  });

  it('CW-4b: shows the loading skeleton while the record is pending', () => {
    detailState.data = undefined;
    detailState.isPending = true;
    renderPage();
    expect(screen.getByTestId('contact-loading')).toBeInTheDocument();
  });

  it('CW-4b: shows a calm not-found state when the record is absent', () => {
    detailState.data = null;
    detailState.isPending = false;
    renderPage();
    expect(screen.getByTestId('contact-not-found')).toBeInTheDocument();
  });

  it('CW-4b: a transient load error offers Retry', async () => {
    detailState.data = undefined;
    detailState.isError = true;
    renderPage();
    const retry = screen.getByRole('button', { name: /retry|try again/i });
    await userEvent.click(retry);
    expect(detailState.refetch).toHaveBeenCalled();
  });

  it.each([
    ['loading', { data: undefined, isPending: true, isError: false }],
    ['not-found', { data: null, isPending: false, isError: false }],
    ['error', { data: undefined, isPending: false, isError: true }],
  ])('#707: the %s state shows the Back bar only at phone width (hidden on desktop)', (_n, s) => {
    Object.assign(detailState, s);
    renderPage();
    const bar = screen.getByRole('button', { name: /back to contacts/i }).parentElement!;
    expect(bar.className).toContain('hidden');
    expect(bar.className).toContain('max-[920px]:flex');
  });

  it('CW-4b: Back returns to the Contacts list', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /back to contacts/i }));
    expect(screen.getByText('Contacts index')).toBeInTheDocument();
  });

  it('CW-4b: renders the activity timeline section (moved off the retired drawer) — empty state when none', () => {
    activitiesState.data = [];
    renderPage();
    expect(screen.getByText(/no activity logged yet/i)).toBeInTheDocument();
  });

  it('CW-4b: renders logged activity in the timeline when present', () => {
    activitiesState.data = [
      { id: 'a1', kind: 'Call', subject: 'Kickoff call', body: 'Discussed scope', occurred_at: '2026-03-15T00:00:00Z' },
    ];
    renderPage();
    const timeline = screen.getByTestId('activity-timeline');
    expect(within(timeline).getByText('Kickoff call')).toBeInTheDocument();
    expect(within(timeline).getByText('Discussed scope')).toBeInTheDocument();
  });

  it('CW-4b: the activity timeline shows a loading skeleton while activities are pending', () => {
    activitiesState.isPending = true;
    activitiesState.data = [];
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('CW-4b: an activity load error offers Retry', async () => {
    activitiesState.isPending = false;
    activitiesState.isError = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(activitiesState.refetch).toHaveBeenCalled();
  });

  it('opens the activity form from the header and logs it on the selected date', async () => {
    renderPage('Admin');
    expect(screen.queryByLabelText(/subject/i)).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByTestId('record-header')).getByRole('button', { name: /log activity/i }));
    const date = '2026-06-14';
    const dateField = screen.getByLabelText(/^date$/i);
    fireEvent.change(dateField, { target: { value: date } });
    await userEvent.selectOptions(screen.getByLabelText(/activity type/i), 'Email');
    const subject = screen.getByLabelText(/subject/i);
    await userEvent.type(subject, 'Followup');
    await userEvent.type(screen.getByLabelText(/^notes$/i), 'Discussed next steps');
    const form = subject.closest('form')!;
    await userEvent.click(within(form).getByRole('button', { name: /log activity/i }));
    const input = mutations.logActivity.mutateAsync.mock.calls[0][0];
    expect(input).toEqual(expect.objectContaining({
      contact_id: 'ct1',
      kind: 'Email',
      subject: 'Followup',
      body: 'Discussed next steps',
      occurred_at: firstInstantOfZonedCalendarDay(date)?.toISOString(),
    }));
    expect(formatDay(input.occurred_at)).toBe(formatDay(date));
    expect(screen.queryByLabelText(/subject/i)).not.toBeInTheDocument();
  });

  it('CW-4b: a manager can open the edit modal from the header and save an update', async () => {
    companiesState.data = [
      { id: 'co1', name: 'Cascade Port Authority', type: 'Client' },
      { id: 'co2', name: 'Keystone Systems', type: 'Client' },
    ];
    renderPage('Admin');
    await openRecordActions();
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit contact/i });
    const nameField = within(dialog).getByLabelText(/full name/i);
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Jane Smith');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^company$/i), 'co2');
    const titleField = within(dialog).getByLabelText(/^title$/i);
    await userEvent.clear(titleField);
    await userEvent.type(titleField, 'Account Lead');
    const emailField = within(dialog).getByLabelText(/^email$/i);
    await userEvent.clear(emailField);
    await userEvent.type(emailField, 'jane.smith@example.com');
    const phoneField = within(dialog).getByLabelText(/^phone$/i);
    await userEvent.clear(phoneField);
    await userEvent.type(phoneField, '+1 555 010 1234');
    const notesField = within(dialog).getByLabelText(/^notes$/i);
    await userEvent.clear(notesField);
    await userEvent.type(notesField, 'Updated contact notes');
    await userEvent.click(within(dialog).getByRole('button', { name: /save contact/i }));
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({
      id: 'ct1',
      input: {
        full_name: 'Jane Smith',
        company_id: 'co2',
        title: 'Account Lead',
        email: 'jane.smith@example.com',
        phone: '+1 555 010 1234',
        notes: 'Updated contact notes',
      },
    });
  });

  it('retries company options from the edit form after the company directory fails', async () => {
    companiesState.data = [];
    companiesState.isError = true;
    renderPage('Admin');
    await openRecordActions();
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit contact/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /^retry$/i }));
    expect(companiesState.refetch).toHaveBeenCalled();
  });

  it('keeps mirrored contact details read-only and enhancements editable', async () => {
    setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]);
    renderPage('Admin');
    await openRecordActions();
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit contact/i });
    for (const label of [/full name/i, /^company/i, /^email/i, /^phone/i]) {
      expect(within(dialog).getByLabelText(label)).toBeDisabled();
    }
    expect(within(dialog).getByLabelText(/^title/i)).toBeEnabled();
    expect(within(dialog).getByLabelText(/^notes/i)).toBeEnabled();
    clearOwnershipCache();
  });

  it('preserves unsaved contact identity edits when ownership changes', async () => {
    renderPage('Admin');
    await openRecordActions();
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit contact/i });
    const name = within(dialog).getByLabelText(/full name/i);
    await userEvent.clear(name);
    await userEvent.type(name, 'Jane Reyes');
    act(() => setTaskOwnership([{ domain: 'companies', externalTier: 'erpnext' }]));
    expect(within(dialog).getByRole('button', { name: /save contact/i })).toBeDisabled();
  });

  it('CW-4b: a manager can archive from the header (confirm-before-write)', async () => {
    renderPage('Admin');
    await openRecordActions();
    await userEvent.click(screen.getByTestId('contact-archive'));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Jane Doe?' });
    await userEvent.click(within(dialog).getByRole('button', { name: /archive contact/i }));
    expect(mutations.archive.mutateAsync).toHaveBeenCalledWith('ct1');
  });

  it('CW-4b: an Engineer (no contact access) sees the access-denied surface, not the record', () => {
    renderPage('Engineer');
    expect(screen.getByText(/don't have access to contacts/i)).toBeInTheDocument();
    expect(screen.queryByTestId('record-header')).toBeNull();
  });
});

// list-working-set-return (#683, AC-LRC-007): the mobile BackBar honours a validated captured
// Contacts context and falls back to the bare index for a direct/copied link.
describe('ContactDetail — list-return context (AC-LRC-007)', () => {
  it('AC-LRC-007: a record opened from a narrowed Contacts list returns to that SAME filtered URL', async () => {
    renderPageWithReturnContext();
    await userEvent.click(screen.getByRole('button', { name: /back to contacts/i }));
    expect(screen.getByTestId('Contacts index-probe')).toHaveTextContent(
      'Contacts index?company=22222222-2222-4222-8222-222222222222',
    );
  });

  it('AC-LRC-007: archive-success also returns to the SAME filtered list context, not a bare reset', async () => {
    renderPageWithReturnContext();
    await openRecordActions();
    await userEvent.click(screen.getByTestId('contact-archive'));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Jane Doe?' });
    await userEvent.click(within(dialog).getByRole('button', { name: /archive contact/i }));
    await screen.findByTestId('Contacts index-probe');
    expect(screen.getByTestId('Contacts index-probe')).toHaveTextContent(
      'Contacts index?company=22222222-2222-4222-8222-222222222222',
    );
  });

  it('FR-LRC-004: the Contact→Company related link is a plain Link: it never carries the Contacts return context', async () => {
    renderPageWithReturnContext();
    await userEvent.click(screen.getByRole('link', { name: /Cascade Port Authority/i }));
    // Lands on the company record with NO location.state carrying the Contacts return context.
    const probe = screen.getByTestId('Company record-probe');
    const state = JSON.parse(probe.dataset.state || 'null');
    expect(state?.pmoListReturn?.list).not.toBe('contacts');
  });
});

// C13 (DS contact-record #1): an archived contact's record must not look exactly like an active one.
describe('ContactDetail — C13 known fact shown', () => {
  it('says an archived contact is archived, in place of the categorical pill', () => {
    detailState.data = { ...contact, archived_at: '2026-03-01T00:00:00Z' };
    renderPage();
    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Archived')).toBeInTheDocument();
    expect(within(header).queryByText('Contact')).not.toBeInTheDocument();
  });
});
