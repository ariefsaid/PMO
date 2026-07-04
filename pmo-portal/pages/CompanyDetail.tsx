import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  RecordHeader,
  Card,
  CardHead,
  CardPad,
  Button,
  Icon,
  StatusPill,
  ListState,
  ConfirmDialog,
  AccessDenied,
  EntityFormModal,
  TextField,
  TextArea,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
  useToast,
  ContactNameLink,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import {
  useCompany,
  useCompanyMutations,
  useProjectsByClient,
  useProcurementsByVendor,
} from '@/src/hooks/useCompanies';
import {
  useContactsByCompany,
  useCompanyActivities,
  useContactMutations,
} from '@/src/hooks/useContacts';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { companyTypeVariant, workflowVariant, crmActivityVariant } from '@/src/lib/status/statusVariants';
import type { CompanyType, CompanyInput } from '@/src/lib/db/companies';
import type { CrmActivityKind, CrmActivityInput, CrmActivityRow } from '@/src/lib/db/crmActivities';
import type { ContactInput } from '@/src/lib/db/contacts';

/**
 * CompanyDetail — the routable `/companies/:id` master-data record page (CW-4b).
 *
 * Fixes the audit's #1 P1 rupture: companies were URL-less drawer-as-record overlays while
 * transactional records (Projects, Procurement, Incidents) are navigable pages. Mirrors the
 * CW-4a `IncidentDetail` pattern exactly — the shared `RecordHeader` (page variant: icon + name
 * + the categorical company-type pill via the CW-2 `companyTypeVariant` registry + the role-allowed
 * Edit/Archive action zone), a `BackBar` "Back to Companies", read-only field sections with
 * edit-in-modal, and the FR-CRM-008 Contacts list moved off the retired drawer onto the page.
 * RLS is the enforcement authority; `can()` (via `usePermission`) gates affordances for clarity.
 *
 * JTBD T14: in-context "Add contact" in the Contacts card head — opens the contact create modal
 * with company_id pre-filled + locked (the user is already on a company page).
 * JTBD T15/T16w3: Contacts section shows a proper error state (not "No contacts yet") on fetch error.
 * JTBD T17: Account activity timeline — aggregates crm_activities across all company contacts.
 * JTBD T18: Primary-contact link on the account card + related projects (RelatedList already renders).
 */
const TYPE_OPTIONS = [
  { value: 'Client', label: 'Client' },
  { value: 'Vendor', label: 'Vendor' },
  { value: 'Internal', label: 'Internal' },
];

const KIND_OPTIONS = [
  { value: 'Call', label: 'Call' },
  { value: 'Email', label: 'Email' },
  { value: 'Meeting', label: 'Meeting' },
  { value: 'Note', label: 'Note' },
];

const CompanyDetail: React.FC = () => {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();

  const query = useCompany(companyId);
  const { update, archive } = useCompanyMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  // T14: "Add contact" modal state
  const [addContactOpen, setAddContactOpen] = useState(false);

  // Master-data directory access = Admin·Exec·PM·Finance (rbac-visibility §D); Engineer = ○.
  // The rail hides Companies for an Engineer but the ROUTE does not — so an Engineer reaching
  // /companies/:id by URL gets a clean access-denied surface, not the record. RLS is the row
  // authority; this is FE clarity (mirrors Companies.tsx).
  const canView = may('view', 'company');
  const canEdit = may('edit', 'company');
  const canArchive = may('archive', 'company');
  const canCreateContact = may('create', 'contact');

  const goBack = () => navigate('/companies');

  // A-5 page view-gate (before the hooks-dependent branches; the hooks above already ran so
  // Rules of Hooks hold) — a denied role gets the shared access-denied surface.
  if (!canView) {
    return (
      <AccessDenied
        title="You don't have access to Companies"
        sub="The company directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks."
        onBack={() => navigate('/')}
      />
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (query.isPending) {
    return (
      <>
        <BackBar label="Companies" onBack={goBack} />
        <div data-testid="company-loading">
          <ListState variant="loading" rows={5} />
        </div>
      </>
    );
  }

  // ── Error (a genuine transient failure — offer Retry) ─────────────────────
  if (query.isError) {
    return (
      <>
        <BackBar label="Companies" onBack={goBack} />
        <ListState
          variant="error"
          title="Couldn't load company"
          sub="Something went wrong fetching this company."
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  // ── Not found / no access — a calm empty state (RLS scoped it out, or a bad id) ──
  const company = query.data;
  if (!company) {
    return (
      <>
        <BackBar label="Companies" onBack={goBack} />
        <div data-testid="company-not-found">
          <ListState
            variant="empty"
            icon="folder"
            title="Company not found"
            sub="This company either doesn't exist or isn't visible to you. Return to the directory to find it."
          />
        </div>
      </>
    );
  }

  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  const onArchiveConfirm = async () => {
    try {
      await archive.mutateAsync(company.id);
      toast('Company archived', company.name, 'success');
      setArchiveOpen(false);
      // Archived records drop out of the default directory — return there.
      navigate('/companies');
    } catch (err) {
      onMutationError(err);
    }
  };

  const hasActions = canEdit || canArchive;

  return (
    <div>
      {/* Mobile escape route — the top-bar breadcrumb owns desktop wayfinding, the rail
          collapses ≤920px so the BackBar is the only in-content escape there. */}
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block">
        <BackBar label="Companies" onBack={goBack} />
      </div>

      {/* The ONE RecordHeader anatomy — icon + name + categorical company-type pill (CW-2
          registry) + the role-allowed action zone (Edit + Archive). */}
      <RecordHeader
        name={company.name}
        icon={(company.name.trim().charAt(0) || '•').toUpperCase()}
        status={<StatusPill variant={companyTypeVariant(company.type)}>{company.type}</StatusPill>}
        actions={
          hasActions ? (
            <>
              {canEdit && (
                <Button variant="outline" size="sm" data-testid="company-edit" onClick={() => setEditOpen(true)}>
                  Edit
                </Button>
              )}
              {canArchive && (
                <Button variant="ghost" size="sm" data-testid="company-archive" onClick={() => setArchiveOpen(true)}>
                  Archive
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {/* Body — the company's fields (read-only; edit-in-modal). */}
      <Card variant="bare" className="mb-4">
        <CardHead>Company detail</CardHead>
        <CardPad>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label="Name" value={company.name} />
            <Field label="Type" value={company.type} />
            {/* T18: Primary contact link — rendered in the account card when contacts exist. */}
            <PrimaryContactField companyId={company.id} />
          </dl>
        </CardPad>
      </Card>

      {/* AC-IFW-COMPANY-01 + AC-G3C-CD-3: related projects (always) and procurement
          (always fetch; visible for Vendors or any type when vendor PRs exist). */}
      <RelatedProjects companyId={company.id} />
      <RelatedProcurement companyId={company.id} isVendor={company.type === 'Vendor'} />

      {/* T17: Account-level activity timeline — aggregated across all company contacts.
          CD-4: pass the add-contact opener so the cold-start card can surface it. */}
      <AccountActivityCard
        companyId={company.id}
        onAddContact={canCreateContact ? () => setAddContactOpen(true) : undefined}
      />

      {/* FR-CRM-008: the company's non-archived contacts — moved here off the retired drawer.
          T14: "Add contact" in-context button in the CardHead (CanWrite-gated). */}
      <Card variant="bare">
        <CardHead className="flex items-center justify-between">
          <span>Contacts</span>
          {canCreateContact && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddContactOpen(true)}
            >
              <Icon name="plus" />
              Add contact
            </Button>
          )}
        </CardHead>
        <CardPad>
          <CompanyContactsList companyId={company.id} />
        </CardPad>
      </Card>

      {/* T14: Add contact modal — company_id pre-filled and locked. */}
      {addContactOpen && (
        <AddContactForCompanyModal
          companyId={company.id}
          companyName={company.name}
          onClose={() => setAddContactOpen(false)}
          onSuccess={() => {
            setAddContactOpen(false);
            toast('Contact created', '', 'success');
          }}
          onError={onMutationError}
        />
      )}

      {/* Edit modal — reuses the shared create/edit form. */}
      {editOpen && (
        <CompanyEditModal
          company={company}
          onClose={() => setEditOpen(false)}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast('Company updated', input.name, 'success');
            setEditOpen(false);
          }}
          onError={onMutationError}
        />
      )}

      {/* Archive confirm (default tone — reversible soft-archive, ADR-0018). */}
      <ConfirmDialog
        open={archiveOpen}
        tone="default"
        title={`Archive ${company.name}?`}
        description="It will be hidden from the default list and can't be selected on new records. Existing references stay intact. You can restore it any time."
        confirmLabel="Archive company"
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveOpen(false)}
      />
    </div>
  );
};

/** A labelled read-only field (definition-list row) — body field primitive for the record page. */
const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
      {label}
    </dt>
    <dd className="text-[13.5px] text-foreground">{value}</dd>
  </div>
);

// ── T18: Primary contact field ─────────────────────────────────────────────────

/**
 * AC-CRM-CD-08: renders a "Primary contact" link in the account card when the company
 * has at least one contact. Uses the first contact from useContactsByCompany (sorted
 * alphabetically by the DAL). Absent when there are no contacts.
 */
const PrimaryContactField: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { data, isPending } = useContactsByCompany(companyId);
  if (isPending || !data || data.length === 0) return null;
  const primary = data[0];
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        Primary contact
      </dt>
      <dd className="text-[13.5px] text-foreground">
        <Link
          to={`/contacts/${primary.id}`}
          className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {primary.full_name}
        </Link>
      </dd>
    </div>
  );
};

// ── RelatedList — shared presentational component for related-object lists ───
//
// AC-IFW-COMPANY-01: eliminates the ~45-line duplication between RelatedProjects
// and RelatedProcurement. Both sections share the same load/empty/error/list shape;
// the only differences are the card heading, the empty label, the link href, and
// which text fields to display (title vs name, optional subtitle).

interface RelatedItem {
  id: string;
  title: string;
  subtitle?: string | null;
}

interface RelatedListProps {
  heading: string;
  items: RelatedItem[];
  isPending: boolean;
  isError: boolean;
  hrefFor: (id: string) => string;
  emptyLabel: string;
  listAriaLabel: string;
  onRetry?: () => void;
}

/**
 * Presentational list for "related objects" cards (AC-IFW-COMPANY-01). Handles
 * loading / empty / error / populated states via the shared `ListState` component.
 * Each item renders as a Link row. The card wrapper and gating (Vendor-only etc.)
 * remain with the calling component.
 */
const RelatedList: React.FC<RelatedListProps> = ({
  heading,
  items,
  isPending,
  isError,
  hrefFor,
  emptyLabel,
  listAriaLabel,
  onRetry,
}) => (
  <Card variant="bare" className="mb-4">
    <CardHead>{heading}</CardHead>
    <CardPad>
      {isPending && <ListState variant="loading" rows={2} />}
      {isError && !isPending && (
        <ListState
          variant="error"
          title={`Couldn't load ${heading.toLowerCase()}`}
          sub="Something went wrong. Try again."
          onRetry={onRetry}
        />
      )}
      {!isPending && !isError && items.length === 0 && (
        <p className="text-[13px] text-muted-foreground">{emptyLabel}</p>
      )}
      {!isPending && !isError && items.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={listAriaLabel}>
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={hrefFor(item.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="text-[14px] font-medium text-foreground">{item.title}</span>
                {item.subtitle && (
                  /* Fix #9 — Tinted-Status rule: status must be a dot+pill, never bare grey text. */
                  <StatusPill variant={workflowVariant(item.subtitle)}>
                    {item.subtitle}
                  </StatusPill>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardPad>
  </Card>
);

/**
 * AC-IFW-COMPANY-01: Related projects list (client view). Shows all projects where the
 * company is the client — clickable rows that navigate to /projects/:id. Always rendered.
 */
const RelatedProjects: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { data, isPending, isError, refetch } = useProjectsByClient(companyId);
  const items = (data ?? []).map((p) => ({ id: p.id, title: p.name, subtitle: p.status ?? null }));

  return (
    <RelatedList
      heading="Related projects"
      items={items}
      isPending={isPending}
      isError={isError}
      hrefFor={(id) => `/projects/${id}`}
      emptyLabel="No related projects yet"
      listAriaLabel="Related projects"
      onRetry={() => refetch()}
    />
  );
};

/**
 * AC-IFW-COMPANY-01 + AC-G3C-CD-3: Related procurement list. Shows all PRs where the company
 * is the vendor — clickable rows that navigate to /procurement/:id.
 *
 * CD-3 fix: no longer gated solely on `type==='Vendor'` — renders for ANY company type when
 * `useProcurementsByVendor` returns rows (dual-role accounts have vendor PRs even when typed
 * "Client"). For Vendor companies the card always renders (showing empty state if none). For
 * non-Vendor companies the card is suppressed when genuinely empty (hide-when-empty).
 */
const RelatedProcurement: React.FC<{ companyId: string; isVendor: boolean }> = ({ companyId, isVendor }) => {
  const { data, isPending, isError, refetch } = useProcurementsByVendor(companyId);
  const items = (data ?? []).map((pr) => ({ id: pr.id, title: pr.title, subtitle: pr.status ?? null }));

  // For non-Vendor companies suppress the card when there are no rows (genuinely empty).
  // Vendor companies always show the card so they can see "No procurement yet" clearly.
  if (!isVendor && !isPending && !isError && items.length === 0) return null;

  return (
    <RelatedList
      heading="Procurement"
      items={items}
      isPending={isPending}
      isError={isError}
      hrefFor={(id) => `/procurement/${id}`}
      emptyLabel="No procurement yet"
      listAriaLabel="Procurement list"
      onRetry={() => refetch()}
    />
  );
};

/**
 * FR-CRM-008: read-only contacts list for the company record page.
 *
 * T15/T16w3: Shows an error state (not the misleading "No contacts yet") when the
 * fetch fails, with a Retry action. Consumes the pre-wired `useContactsByCompany` hook
 * (AC-CRM-021) — handles loading, empty, error, and populated states. Each row links
 * to the routable `/contacts/:id` page (CW-4b — the master-data graph is navigable).
 */
const CompanyContactsList: React.FC<{ companyId: string }> = ({ companyId }) => {
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useContactsByCompany(companyId);

  if (isPending) {
    return (
      <p role="status" aria-label="Loading contacts" className="text-[13px] text-muted-foreground">
        Loading…
      </p>
    );
  }

  // T15/T16w3: on fetch error, show the error state (not "No contacts yet").
  if (isError) {
    return (
      <ListState
        variant="error"
        title="Couldn't load contacts"
        sub="Something went wrong. Try again."
        onRetry={() => refetch()}
      />
    );
  }

  const contacts = data ?? [];

  if (contacts.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No contacts yet</p>;
  }

  return (
    <ul className="flex flex-col gap-1" aria-label="Contacts list">
      {contacts.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => navigate(`/contacts/${c.id}`)}
            className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={`Open ${c.full_name}`}
          >
            <span className="text-[14px] font-medium text-foreground">{c.full_name}</span>
            {c.title && <span className="text-[12px] text-muted-foreground">{c.title}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
};

// ── T17: Account activity timeline ────────────────────────────────────────────

const formatOccurred = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/**
 * T17: Account-level activity timeline card. Aggregates crm_activities across ALL of
 * this company's contacts client-side (fan-in via useCompanyActivities). Includes a
 * gated "Log activity" form — since crm_activities.contact_id is NOT NULL, the form
 * requires/defaults to a contact of this company.
 *
 * CD-4: when the company has no contacts (cold-start), renders an empty Activity card
 * with a prompt whose button opens the Add-contact modal (via the `onAddContact` callback).
 */
const AccountActivityCard: React.FC<{ companyId: string; onAddContact?: () => void }> = ({
  companyId,
  onAddContact,
}) => {
  const may = usePermission();
  const { toast } = useToast();
  const { data: contacts, isPending: contactsPending } = useContactsByCompany(companyId);
  const contactList = useMemo(() => contacts ?? [], [contacts]);
  const contactIds = useMemo(() => contactList.map((c) => c.id), [contactList]);

  const { data, isPending, isError, refetch } = useCompanyActivities(contactIds);
  const { logActivity, updateActivity, deleteActivity } = useContactMutations();
  const canLog = may('create', 'contactActivity');
  const canEdit = may('edit', 'contactActivity');
  const canDelete = may('delete', 'contactActivity');

  const activities = data ?? [];

  // CD-2 (AC-JR-W3B-E1): lookup map from contact_id → {id, name} for activity row links.
  const contactById = useMemo(
    () => new Map(contactList.map((c) => [c.id, c])),
    [contactList],
  );

  // Log-activity form state
  const [kind, setKind] = useState<CrmActivityKind>('Call');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // When there's more than one contact the user must pick; with a single contact we
  // pre-populate and hide the selector.
  const [selectedContactId, setSelectedContactId] = useState<string>('');

  // Edit/delete state for activity rows (CD-1)
  const [editingActivity, setEditingActivity] = useState<CrmActivityRow | null>(null);
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);

  // When contactList changes, auto-select the first contact if there's only one.
  const effectiveContactId = contactList.length === 1 ? contactList[0].id : selectedContactId;

  const contactOptions = useMemo(
    () => contactList.map((c) => ({ value: c.id, label: c.full_name })),
    [contactList],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!subject.trim() && !body.trim()) || !effectiveContactId) return;
    const input: CrmActivityInput = {
      contact_id: effectiveContactId,
      kind,
      subject: subject.trim() || null,
      body: body.trim() || null,
      occurred_at: new Date().toISOString(),
      company_id: companyId,
      project_id: null,
    };
    try {
      await logActivity.mutateAsync(input);
      toast('Activity logged', subject.trim() || kind, 'success');
      setSubject('');
      setBody('');
      setKind('Call');
      setSelectedContactId('');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onDeleteConfirm = async () => {
    if (!deletingActivityId) return;
    try {
      await deleteActivity.mutateAsync(deletingActivityId);
      toast('Activity deleted', '', 'success');
      setDeletingActivityId(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  // Don't render the card until we know if there are any contacts (to avoid a flash).
  if (contactsPending) return null;

  // CD-4: contactless company — show an empty Activity card with a cold-start prompt
  // instead of returning null (which was a dead-end for first-time setup).
  if (contactList.length === 0 && activities.length === 0) {
    return (
      <Card variant="bare" className="mb-4">
        <CardHead>Activity</CardHead>
        <CardPad>
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-4 py-8 text-center">
            <p className="text-[13px] text-muted-foreground">
              Add a contact to start logging activity
            </p>
            {onAddContact && (
              <Button variant="outline" size="sm" onClick={onAddContact}>
                <Icon name="plus" />
                Add contact
              </Button>
            )}
          </div>
        </CardPad>
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <CardHead>Activity</CardHead>
      <CardPad>
        {/* Log-activity form (gated by contactActivity create permission) */}
        {canLog && contactList.length > 0 && (
          <form
            onSubmit={onSubmit}
            className="mb-5 flex flex-col gap-3 rounded-md border border-border bg-card p-3"
          >
            <FormGrid>
              <SelectField
                label="Activity type"
                value={kind}
                onChange={(v) => setKind(v as CrmActivityKind)}
                options={KIND_OPTIONS}
              />
              {/* Contact selector: shown only when there are multiple contacts */}
              {contactList.length > 1 && (
                <SelectField
                  label="Contact"
                  value={selectedContactId}
                  onChange={setSelectedContactId}
                  options={[{ value: '', label: 'Select a contact…' }, ...contactOptions]}
                />
              )}
              <TextField
                label="Subject"
                value={subject}
                onChange={setSubject}
                placeholder="e.g. Kickoff call"
              />
            </FormGrid>
            <TextArea
              label="Notes"
              value={body}
              onChange={setBody}
              rows={2}
              fullWidth
              placeholder="What was discussed?"
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={logActivity.isPending}
                disabled={(!subject.trim() && !body.trim()) || !effectiveContactId}
              >
                Log activity
              </Button>
            </div>
          </form>
        )}

        {isPending && <ListState variant="loading" rows={3} />}

        {!isPending && isError && (
          <ListState
            variant="error"
            title="Couldn't load activity"
            sub="The request failed. Try again."
            onRetry={() => refetch()}
          />
        )}

        {!isPending && !isError && activities.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
            No activity logged yet.
          </p>
        )}

        {!isPending && !isError && activities.length > 0 && (
          <ol data-testid="account-activity-timeline" className="flex flex-col gap-3">
            {activities.map((a) => {
              const contact = contactById.get(a.contact_id);
              return (
                <li
                  key={a.id}
                  className="flex flex-col gap-1 rounded-md border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <StatusPill variant={crmActivityVariant(a.kind)}>{a.kind}</StatusPill>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-muted-foreground">
                        {formatOccurred(a.occurred_at)}
                      </span>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Edit activity"
                          onClick={() => setEditingActivity(a)}
                        >
                          <Icon name="pencil" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Delete activity"
                          onClick={() => setDeletingActivityId(a.id)}
                        >
                          <Icon name="trash" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* CD-2 (AC-JR-W3B-E1): contact name links to /contacts/:id */}
                  {contact && (
                    <ContactNameLink
                      contactId={contact.id}
                      name={contact.full_name}
                      className="text-[11px]"
                    />
                  )}
                  {a.subject && (
                    <span className="text-[13.5px] font-medium text-foreground">{a.subject}</span>
                  )}
                  {a.body && <p className="text-[13px] text-muted-foreground">{a.body}</p>}
                </li>
              );
            })}
          </ol>
        )}

        {/* Edit activity modal (CD-1) */}
        {editingActivity && (
          <AccountEditActivityModal
            activity={editingActivity}
            contactOptions={contactOptions}
            onClose={() => setEditingActivity(null)}
            onSave={async (patch) => {
              await updateActivity.mutateAsync({ id: editingActivity.id, ...patch });
              toast('Activity updated', patch.subject ?? editingActivity.kind, 'success');
              setEditingActivity(null);
            }}
            onError={(err) => {
              const { headline, detail } = classifyMutationError(err);
              toast(headline, detail, 'warning');
            }}
            isPending={updateActivity.isPending}
          />
        )}

        {/* Delete confirm (CD-1) */}
        <ConfirmDialog
          open={deletingActivityId !== null}
          tone="destructive"
          title="Delete this activity?"
          description="This action cannot be undone. The activity log entry will be permanently removed."
          confirmLabel="Delete"
          loading={deleteActivity.isPending}
          onConfirm={onDeleteConfirm}
          onCancel={() => setDeletingActivityId(null)}
        />
      </CardPad>
    </Card>
  );
};

// ── AccountEditActivityModal — inline edit for a crm_activity row (CD-1) ─────

interface AccountActivityPatch {
  kind: CrmActivityKind;
  subject: string | null;
  body: string | null;
}

interface AccountEditActivityModalValues {
  kind: CrmActivityKind;
  subject: string;
  body: string;
}

interface AccountEditActivityModalProps {
  activity: CrmActivityRow;
  contactOptions: { value: string; label: string }[];
  onClose: () => void;
  onSave: (patch: AccountActivityPatch) => Promise<void>;
  onError: (err: unknown) => void;
  isPending: boolean;
}

const AccountEditActivityModal: React.FC<AccountEditActivityModalProps> = ({
  activity,
  onClose,
  onSave,
  onError,
  isPending,
}) => {
  const form = useEntityForm<AccountEditActivityModalValues>({
    initialValues: {
      kind: activity.kind,
      subject: activity.subject ?? '',
      body: activity.body ?? '',
    },
    validate: () => ({}),
    idPrefix: 'account-edit-activity',
    requiredFields: [],
  });

  const kindField = form.fieldProps('kind');
  const subjectField = form.fieldProps('subject');
  const bodyField = form.fieldProps('body');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        await onSave({
          kind: values.kind,
          subject: values.subject.trim() || null,
          body: values.body.trim() || null,
        });
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title="Edit activity"
      subtitle="Update this activity log entry"
      submitLabel="Save"
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={isPending}
      dirty={form.isDirty}
    >
      <FormSection legend="Details">
        <FormGrid>
          <SelectField
            id={kindField.id}
            label="Activity type"
            value={kindField.value}
            onChange={(v) => kindField.onChange(v as CrmActivityKind)}
            options={KIND_OPTIONS}
          />
          <TextField
            id={subjectField.id}
            label="Subject"
            value={subjectField.value}
            onChange={subjectField.onChange}
            onBlur={subjectField.onBlur}
            placeholder="e.g. Kickoff call"
          />
        </FormGrid>
        <TextArea
          id={bodyField.id}
          label="Notes"
          value={bodyField.value}
          onChange={bodyField.onChange}
          onBlur={bodyField.onBlur}
          rows={3}
          fullWidth
          placeholder="What was discussed?"
        />
      </FormSection>
    </EntityFormModal>
  );
};

// ── T14: Add contact from CompanyDetail ───────────────────────────────────────

interface AddContactFormValues {
  full_name: string;
  title: string;
  email: string;
  phone: string;
  notes: string;
}

const addContactValidate = (v: AddContactFormValues): Partial<Record<keyof AddContactFormValues, string>> => {
  const errors: Partial<Record<keyof AddContactFormValues, string>> = {};
  if (!v.full_name.trim()) errors.full_name = 'Contact name is required.';
  return errors;
};

interface AddContactForCompanyModalProps {
  companyId: string;
  companyName: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (err: unknown) => void;
}

/**
 * T14: Contact create modal launched from CompanyDetail. The company_id is pre-filled
 * from the current company and the field is disabled so the user cannot change it.
 * The company name is shown as a locked read-only display.
 */
const AddContactForCompanyModal: React.FC<AddContactForCompanyModalProps> = ({
  companyId,
  companyName,
  onClose,
  onSuccess,
  onError,
}) => {
  const { create } = useContactMutations();
  const form = useEntityForm<AddContactFormValues>({
    initialValues: {
      full_name: '',
      title: '',
      email: '',
      phone: '',
      notes: '',
    },
    validate: addContactValidate,
    idPrefix: 'add-contact-form',
    requiredFields: ['full_name'],
  });

  const nameField = form.fieldProps('full_name');
  const titleField = form.fieldProps('title');
  const emailField = form.fieldProps('email');
  const phoneField = form.fieldProps('phone');
  const notesField = form.fieldProps('notes');

  const errorSummary = form.errors.full_name
    ? [{ fieldId: nameField.id, message: form.errors.full_name }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: ContactInput = {
        company_id: companyId,
        full_name: values.full_name.trim(),
        title: values.title.trim() || null,
        email: values.email.trim() || null,
        phone: values.phone.trim() || null,
        notes: values.notes.trim() || null,
      };
      try {
        await create.mutateAsync(input);
        onSuccess();
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title="New contact"
      subtitle="Add a person at this company"
      submitLabel="Create contact"
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend="Identity">
        <FormGrid>
          <TextField
            id={nameField.id}
            label="Full name"
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder="e.g. Jane Doe"
            autoComplete="name"
            fullWidth
          />
          {/* Company is locked — display as a read-only select so the accessible name "Company"
              is present and the value is visually clear. The select is disabled so the user
              cannot change it. A hidden option carries the companyId for the form value. */}
          <SelectField
            id="add-contact-form-company"
            label="Company"
            required
            value={companyId}
            onChange={() => { /* locked */ }}
            options={[{ value: companyId, label: companyName }]}
            disabled
          />
          <TextField
            id={titleField.id}
            label="Title"
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            placeholder="e.g. Procurement Lead"
          />
        </FormGrid>
      </FormSection>
      <FormSection legend="Contact details">
        <FormGrid>
          <TextField
            id={emailField.id}
            label="Email"
            type="email"
            value={emailField.value}
            onChange={emailField.onChange}
            onBlur={emailField.onBlur}
            placeholder="name@example.com"
            autoComplete="email"
          />
          <TextField
            id={phoneField.id}
            label="Phone"
            value={phoneField.value}
            onChange={phoneField.onChange}
            onBlur={phoneField.onBlur}
            placeholder="e.g. +1 555 010 0000"
            autoComplete="tel"
          />
          <TextArea
            id={notesField.id}
            label="Notes"
            value={notesField.value}
            onChange={notesField.onChange}
            onBlur={notesField.onBlur}
            rows={3}
            fullWidth
            placeholder="Anything worth remembering about this contact"
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

// ── Edit form modal (CW-4b — edit-in-modal stays on the record page) ──────────

interface FormValues {
  name: string;
  type: CompanyType;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.name.trim()) errors.name = 'Company name is required.';
  return errors;
};

interface CompanyEditModalProps {
  company: { id: string; name: string; type: CompanyType };
  onClose: () => void;
  onUpdate: (id: string, input: CompanyInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const CompanyEditModal: React.FC<CompanyEditModalProps> = ({ company, onClose, onUpdate, onError }) => {
  const form = useEntityForm<FormValues>({
    initialValues: { name: company.name, type: company.type },
    validate,
    idPrefix: 'company-form',
    requiredFields: ['name'],
  });

  const nameField = form.fieldProps('name');
  const typeField = form.fieldProps('type');

  const errorSummary = form.errors.name
    ? [{ fieldId: nameField.id, message: form.errors.name }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: CompanyInput = { name: values.name.trim(), type: values.type };
      try {
        await onUpdate(company.id, input);
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title="Edit company"
      subtitle="Update this company record"
      submitLabel="Save company"
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend="Identity">
        <FormGrid>
          <TextField
            id={nameField.id}
            label="Company name"
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder="e.g. Cascade Port Authority"
            autoComplete="organization"
            fullWidth
          />
          <SelectField
            id={typeField.id}
            label="Type"
            required
            value={typeField.value}
            onChange={(v) => typeField.onChange(v as CompanyType)}
            onBlur={typeField.onBlur}
            options={TYPE_OPTIONS}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default CompanyDetail;
