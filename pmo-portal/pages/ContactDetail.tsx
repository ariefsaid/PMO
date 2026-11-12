import { useDomainOwnershipMode } from '@/src/hooks/useDomainOwnershipMode';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { HistorySection } from '@/src/components/history/HistorySection';
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
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
  useToast,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import { useListReturn } from '@/src/hooks/useListReturn';
import { useContact, useContactMutations } from '@/src/hooks/useContacts';
import { useCompanies, useCompany } from '@/src/hooks/useCompanies';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { ContactActivityPanel } from './contact/ContactActivityPanel';
import { ContactFormModal } from './contact/ContactFormModal';

/**
 * ContactDetail — the routable `/contacts/:id` master-data record page (CW-4b).
 *
 * Mirrors the CW-4a `IncidentDetail` / sibling `CompanyDetail` pattern: the shared `RecordHeader`
 * (page variant: icon + name + the categorical "Contact" pill + the role-allowed Edit/Archive
 * action zone), a `BackBar` "Back to Contacts", read-only field sections with edit-in-modal, and
 * the CRM activity timeline + Log-activity form on the page.
 * RLS is the enforcement authority; `can()` (via `usePermission`) gates affordances for clarity.
 */

const ContactDetail: React.FC = () => {
  const { t } = useTranslation();
  const ownership = useDomainOwnershipMode('companies');
  const ownershipReady = ownership.mode === 'pmo' || ownership.mode === 'external';
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();

  const query = useContact(contactId);
  // PGA02-004: the company directory backs this page's company field and the edit form's company
  // select — its loading/error state is consumed, not discarded.
  const { data: companyData, isPending: companiesPending, isError: companiesError, refetch: refetchCompanies } = useCompanies();
  const { update, archive } = useContactMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // FR-AXP-021 (Track C): publish the loaded record to the live agent context so a
  // follow-up like "summarize this" grounds to the viewed contact — grounding only
  // (NFR-AXP-SEC-003), never an authorization signal. Placed before any early return
  // (Rules of Hooks) — cleared on unmount/navigate.
  const { setEntity } = useAgentContext();
  useLayoutEffect(() => {
    const loaded = query.data;
    if (!loaded) return;
    setEntity({ type: 'contact', id: loaded.id, label: loaded.full_name });
    return () => setEntity(undefined);
  }, [query.data, setEntity]);

  // CRM directory access = the master-data roles (Engineer = ○) — mirrors Companies §D.
  const canView = may('view', 'contact');
  const canEdit = ownershipReady && may('edit', 'contact');
  const canArchive = ownershipReady && may('archive', 'contact');

  const companies = useMemo(() => companyData ?? [], [companyData]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, companyDisplayName(c)])), [companies]);
  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.id, label: companyDisplayName(c) })),
    [companies],
  );

  // list-working-set-return (#683, AC-LRC-007): return to the validated Contacts list context
  // (filter + search + scroll) when opened from that list; a direct/copied link falls back to the
  // bare index. The Contact→Company related link below stays a PLAIN Link (no captured state) so
  // it never carries Contacts list context onto the company record.
  const { returnToList } = useListReturn({ list: 'contacts' });
  const goBack = () => returnToList();

  if (!canView) {
    return (
      <AccessDenied
        title={t('contactDetail.accessDenied.title', "You don't have access to Contacts")}
        sub={t(
          'contactDetail.accessDenied.sub',
          'The CRM directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks.',
        )}
        onBack={() => navigate('/')}
      />
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (query.isPending) {
    return (
      <>
        <BackBar label={t('contactDetail.backToContacts', 'Contacts')} phoneOnly onBack={goBack} />
        <div data-testid="contact-loading">
          <ListState variant="loading" shape="detail" rows={5} />
        </div>
      </>
    );
  }

  // ── Error (a genuine transient failure — offer Retry) ─────────────────────
  if (query.isError) {
    return (
      <>
        <BackBar label={t('contactDetail.backToContacts', 'Contacts')} phoneOnly onBack={goBack} />
        <ListState
          variant="error"
          title={t('contactDetail.error.title', "Couldn't load contact")}
          sub={t('contactDetail.error.sub', 'Something went wrong fetching this contact.')}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  // ── Not found / no access — a calm empty state ────────────────────────────
  const contact = query.data;
  if (!contact) {
    return (
      <>
        <BackBar label={t('contactDetail.backToContacts', 'Contacts')} phoneOnly onBack={goBack} />
        <div data-testid="contact-not-found">
          <ListState
            variant="empty"
            icon="folder"
            title={t('contactDetail.notFound.title', 'Contact not found')}
            sub={t(
              'contactDetail.notFound.sub',
              "This contact either doesn't exist or isn't visible to you. Return to the directory to find them.",
            )}
          />
        </div>
      </>
    );
  }

  const companyName = companyById.get(contact.company_id) ?? '—';

  const companyOptionsState = companiesPending ? 'pending' as const : companiesError ? 'error' as const : 'ready' as const;

  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  const onArchiveConfirm = async () => {
    try {
      await archive.mutateAsync(contact.id);
      toast(t('contactDetail.toast.archived', 'Contact archived'), contact.full_name, 'success');
      setArchiveOpen(false);
      // AC-LRC-007: return to the same filtered/searched list context, not a bare index reset.
      returnToList();
    } catch (err) {
      onMutationError(err);
    }
  };

  const hasActions = canEdit || canArchive;

  return (
    <div>
      {/* Mobile escape route (rail collapses ≤920px). */}
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block">
        <BackBar label={t('contactDetail.backToContacts', 'Contacts')} onBack={goBack} />
      </div>

      {/* The ONE RecordHeader anatomy — icon + name + categorical "Contact" pill + the
          role-allowed action zone (Edit + Archive). The job title is the meta line. */}
      <RecordHeader
        name={contact.full_name}
        icon={(contact.full_name.trim().charAt(0) || '•').toUpperCase()}
        status={<StatusPill variant="violet">{t('contactDetail.pill', 'Contact')}</StatusPill>}
        meta={contact.title ? <span>{contact.title}</span> : undefined}
        actions={
          hasActions ? (
            <>
              {canEdit && (
                <Button variant="outline" size="sm" data-testid="contact-edit" onClick={() => setEditOpen(true)}>
                  {t('contactDetail.edit', 'Edit')}
                </Button>
              )}
              {canArchive && (
                <Button variant="ghost" size="sm" data-testid="contact-archive" onClick={() => setArchiveOpen(true)}>
                  {t('contactDetail.archive', 'Archive')}
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {/* Body — the contact's fields (read-only; edit-in-modal). */}
      <Card variant="bare" className="mb-4">
        <CardHead>{t('contactDetail.sectionTitle', 'Contact detail')}</CardHead>
        <CardPad>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field
              label={t('contactDetail.field.company', 'Company')}
              value={
                contact.company_id ? (
                  <CompanyNameRefValue companyId={contact.company_id} />
                ) : (
                  companyName
                )
              }
            />
            <Field label={t('contactDetail.field.title', 'Title')} value={contact.title || '—'} />
            <Field
              label={t('contactDetail.field.email', 'Email')}
              value={
                contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {contact.email}
                  </a>
                ) : (
                  '—'
                )
              }
            />
            <Field
              label={t('contactDetail.field.phone', 'Phone')}
              value={
                contact.phone ? (
                  <a
                    href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}
                    className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {contact.phone}
                  </a>
                ) : (
                  '—'
                )
              }
            />
            {contact.notes && (
              <Field label={t('contactDetail.field.notes', 'Notes')} value={contact.notes} />
            )}
          </dl>
        </CardPad>
      </Card>

      {!ownershipReady && <p className="mb-3 text-sm text-muted-foreground">{ownership.mode === 'error' ? t('crm:ownershipError', 'Ownership could not be loaded. Try again.') : t('crm:ownershipChecking', 'Checking ownership…')}{ownership.mode === 'error' && <Button variant="ghost" size="sm" onClick={ownership.retry}>{t('crm:retry', 'Retry')}</Button>}</p>}

      {/* CRM activity timeline + Log-activity form — moved here off the retired drawer. */}
      <Card variant="bare">
        <CardHead>{t('contactDetail.activity.title', 'Activity')}</CardHead>
        <CardPad>
          <ContactActivityPanel contactId={contact.id} />
        </CardPad>
      </Card>

      {/* #719 (spec D5): read-only change history — a collapsed Card section (this page has no tab bar). */}
      <HistorySection entityType="contact" entityId={contact.id} />

      {/* Edit modal — the ONE shared contact form (PGA02-005/OE02R01-001): same fields,
          validation and persistent submit-error handling as the directory. The company
          dependency is gated on the directory's pending/error state (PGA02-004). */}
      {editOpen && canEdit && (
        <ContactFormModal
          contact={contact}
          ownership={ownership.mode}
          companyOptions={companyOptions}
          companyOptionsState={companyOptionsState}
          onRetryCompanies={companiesError && refetchCompanies ? () => void refetchCompanies() : undefined}
          onClose={() => setEditOpen(false)}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast(t('contactDetail.toast.updated', 'Contact updated'), input.full_name, 'success');
            setEditOpen(false);
          }}
          onError={onMutationError}
        />
      )}

      {/* Archive confirm (default tone — reversible soft-archive, ADR-0018). */}
      <ConfirmDialog
        open={archiveOpen}
        tone="default"
        title={t('contactDetail.archiveConfirm.title', 'Archive {{name}}?', {
          name: contact.full_name,
        })}
        description={t(
          'contactDetail.archiveConfirm.description',
          'They will be hidden from the default list. Existing activity stays intact. You can restore them any time.',
        )}
        confirmLabel={t('contactDetail.archiveConfirm.confirmLabel', 'Archive contact')}
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveOpen(false)}
      />
    </div>
  );
};

/** A labelled read-only field (definition-list row). */
const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-control font-semibold text-muted-foreground">
      {label}
    </dt>
    <dd className="text-control text-foreground">{value}</dd>
  </div>
);

// ── PGA02-004: the contact's company reference, with the directory's states surfaced ──

/**
 * The contact's company reference. A pending directory shows a loading hint, a failed one an
 * explicit unavailable + retry — never a bare dash that poses as "no company". A reference the
 * ready directory does not contain (typically a soft-archived company, which the directory
 * filters out) resolves through the single-company read, which still returns archived rows, and
 * is labelled as archived rather than silently dash-ed.
 */
const CompanyNameRefValue: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { t } = useTranslation();
  const { data: companyData, isPending: companiesPending, isError: companiesError, refetch: refetchCompanies } = useCompanies();

  if (companiesPending) {
    return (
      <span className="text-muted-foreground" role="status">
        {t('contacts.form.company.loading', 'Loading companies…')}
      </span>
    );
  }
  if (companiesError) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{t('contacts.companiesUnavailable', 'The company directory could not be loaded. Company names, filtering and export are unavailable.')}</span>
        {refetchCompanies && (
          <Button variant="outline" size="sm" onClick={() => void refetchCompanies()}>
            {t('crm:retry', 'Retry')}
          </Button>
        )}
      </span>
    );
  }
  const inDirectory = (companyData ?? []).find((c) => c.id === companyId);
  if (inDirectory) {
    return (
      <Link
        to={`/companies/${companyId}`}
        className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {companyDisplayName(inDirectory)}
      </Link>
    );
  }
  return <CompanyRefOutsideDirectory companyId={companyId} />;
};

const CompanyRefOutsideDirectory: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { t } = useTranslation();
  const { data, isPending, isError } = useCompany(companyId);

  if (isPending) {
    return <span className="text-muted-foreground">…</span>;
  }
  if (isError || !data) {
    const unavailable = t('contactDetail.field.companyUnavailable', 'This company is not in your company directory.');
    return (
      <span
        className="text-muted-foreground"
        title={unavailable}
      >
        —
        <span className="ml-1">{unavailable}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Link
        to={`/companies/${companyId}`}
        className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {companyDisplayName(data)}
      </Link>
      {data.archived_at != null && (
        <span className="text-control font-medium text-muted-foreground">
          {t('contactDetail.field.companyArchived', 'Archived')}
        </span>
      )}
    </span>
  );
};

export default ContactDetail;
