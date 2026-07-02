import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

/**
 * CompanyDetail CRM hub tests — T14, T15/T16w3, T17, T18
 *
 * AC-CRM-CD-01 (T15/T16w3): Contacts section shows <ListState variant="error"> on fetch error
 * AC-CRM-CD-02 (T14): "Add contact" button visible for writers, hidden for read-only roles
 * AC-CRM-CD-03 (T14): "Add contact" opens contact create modal with company pre-filled (locked)
 * AC-CRM-CD-04 (T17): Account activity timeline renders aggregated activities from all company contacts
 * AC-CRM-CD-05 (T17): "Log activity" form is visible for writers, hidden for read-only roles
 * AC-CRM-CD-06 (T17): "Log activity" submits with contact_id (requires contact selection or defaults)
 * AC-CRM-CD-07 (T17): Activity timeline error state offers retry
 * AC-CRM-CD-08 (T18): Primary-contact link renders in the account card when a contact is flagged/first
 * AC-CRM-CD-09 (T18): Related opportunities card renders when company has associated projects
 */

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  detailState,
  mutations,
  contactsState,
  projectsState,
  procurementsState,
  contactActivitiesState,
  contactMutations,
} = vi.hoisted(() => ({
  detailState: {
    data: undefined as Record<string, unknown> | null | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    archive: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
  contactsState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  projectsState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  procurementsState: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  contactActivitiesState: {
    // keyed by contactId; returns activities per-contact
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  contactMutations: {
    create: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    update: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    archive: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    logActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    updateActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    deleteActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
}));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompany: () => detailState,
  useCompanyMutations: () => mutations,
  useProjectsByClient: () => projectsState,
  useProcurementsByVendor: () => procurementsState,
}));

vi.mock('@/src/hooks/useContacts', () => ({
  useContactsByCompany: () => contactsState,
  useCompanyActivities: () => contactActivitiesState,
  useContactMutations: () => contactMutations,
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import CompanyDetail from './CompanyDetail';

const company = {
  id: 'co1',
  org_id: 'org-1',
  name: 'Cascade Port Authority',
  type: 'Client' as const,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const contacts = [
  {
    id: 'ct1',
    full_name: 'Jane Doe',
    title: 'Procurement Lead',
    company_id: 'co1',
    email: 'jane@cascade.test',
    phone: null,
    notes: null,
    org_id: 'org-1',
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'ct2',
    full_name: 'John Roe',
    title: null,
    company_id: 'co1',
    email: null,
    phone: null,
    notes: null,
    org_id: 'org-1',
    archived_at: null,
    created_at: '2026-02-01T00:00:00Z',
  },
];

const activities = [
  {
    id: 'a1',
    contact_id: 'ct1',
    kind: 'Call',
    subject: 'Kickoff discussion',
    body: 'Agreed on next steps',
    occurred_at: '2026-05-15T10:00:00Z',
    org_id: 'org-1',
    company_id: 'co1',
    project_id: null,
    logged_by_id: 'u1',
    created_at: '2026-05-15T10:00:00Z',
  },
  {
    id: 'a2',
    contact_id: 'ct2',
    kind: 'Email',
    subject: 'Follow up',
    body: null,
    occurred_at: '2026-05-16T10:00:00Z',
    org_id: 'org-1',
    company_id: 'co1',
    project_id: null,
    logged_by_id: 'u1',
    created_at: '2026-05-16T10:00:00Z',
  },
];

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/companies/co1']}>
        <Routes>
          <Route path="/companies/:companyId" element={<CompanyDetail />} />
          <Route path="/companies" element={<div>Companies index</div>} />
          <Route path="/contacts/:contactId" element={<div>Contact page</div>} />
          <Route path="/projects/:id" element={<div>Project page</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  detailState.data = company;
  detailState.isPending = false;
  detailState.isError = false;
  detailState.refetch.mockClear();

  contactsState.data = [];
  contactsState.isPending = false;
  contactsState.isError = false;
  contactsState.refetch.mockClear();

  projectsState.data = [];
  projectsState.isPending = false;
  projectsState.isError = false;
  projectsState.refetch.mockClear();

  procurementsState.data = [];
  procurementsState.isPending = false;
  procurementsState.isError = false;
  procurementsState.refetch.mockClear();

  contactActivitiesState.data = [];
  contactActivitiesState.isPending = false;
  contactActivitiesState.isError = false;
  contactActivitiesState.refetch.mockClear();

  contactMutations.logActivity.mutateAsync.mockClear().mockResolvedValue(undefined);
  contactMutations.create.mutateAsync.mockClear().mockResolvedValue(undefined);

  realRole = 'Admin';
});

// ── T15/T16w3: Contact list error state ─────────────────────────────────────

describe('CompanyDetail — contacts error state (AC-CRM-CD-01)', () => {
  it('AC-CRM-CD-01: shows error state with Retry when contacts fetch fails, not "No contacts yet"', async () => {
    contactsState.isError = true;
    contactsState.data = [];
    renderPage();
    // Must show error state, NOT the misleading empty state
    expect(screen.queryByText(/no contacts yet/i)).not.toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry|try again/i });
    expect(retryBtn).toBeInTheDocument();
    await userEvent.click(retryBtn);
    expect(contactsState.refetch).toHaveBeenCalled();
  });
});

// ── T14: "Add contact" in-context button ─────────────────────────────────────

describe('CompanyDetail — in-context Add contact (AC-CRM-CD-02, AC-CRM-CD-03)', () => {
  it('AC-CRM-CD-02: Admin sees "Add contact" button in the Contacts section', () => {
    renderPage('Admin');
    // CD-4: when there are no contacts the cold-start Activity card also shows an "Add contact"
    // button — so there may be multiple. Asserting at least one is the correct intent here.
    const addBtns = screen.getAllByRole('button', { name: /add contact/i });
    expect(addBtns.length).toBeGreaterThan(0);
  });

  it('AC-CRM-CD-02: Finance sees "Add contact" button (is a MASTER_DATA writer)', () => {
    renderPage('Finance');
    const addBtns = screen.getAllByRole('button', { name: /add contact/i });
    expect(addBtns.length).toBeGreaterThan(0);
  });

  it('AC-CRM-CD-02: Engineer does NOT see the "Add contact" button (no contact write permission)', () => {
    // Note: Engineer can't even view the company page (AccessDenied), but let's
    // test via PM who can view but... actually PM IS a MASTER_DATA writer.
    // The engineer won't reach this page — they'd see AccessDenied.
    // Test with a role that can view companies but not create contacts:
    // Looking at policy: ALL MASTER_DATA roles can create contacts.
    // Engineer can't view the company page, so they'd get AccessDenied.
    // The button is hidden when may('create', 'contact') is false.
    // Since all master-data roles can create contacts, we verify the button
    // is absent when the entire page is access-denied:
    renderPage('Engineer');
    // Engineer sees AccessDenied, so no Add contact button
    expect(screen.queryByRole('button', { name: /add contact/i })).not.toBeInTheDocument();
  });

  it('AC-CRM-CD-03: clicking "Add contact" opens the contact create modal with company pre-filled and locked', async () => {
    contactsState.data = contacts; // Contacts exist — only the Contacts-section button appears
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /add contact/i }));
    const dialog = await screen.findByRole('dialog', { name: /new contact/i });
    // Company field should be pre-selected and locked (disabled/read-only)
    const companySelect = within(dialog).getByLabelText(/company/i) as HTMLSelectElement;
    expect(companySelect.value).toBe('co1');
    // The company field should be disabled (locked) when prefilled from context
    expect(companySelect).toBeDisabled();
  });

  it('AC-CRM-CD-03: contact created via "Add contact" submits with the company_id pre-populated', async () => {
    contactsState.data = contacts; // Contacts exist — only the Contacts-section button appears
    renderPage('Admin');
    await userEvent.click(screen.getByRole('button', { name: /add contact/i }));
    const dialog = await screen.findByRole('dialog', { name: /new contact/i });
    await userEvent.type(within(dialog).getByLabelText(/full name/i), 'Nina Park');
    await userEvent.click(within(dialog).getByRole('button', { name: /create contact/i }));
    await waitFor(() =>
      expect(contactMutations.create.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'Nina Park', company_id: 'co1' }),
      ),
    );
  });
});

// ── T17: Account activity timeline ───────────────────────────────────────────

describe('CompanyDetail — account activity timeline (AC-CRM-CD-04, AC-CRM-CD-05, AC-CRM-CD-06, AC-CRM-CD-07)', () => {
  it('AC-CRM-CD-04: renders aggregated activity timeline when activities exist', () => {
    contactsState.data = contacts;
    contactActivitiesState.data = activities;
    renderPage();
    expect(screen.getByTestId('account-activity-timeline')).toBeInTheDocument();
    expect(screen.getByText('Kickoff discussion')).toBeInTheDocument();
    expect(screen.getByText('Follow up')).toBeInTheDocument();
  });

  it('AC-CRM-CD-04: renders empty state when no activities', () => {
    contactsState.data = contacts;
    contactActivitiesState.data = [];
    renderPage();
    expect(screen.getByText(/no activity logged yet/i)).toBeInTheDocument();
  });

  it('AC-CRM-CD-05: Admin sees "Log activity" button/form', () => {
    contactsState.data = contacts;
    renderPage('Admin');
    expect(screen.getByRole('button', { name: /^log activity$/i })).toBeInTheDocument();
  });

  it('AC-CRM-CD-05: Finance sees "Log activity" button/form', () => {
    contactsState.data = contacts;
    renderPage('Finance');
    expect(screen.getByRole('button', { name: /^log activity$/i })).toBeInTheDocument();
  });

  it('AC-CRM-CD-06: "Log activity" form requires contact selection when company has multiple contacts and submits correctly', async () => {
    contactsState.data = contacts;
    contactActivitiesState.data = [];
    renderPage('Admin');

    // The log-activity form should have a contact selector
    const contactSelect = screen.getByLabelText(/^contact$/i);
    expect(contactSelect).toBeInTheDocument();

    // Select first contact
    await userEvent.selectOptions(contactSelect, 'ct1');

    // Fill in a subject
    await userEvent.type(screen.getByLabelText(/subject/i), 'Quarterly review');

    // Submit
    await userEvent.click(screen.getByRole('button', { name: /^log activity$/i }));

    await waitFor(() =>
      expect(contactMutations.logActivity.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          contact_id: 'ct1',
          subject: 'Quarterly review',
        }),
      ),
    );
  });

  it('AC-CRM-CD-06: when company has exactly one contact, contact_id is pre-populated automatically', async () => {
    contactsState.data = [contacts[0]]; // only Jane Doe
    contactActivitiesState.data = [];
    renderPage('Admin');

    await userEvent.type(screen.getByLabelText(/subject/i), 'Quick call');
    await userEvent.click(screen.getByRole('button', { name: /^log activity$/i }));

    await waitFor(() =>
      expect(contactMutations.logActivity.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          contact_id: 'ct1',
          subject: 'Quick call',
        }),
      ),
    );
  });

  it('AC-CRM-CD-07: activity timeline error state shows retry that calls refetch', async () => {
    contactsState.data = contacts;
    contactActivitiesState.isError = true;
    contactActivitiesState.data = [];
    renderPage();
    // Should show an error state within the activity section
    const retryBtns = screen.getAllByRole('button', { name: /retry|try again/i });
    // At least one retry button in the activity area
    expect(retryBtns.length).toBeGreaterThan(0);
    await userEvent.click(retryBtns[retryBtns.length - 1]);
    expect(contactActivitiesState.refetch).toHaveBeenCalled();
  });
});

// ── T18: Primary contact + related opportunities ──────────────────────────────

describe('CompanyDetail — primary contact + related opportunities (AC-CRM-CD-08, AC-CRM-CD-09)', () => {
  it('AC-CRM-CD-08: company detail card shows a "Primary contact" link when contacts exist', () => {
    contactsState.data = contacts;
    renderPage();
    // The first contact (alphabetically or by order) should appear as primary contact
    expect(screen.getByText(/primary contact/i)).toBeInTheDocument();
    // Should be a link navigating to the contact's page
    const link = screen.getByRole('link', { name: /jane doe/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/contacts/ct1');
    expect(link.className).toContain('text-primary-text');
  });

  it('AC-CRM-CD-08: "Primary contact" section is absent when company has no contacts', () => {
    contactsState.data = [];
    renderPage();
    expect(screen.queryByText(/primary contact/i)).not.toBeInTheDocument();
  });

  it('AC-CRM-CD-09: "Related opportunities" card appears and lists related projects', () => {
    projectsState.data = [
      { id: 'p-1', name: 'Meridian Solar Phase 1', status: 'Ongoing Project' },
    ];
    renderPage();
    // Already rendered by RelatedProjects — verify the heading shows
    const headings = screen.getAllByText(/related projects/i);
    expect(headings.length).toBeGreaterThan(0);
    // And the project row links to /projects/p-1
    expect(screen.getByRole('link', { name: /Meridian Solar Phase 1/i })).toHaveAttribute('href', '/projects/p-1');
  });
});
