import { useDomainOwnershipMode } from '@/src/hooks/useDomainOwnershipMode';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import React, { useMemo, useState } from 'react';
import {
  ListPage,
  SearchMini,
  ListState,
  DataTable,
  ConfirmDialog,
  SelectField,
  AccessDenied,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { makeContactImportDescriptor } from '@/src/lib/import';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useContacts, useContactMutations } from '@/src/hooks/useContacts';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useCompanyPartyMappings } from '@/src/hooks/useCompanyPartyMappings';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useListSearchWorkingSet } from '@/src/hooks/useListSearchWorkingSet';
import { useListReturn } from '@/src/hooks/useListReturn';
import type { ContactRow } from '@/src/lib/db/contacts';
import { ContactFormModal } from './contact/ContactFormModal';

const Contacts: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useContacts();
  // PGA02-004: the company directory backs this page's filter options, export company names and
  // the create/edit form's company select — its loading/error state is consumed, not discarded.
  const { data: companyData, isPending: companiesPending, isError: companiesError, refetch: refetchCompanies } = useCompanies();
  const { create, update, archive, remove } = useContactMutations();
  const ownership = useDomainOwnershipMode('companies');
  const ownershipReady = ownership.mode === 'pmo' || ownership.mode === 'external';
  const external = ownership.mode === 'external';
  const mappings = useCompanyPartyMappings((companyData ?? []).map((company) => company.id), external);

  // CRM directory view = the master-data roles (Engineer = ○, no nav/page) — mirrors Companies §D.
  const canView = may('view', 'contact');

  // list-working-set-return (#683): `company`/`q` are URL-owned (AC-LRC-007). Search stays LOCAL
  // text written to the URL after a pause — never bound straight to `workingSet.q`. A Back return
  // restores the list's scroll once its rows have loaded (`contentReady`).
  const { workingSet, setWorkingSet, search, setSearch, clearFilters } =
    useListSearchWorkingSet('contacts');
  const { openRecord } = useListReturn({ list: 'contacts', contentReady: !isPending && !isError });
  const companyFilter = workingSet.company;

  const [formTarget, setFormTarget] = useState<{ contact: ContactRow | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ContactRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactRow | null>(null);

  const canCreate = ownershipReady && may('create', 'contact') && (!external || (!mappings.isPending && !mappings.isError && mappings.ids.length > 0));
  const canEdit = ownershipReady && may('edit', 'contact');
  const canArchive = ownershipReady && may('archive', 'contact');
  const canDelete = ownership.mode === 'pmo' && may('delete', 'contact');
  const canRowWrite = canEdit || canArchive || canDelete;

  const companies = useMemo(() => companyData ?? [], [companyData]);
  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.id, companyDisplayName(c)])),
    [companies],
  );
  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.id, label: companyDisplayName(c) })),
    [companies],
  );
  // Spec decision 6: a `?company=` naming no company this user can see (archived, deleted, or
  // another org's) stays the ACTIVE choice — the control agrees with the URL and the zero-match
  // state offers Clear filters — rather than the select silently showing "All companies".
  const companyFilterOptions = useMemo(() => {
    const options = [
      { value: 'All', label: t('contacts.filters.allCompanies', 'All companies') },
      ...companyOptions,
    ];
    if (companyFilter !== 'All' && !companyById.has(companyFilter)) {
      options.push({
        value: companyFilter,
        // Until the directory has loaded the choice may yet resolve, so it is not called unavailable.
        label: companyData ? t('contacts.filters.unavailableCompany', 'Unavailable company') : '…',
      });
    }
    return options;
  }, [companyById, companyData, companyFilter, companyOptions, t]);
  const creatableCompanies = external ? companies.filter((company) => mappings.ids.includes(company.id)) : companies;
  const createOptions = creatableCompanies.map((company) => ({ value: company.id, label: companyDisplayName(company) }));
  const importDescriptor = makeContactImportDescriptor(creatableCompanies);
  // PGA02-004: the export carries each contact's company name — it must not download until the
  // directory has actually resolved (a transient failure would silently export blank names).
  const companiesReady = !companiesPending && !companiesError;

  const all = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((c) => companyFilter === 'All' || c.company_id === companyFilter)
      .filter(
        (c) =>
          !q ||
          c.full_name.toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q),
      );
  }, [all, search, companyFilter]);

  // AC-LRC-012: the DataTable's `empty` branch (with `clearFilters`) only renders when
  // `all.length > 0` (the collection-empty case is the page-level `state === 'empty'` below), so a
  // zero-match result there is always a filtered zero-match.

  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  if (!canView) {
    return (
      <AccessDenied
        title={t('contacts.accessDenied.title', "You don't have access to Contacts")}
        sub={t(
          'contacts.accessDenied.sub',
          'The CRM directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks.',
        )}
        onBack={() => navigate('/')}
      />
    );
  }

  const columns: Column<ContactRow>[] = [
    {
      key: 'full_name',
      header: t('contacts.columns.name', 'Name'),
      cell: (c) => (
        <span className="truncate font-semibold" title={c.full_name}>
          {c.full_name}
        </span>
      ),
      exportValue: (c) => c.full_name,
    },
    {
      key: 'company',
      header: t('contacts.columns.company', 'Company'),
      cell: (c) => (
        <span className="truncate text-muted-foreground" title={companyById.get(c.company_id) ?? ''}>
          {companyById.get(c.company_id) ?? '—'}
        </span>
      ),
      exportValue: (c) => companyById.get(c.company_id) ?? '',
    },
    {
      key: 'email',
      header: t('contacts.columns.email', 'Email'),
      cell: (c) => <span className="truncate text-muted-foreground">{c.email ?? '—'}</span>,
      exportValue: (c) => c.email ?? '',
    },
  ];

  const rowMenu = (c: ContactRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canEdit)
      items.push({
        label: t('contacts.actions.edit', 'Edit'),
        onClick: () => setFormTarget({ contact: c }),
      });
    if (canArchive)
      items.push({
        label: t('contacts.actions.archive', 'Archive'),
        onClick: () => setArchiveTarget(c),
      });
    if (canDelete)
      items.push({
        label: t('contacts.actions.delete', 'Delete'),
        onClick: () => setDeleteTarget(c),
        danger: true,
      });
    return items;
  };

  const onArchiveConfirm = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    try {
      await archive.mutateAsync(target.id);
      toast(t('contacts.toast.archived', 'Contact archived'), target.full_name, 'success');
      setArchiveTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await remove.mutateAsync(target.id);
      toast(t('contacts.toast.deleted', 'Contact deleted'), target.full_name, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  return (
    <ListPage
      title={t('contacts.title', 'Contacts')}
      description={
        // DD-MTG-6: the CRM 'Meeting' kind is the lightweight touchpoint log; anything with
        // attendees and minutes lives in the Meetings module — so this copy no longer promises
        // "meetings" here, and links across to the module instead (the ruling's actual ask).
        <>
          {t(
            'contacts.description',
            'People at the companies you work with. Master data shared by the whole organisation. Log calls and emails against each contact. Minuted meetings live in the',
          )}{' '}
          <Link
            to="/meetings"
            // Inline-in-prose link: a persistent underline keeps it distinguishable from
            // the surrounding text without relying on colour (axe link-in-text-block).
            className="text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t('contacts.descriptionMeetingsLink', 'Meetings module')}
          </Link>
          .
        </>
      }
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ contact: null })}>
            <Icon name="plus" />
            {t('contacts.actions.new', 'New contact')}
          </Button>
        )
      }
      filters={
        state !== 'loading' && (
          <SelectField
            label={t('contacts.filters.companyLabel', 'Filter by company')}
            hideLabel
            value={companyFilter}
            onChange={(v) => setWorkingSet((ws) => ({ ...ws, company: v }))}
            options={companyFilterOptions}
          />
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder={t('contacts.search.placeholder', 'Search contacts…')}
            aria-label={t('contacts.search.ariaLabel', 'Search contacts')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        )
      }
      exportAction={
        state !== 'loading' && companiesReady && (
          <ExportButton rows={filtered} columns={columns} entity="Contacts" />
        )
      }
      importAction={
        state !== 'loading' && canCreate && (
          <ImportButton
            entity="contact"
            descriptor={importDescriptor}
            onImported={() => void refetch()}
          />
        )
      }
    >
      {!ownershipReady && <p className="mb-3 text-sm text-muted-foreground">{ownership.mode === 'error' ? t('crm:ownershipError', 'Ownership could not be loaded. Try again.') : t('crm:ownershipChecking', 'Checking ownership…')}{ownership.mode === 'error' && <Button variant="ghost" size="sm" onClick={ownership.retry}>{t('crm:retry', 'Retry')}</Button>}</p>}
      {/* PGA02-004: a failed company-directory read is named, with a retry — the filter options,
          export names and form company select all depend on it. */}
      {companiesError && (
        <div className="mb-3 flex items-center gap-2">
          <p className="text-sm text-muted-foreground">{t('contacts.companiesUnavailable', 'The company directory could not be loaded. Company names, filtering and export are unavailable.')}</p>
          {refetchCompanies && (
            <Button variant="outline" size="sm" onClick={() => void refetchCompanies()}>
              {t('crm:retry', 'Retry')}
            </Button>
          )}
        </div>
      )}
      {external && may('create', 'contact') && (
        <p className="mb-3 text-sm text-muted-foreground">
          {mappings.isError ? t('crm:mappingUnavailable', 'Company mappings could not be loaded. Try again later.')
            : mappings.isPending ? t('crm:mappingLoading', 'Checking company mappings…')
              : t('crm:mappingRequired', 'Map a company to ERP before adding or importing its contacts.')}
        </p>
      )}
      {external && may('delete', 'contact') && <p className="mb-3 text-sm text-muted-foreground">{t('crm:deleteManaged', 'Records managed in ERP can be archived here.')}</p>}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" shape="table" columns={6} rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('contacts.states.errorTitle', "Couldn't load contacts")}
          sub={t('contacts.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="folder"
          title={t('contacts.states.emptyTitle', 'No contacts yet')}
          sub={t(
            'contacts.states.emptySub',
            // DD-MTG-6: same re-scope as the page description — touchpoints here, minutes in Meetings.
            'Add your first contact to start logging calls and emails against the people you work with.',
          )}
          stateId="contacts-empty"
          role={realRole ?? undefined}
          module="contacts"
          action={
            canCreate
              ? {
                  label: t('contacts.states.emptyAction', 'Add your first contact'),
                  onClick: () => setFormTarget({ contact: null }),
                }
              : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<ContactRow>
          rows={filtered}
          columns={columns}
          rowKey={(c) => c.id}
          // CW-4b: rows now NAVIGATE to the routable `/contacts/:id` record page (the
          // drawer-as-record is retired). Create/edit-in-modal are unchanged.
          // list-working-set-return (#683, AC-LRC-007): capture the current filtered/searched
          // Contacts URL + scroll position as return context instead of a bare navigate.
          onActivate={(c) => openRecord(`/contacts/${c.id}`)}
          // ⚑ Not extracted — embeds a value; `t()` interpolation is silently dropped by the
          // notReady `t` the unit suite uses (no i18next instance is mounted there).
          rowLabel={(c) => `Open ${c.full_name}`}
          rowMenu={canRowWrite ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={t('contacts.table.emptyTitle', 'No contacts match your filters')}
          emptySub={t('contacts.table.emptySub', 'Try a different company or clear the search.')}
          emptyAction={{ label: t('contacts.table.clearFilters', 'Clear filters'), onClick: clearFilters }}
        tableId="contacts-table" />
      )}

      {formTarget && (
        <ContactFormModal
          contact={formTarget.contact}
          ownership={ownership.mode}
          companyOptions={formTarget.contact ? companyOptions : createOptions}
          companyOptionsState={companiesPending ? 'pending' : companiesError ? 'error' : 'ready'}
          onRetryCompanies={companiesError && refetchCompanies ? () => void refetchCompanies() : undefined}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            toast(t('contacts.toast.created', 'Contact created'), input.full_name, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast(t('contacts.toast.updated', 'Contact updated'), input.full_name, 'success');
            setFormTarget(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        tone="default"
        /* ⚑ The named branch stays a template literal — see the interpolation note above. */
        title={
          archiveTarget
            ? `Archive ${archiveTarget.full_name}?`
            : t('contacts.confirm.archiveTitle', 'Archive contact?')
        }
        description={t(
          'contacts.confirm.archiveDescription',
          'They will be hidden from the default list. Existing activity stays intact. You can restore them any time.',
        )}
        confirmLabel={t('contacts.confirm.archiveConfirm', 'Archive contact')}
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={
          deleteTarget
            ? `Delete ${deleteTarget.full_name}?`
            : t('contacts.confirm.deleteTitle', 'Delete contact?')
        }
        description={t(
          'contacts.confirm.deleteDescription',
          'This permanently removes the contact and all of their logged activity. This cannot be undone. Archive instead to keep the history.',
        )}
        confirmLabel={t('contacts.confirm.deleteConfirm', 'Delete contact')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ListPage>
  );
};

export default Contacts;
