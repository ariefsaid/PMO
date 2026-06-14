import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  RecordHeader,
  Card,
  CardHead,
  CardPad,
  Button,
  StatusPill,
  ListState,
  ConfirmDialog,
  AccessDenied,
  EntityFormModal,
  TextField,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
  useToast,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import {
  useCompany,
  useCompanyMutations,
  useProjectsByClient,
  useProcurementsByVendor,
} from '@/src/hooks/useCompanies';
import { useContactsByCompany } from '@/src/hooks/useContacts';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { companyTypeVariant, workflowVariant } from '@/src/lib/status/statusVariants';
import type { CompanyType, CompanyInput } from '@/src/lib/db/companies';

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
 */
const TYPE_OPTIONS = [
  { value: 'Client', label: 'Client' },
  { value: 'Vendor', label: 'Vendor' },
  { value: 'Internal', label: 'Internal' },
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

  // Master-data directory access = Admin·Exec·PM·Finance (rbac-visibility §D); Engineer = ○.
  // The rail hides Companies for an Engineer but the ROUTE does not — so an Engineer reaching
  // /companies/:id by URL gets a clean access-denied surface, not the record. RLS is the row
  // authority; this is FE clarity (mirrors Companies.tsx).
  const canView = may('view', 'company');
  const canEdit = may('edit', 'company');
  const canArchive = may('archive', 'company');

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
      <Card className="mb-4">
        <CardHead>Company detail</CardHead>
        <CardPad>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label="Name" value={company.name} />
            <Field label="Type" value={company.type} />
          </dl>
        </CardPad>
      </Card>

      {/* AC-IFW-COMPANY-01: related projects (always) and procurement (Vendor-only). */}
      <RelatedProjects companyId={company.id} />

      {company.type === 'Vendor' && (
        <RelatedProcurement companyId={company.id} />
      )}

      {/* FR-CRM-008: the company's non-archived contacts — moved here off the retired drawer. */}
      <Card>
        <CardHead>Contacts</CardHead>
        <CardPad>
          <CompanyContactsList companyId={company.id} />
        </CardPad>
      </Card>

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
  <Card className="mb-4">
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
 * AC-IFW-COMPANY-01: Related procurement list (vendor view). Shows all PRs where the company
 * is the vendor — clickable rows that navigate to /procurement/:id. Vendor-only.
 */
const RelatedProcurement: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { data, isPending, isError, refetch } = useProcurementsByVendor(companyId);
  const items = (data ?? []).map((pr) => ({ id: pr.id, title: pr.title, subtitle: pr.status ?? null }));

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
 * FR-CRM-008: read-only contacts list for the company record page. Consumes the pre-wired
 * `useContactsByCompany` hook (AC-CRM-021) — handles loading, empty, and populated states.
 * No write affordances here (YAGNI; the Contacts page owns create/edit/archive). Each row
 * links to the routable `/contacts/:id` page (CW-4b — the master-data graph is now navigable).
 */
const CompanyContactsList: React.FC<{ companyId: string }> = ({ companyId }) => {
  const navigate = useNavigate();
  const { data, isPending } = useContactsByCompany(companyId);

  if (isPending) {
    return (
      <p role="status" aria-label="Loading contacts" className="text-[13px] text-muted-foreground">
        Loading…
      </p>
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
