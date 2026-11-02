import { useDomainOwnershipMode } from '@/src/hooks/useDomainOwnershipMode';
import { useCompanyPartyMappings } from '@/src/hooks/useCompanyPartyMappings';
import { HistorySection } from '@/src/components/history/HistorySection';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
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
  useToast,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { VendorTaxDefaultsCard } from './company/VendorTaxDefaultsCard';
import { CompanyFormModal } from './company/CompanyFormModal';
import { AccountActivityCard } from './company/AccountActivityCard';
import { PrimaryContactField, CompanyContactsList } from './company/CompanyContacts';
import { RelatedProjects, RelatedProcurement } from './company/CompanyRelatedRecords';
import { CompanyCollections } from '@/src/components/companies/CompanyCollections';
import { usePermission } from '@/src/auth/usePermission';
import { useListReturn } from '@/src/hooks/useListReturn';
import { useCompany, useCompanyMutations } from '@/src/hooks/useCompanies';
import { useContactMutations } from '@/src/hooks/useContacts';
import { ContactFormModal } from './contact/ContactFormModal';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { companyTypeVariant } from '@/src/lib/status/statusVariants';

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

const CompanyDetail: React.FC = () => {
  const { t } = useTranslation();
  const { companyId } = useParams<{ companyId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();

  const query = useCompany(companyId);
  const ownership = useDomainOwnershipMode('companies');
  const ownershipReady = ownership.mode === 'pmo' || ownership.mode === 'external';
  const externalCompanies = ownership.mode === 'external';
  const mappings = useCompanyPartyMappings(companyId ? [companyId] : [], externalCompanies);
  const { update, setProjectNumberSegment, archive } = useCompanyMutations();
  // The in-context "Add contact" modal (shared contact form) creates through the same seam.
  const { create: createContact } = useContactMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  // T14: "Add contact" modal state
  const [addContactOpen, setAddContactOpen] = useState(false);

  // FR-AXP-021 (Track C): publish the loaded record to the live agent context so a
  // follow-up like "summarize this" grounds to the viewed company — grounding only
  // (NFR-AXP-SEC-003), never an authorization signal. Placed before any early return
  // (Rules of Hooks) — cleared on unmount/navigate.
  const { setEntity } = useAgentContext();
  useLayoutEffect(() => {
    const loaded = query.data;
    if (!loaded) return;
    setEntity({ type: 'company', id: loaded.id, label: loaded.name });
    return () => setEntity(undefined);
  }, [query.data, setEntity]);

  // Master-data directory access = Admin·Exec·PM·Finance (rbac-visibility §D); Engineer = ○.
  // The rail hides Companies for an Engineer but the ROUTE does not — so an Engineer reaching
  // /companies/:id by URL gets a clean access-denied surface, not the record. RLS is the row
  // authority; this is FE clarity (mirrors Companies.tsx).
  const canView = may('view', 'company');
  const canEdit = ownershipReady && may('edit', 'company');
  const canArchive = ownershipReady && may('archive', 'company');
  const canCreateContact = ownershipReady && may('create', 'contact') && (!externalCompanies || (!mappings.isPending && !mappings.isError && mappings.ids.includes(companyId ?? '')));
  const canViewSalesInvoices = may('view', 'salesInvoice');

  useEffect(() => {
    const company = query.data;
    if (location.hash !== '#collections' || company?.type !== 'Client' || !canViewSalesInvoices) return;

    const frame = window.requestAnimationFrame(() => {
      const section = document.getElementById('collections');
      const heading = document.getElementById('company-collections-heading');
      if (!section || !heading) return;
      heading.focus({ preventScroll: true });
      section.scrollIntoView?.({ block: 'start' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [canViewSalesInvoices, location.hash, query.data]);

  // list-working-set-return (#683, AC-LRC-006): the mobile BackBar returns to the validated
  // Companies list context (filter + search + scroll) when the record was opened from that list,
  // and falls back to the bare index for a direct/copied link. The desktop parent breadcrumb reads
  // the same context via App.tsx's `contextualListReturnNavigation`.
  const { returnToList } = useListReturn({ list: 'companies' });
  const goBack = () => returnToList();

  // A-5 page view-gate (before the hooks-dependent branches; the hooks above already ran so
  // Rules of Hooks hold) — a denied role gets the shared access-denied surface.
  if (!canView) {
    return (
      <AccessDenied
        title={t('companyDetail.accessDenied.title', "You don't have access to Companies")}
        sub={t(
          'companyDetail.accessDenied.sub',
          'The company directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks.',
        )}
        onBack={() => navigate('/')}
      />
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (query.isPending) {
    return (
      <>
        <BackBar label={t('companyDetail.backToCompanies', 'Companies')} phoneOnly onBack={goBack} />
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
        <BackBar label={t('companyDetail.backToCompanies', 'Companies')} phoneOnly onBack={goBack} />
        <ListState
          variant="error"
          title={t('companyDetail.error.title', "Couldn't load company")}
          sub={t('companyDetail.error.sub', 'Something went wrong fetching this company.')}
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
        <BackBar label={t('companyDetail.backToCompanies', 'Companies')} phoneOnly onBack={goBack} />
        <div data-testid="company-not-found">
          <ListState
            variant="empty"
            icon="folder"
            title={t('companyDetail.notFound.title', 'Company not found')}
            sub={t(
              'companyDetail.notFound.sub',
              "This company either doesn't exist or isn't visible to you. Return to the directory to find it.",
            )}
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
      toast(t('companyDetail.toast.archived', 'Company archived'), company.name, 'success');
      setArchiveOpen(false);
      // Archived records drop out of the default directory. AC-LRC-006: return to the SAME
      // filtered/searched list context (not a bare index reset) — the archived row simply drops
      // out of the resulting set, shown truthfully.
      returnToList();
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
        <BackBar label={t('companyDetail.backToCompanies', 'Companies')} onBack={goBack} />
      </div>

      {/* The ONE RecordHeader anatomy — icon + name + categorical company-type pill (CW-2
          registry) + the role-allowed action zone (Edit + Archive). */}
      <RecordHeader
        name={companyDisplayName(company)}
        icon={(companyDisplayName(company).trim().charAt(0) || '•').toUpperCase()}
        status={<StatusPill variant={companyTypeVariant(company.type)}>{company.type}</StatusPill>}
        actions={
          hasActions ? (
            <>
              {canEdit && (
                <Button variant="outline" size="sm" data-testid="company-edit" onClick={() => setEditOpen(true)}>
                  {t('companyDetail.edit', 'Edit')}
                </Button>
              )}
              {canArchive && (
                <Button variant="ghost" size="sm" data-testid="company-archive" onClick={() => setArchiveOpen(true)}>
                  {t('companyDetail.archive', 'Archive')}
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {!ownershipReady && <p className="mb-3 text-sm text-muted-foreground">{ownership.mode === 'error' ? t('crm:ownershipError', 'Ownership could not be loaded. Try again.') : t('crm:ownershipChecking', 'Checking ownership…')}{ownership.mode === 'error' && <Button variant="ghost" size="sm" onClick={ownership.retry}>{t('crm:retry', 'Retry')}</Button>}</p>}
      {/* Body — the company's fields (read-only; edit-in-modal). */}
      <Card variant="bare" className="mb-4">
        <CardHead>{t('companyDetail.sectionTitle', 'Company detail')}</CardHead>
        <CardPad>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label={t('companyDetail.field.name', 'Name')} value={company.name} />
            <Field label={t('companies.form.shortName.label', 'Short name')} value={company.short_name || '—'} />
            <Field label={t('companyDetail.field.type', 'Type')} value={company.type} />
            {company.client_number_segment && (
              <Field
                label={t('companyDetail.field.clientNumberSegment', 'Client number segment')}
                value={<span className="font-mono">{company.client_number_segment}</span>}
              />
            )}
            {/* T18: Primary contact link — rendered in the account card when contacts exist. */}
            <PrimaryContactField companyId={company.id} />
          </dl>
        </CardPad>
      </Card>
      {/* #876 slice 2 (OD-VWH-1): the vendor's default tax treatment pre-fills its bills. */}
      {company.type === 'Vendor' && <VendorTaxDefaultsCard company={company} />}

      {/* AC-IFW-COMPANY-01 + AC-G3C-CD-3: related projects (always) and procurement
          (always fetch; visible for Vendors or any type when vendor PRs exist). */}
      <RelatedProjects companyId={company.id} />
      <RelatedProcurement companyId={company.id} isVendor={company.type === 'Vendor'} />
      {company.type === 'Client' && canViewSalesInvoices && <CompanyCollections companyId={company.id} />}

      {/* T17: Account-level activity timeline — aggregated across all company contacts.
          CD-4: pass the add-contact opener so the cold-start card can surface it. */}
      <AccountActivityCard
        companyId={company.id}
        onAddContact={canCreateContact ? () => setAddContactOpen(true) : undefined}
      />

      {/* FR-CRM-008: the company's non-archived contacts — moved here off the retired drawer.
          T14: "Add contact" in-context button in the CardHead (CanWrite-gated). */}
      <Card variant="bare">
        <CardHead
          actions={
            canCreateContact && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddContactOpen(true)}
              >
                <Icon name="plus" />
                {t('companyDetail.contacts.addContact', 'Add contact')}
              </Button>
            )
          }
        >
          {t('companyDetail.contacts.title', 'Contacts')}
        </CardHead>
        <CardPad>
          {externalCompanies && may('create', 'contact') && !canCreateContact && (
            <p className="mb-3 text-sm text-muted-foreground">
              {mappings.isError ? t('crm:mappingUnavailable', 'Company mappings could not be loaded. Try again later.')
                : mappings.isPending ? t('crm:mappingLoading', 'Checking company mappings…')
                  : t('crm:companyMappingRequired', 'Map this company to ERP before adding a contact.')}
            </p>
          )}
          <CompanyContactsList companyId={company.id} />
        </CardPad>
      </Card>

      {/* #719 (spec D5): read-only change history — a collapsed Card section (this page has no tab bar). */}
      <HistorySection entityType="company" entityId={company.id} />

      {/* T14: Add contact modal — the ONE shared contact form in its locked-company mode
          (PGA02-005/OE02R01-002): company_id pre-filled and locked to this record. */}
      {addContactOpen && canCreateContact && (
        <ContactFormModal
          contact={null}
          ownership={ownership.mode}
          companyOptions={[{ value: company.id, label: companyDisplayName(company) }]}
          lockedCompanyId={company.id}
          lockedCompanyLabel={companyDisplayName(company)}
          createSubtitle={t('companyDetail.addContact.subtitle', 'Add a person at this company')}
          onClose={() => setAddContactOpen(false)}
          onCreate={async (input) => {
            await createContact.mutateAsync(input);
            toast(t('companyDetail.toast.contactCreated', 'Contact created'), input.full_name, 'success');
            setAddContactOpen(false);
          }}
          onError={onMutationError}
        />
      )}

      {/* Edit modal — the ONE shared company form (PGA02-003/OE01-005): same fields, ownership
          gating and persistent submit-error handling as the directory. The edit save separates
          the company row from the client-number segment; a segment failure after the row
          committed is reported as PARTIAL success in-dialog (PGA02-001), and the record gains
          the persistent submit error the detail modal previously lacked (toast-only recovery). */}
      {editOpen && canEdit && (
        <CompanyFormModal
          company={company}
          ownership={ownership.mode}
          onClose={() => setEditOpen(false)}
          onUpdate={async (id, input, segment) => {
            await update.mutateAsync({ id, input });
            try {
              await setProjectNumberSegment.mutateAsync({ id, segment });
            } catch (segmentSaveError) {
              // The company row is already saved — the shared form states the partial truth.
              return { segmentSaveError };
            }
            toast(t('companyDetail.toast.updated', 'Company updated'), input.name, 'success');
            setEditOpen(false);
          }}
          onError={onMutationError}
        />
      )}

      {/* Archive confirm (default tone — reversible soft-archive, ADR-0018). */}
      <ConfirmDialog
        open={archiveOpen}
        tone="default"
        title={t('companyDetail.archiveConfirm.title', 'Archive {{name}}?', {
          name: company.name,
        })}
        description={t(
          'companyDetail.archiveConfirm.description',
          "It will be hidden from the default list and can't be selected on new records. Existing references stay intact. You can restore it any time.",
        )}
        confirmLabel={t('companyDetail.archiveConfirm.confirmLabel', 'Archive company')}
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

export default CompanyDetail;
