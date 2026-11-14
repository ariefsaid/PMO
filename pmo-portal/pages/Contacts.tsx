import { useDomainOwnershipMode } from '@/src/hooks/useDomainOwnershipMode';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ListPage,
  SearchMini,
  Combobox,
  useUrlFilters,
  ListState,
  DataTable,
  ConfirmDialog,
  AccessDenied,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { ExportAllButton } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { makeContactImportDescriptor } from '@/src/lib/import';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useContactsExportAll, useContactsPage, useContactsTotal, useContactMutations } from '@/src/hooks/useContacts';
import { useCompanyOptions } from '@/src/hooks/useCompanies';
import { useCompanyPartyMappings } from '@/src/hooks/useCompanyPartyMappings';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useListReturn } from '@/src/hooks/useListReturn';
import type { ContactRow } from '@/src/lib/db/contacts';
import { ContactFormModal } from './contact/ContactFormModal';

/** The server page size (#1989): 50, the established Odoo-directory/AdminUsers page size. */
const PAGE_SIZE = 50;

const Contacts: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  // PGA02-004: the company directory backs this page's filter options, export company names and
  // the create/edit form's company select — its loading/error state is consumed, not discarded.
  // #1989: a picker must offer EVERY company, so the options read stays whole-directory — but it
  // narrows to the display fields (id + name) instead of the wide company row.
  const companyOptionsQuery = useCompanyOptions();
  const companyData = companyOptionsQuery.data;
  const companiesPending = companyOptionsQuery.isPending;
  const companiesError = companyOptionsQuery.isError;
  const refetchCompanies = companyOptionsQuery.refetch;
  const { create, update, archive, remove } = useContactMutations();
  const ownership = useDomainOwnershipMode('companies');
  const ownershipReady = ownership.mode === 'pmo' || ownership.mode === 'external';
  const external = ownership.mode === 'external';
  const mappings = useCompanyPartyMappings((companyData ?? []).map((company) => company.id), external);

  // CRM directory view = the master-data roles (Engineer = ○, no nav/page) — mirrors Companies §D.
  const canView = may('view', 'contact');

  const { values, setFilter, clear } = useUrlFilters(['q', 'company']);
  const companyFilter = values.company;
  const search = values.q;

  // #1989 (the Master-data pattern): the directory reads ONE server page with the company filter
  // and search applied SERVER-side, plus the exact matching total. The whole contact directory is
  // no longer loaded to filter it in the browser.
  const [page, setPage] = useState(1);
  const directory = useContactsPage({
    companyId: !companyFilter || companyFilter === 'All' ? 'All' : companyFilter,
    search,
    page,
    pageSize: PAGE_SIZE,
  });
  const { openRecord } = useListReturn({ list: 'contacts', contentReady: !directory.isPending && !directory.isError });
  const unfiltered = (!companyFilter || companyFilter === 'All') && !search.trim();
  // Keep the existing whole-directory count read in the filtered state; this repair changes only
  // which count is displayed, not what the directory reads or counts.
  const totalCount = useContactsTotal({ enabled: !unfiltered });
  const pageRows = useMemo(() => directory.data?.rows ?? [], [directory.data]);
  const total = directory.data?.total ?? 0;
  const directoryTotal = unfiltered ? total : (totalCount.data ?? total);
  // C5 (DS contacts #5): `keepPreviousData` keeps the PREVIOUS page painted while a new query
  // lands. That payload says nothing about the new query — a kept-previous EMPTY page (e.g. right
  // after Clear filters or Clear search) would otherwise read as "No contacts yet" about a
  // directory that has rows. A body-only skeleton holds the verdict until the real page arrives.
  const awaitingRows = Boolean(directory.isPlaceholderData) && pageRows.length === 0;
  const exportAll = useContactsExportAll();

  // A committed filter/search change (typing pause, a select change, or a Back-restore of the URL
  // working set) makes the old page number meaningless — always land on page 1.
  useEffect(() => { setPage(1); }, [companyFilter, search]);

  // Out-of-range correction (the AdminUsers ruling): a deletion or a narrowing filter can leave
  // `page` past the last page — an empty page-N is corrected down instead of shown as truth.
  useEffect(() => {
    if (!directory.data || pageRows.length > 0 || total === 0 || page <= 1) return;
    setPage(Math.max(1, Math.ceil(total / PAGE_SIZE)));
  }, [directory.data, pageRows.length, total, page]);

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
    const options = [...companyOptions];
    if (companyFilter && companyFilter !== 'All' && !companyById.has(companyFilter)) {
      options.push({
        value: companyFilter,
        // Until the directory has loaded the choice may yet resolve, so it is not called unavailable.
        label: companyData ? t('contacts.filters.unavailableCompany', 'Unavailable company') : '…',
      });
    }
    return options;
  }, [companyById, companyData, companyFilter, companyOptions, t]);

  const companyFilterChoices = useMemo(
    () => [
      { value: '', label: t('contacts.filters.allCompanies', 'All companies') },
      ...companyFilterOptions,
    ],
    [companyFilterOptions, t],
  );
  const loadCompanyFilterOptions = useMemo(
    () => async () => companyFilterChoices,
    [companyFilterChoices],
  );
  const hasActiveFilter = Boolean(search || (companyFilter && companyFilter !== 'All'));

  const creatableCompanies = external ? companies.filter((company) => mappings.ids.includes(company.id)) : companies;
  const createOptions = creatableCompanies.map((company) => ({ value: company.id, label: companyDisplayName(company) }));
  const importDescriptor = makeContactImportDescriptor(creatableCompanies);
  // PGA02-004: the export carries each contact's company name — it must not download until the
  // directory has actually resolved (a transient failure would silently export blank names).
  const companiesReady = !companiesPending && !companiesError;

  // AC-LRC-012 (server-page form): the DataTable's `empty` branch (with `clearFilters`) only
  // renders when the DIRECTORY holds rows (`unfiltered` false ⇒ the zero-match is a filtered
  // zero-match; the collection-empty case is the page-level `state === 'empty'` below), so a
  // zero-match result there is always a filtered zero-match.

  const state: 'loading' | 'empty' | 'error' | undefined = directory.isPending
    ? 'loading'
    : directory.isError || !directory.data
      ? 'error'
      : awaitingRows
        ? undefined
        : total === 0 && unfiltered
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
        <div className="min-w-0">
          <span className="block truncate font-semibold" title={c.full_name}>
            {c.full_name}
          </span>
          {c.title && (
            <span className="block truncate font-normal text-muted-foreground" title={c.title}>
              {c.title}
            </span>
          )}
        </div>
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
      cell: (c) => (
        <span className="block min-w-0 whitespace-normal break-normal text-muted-foreground md:truncate">
          {c.email
            ? c.email.split(/([@._+-])/).map((part, index) => (
                <React.Fragment key={index}>
                  {part}
                  {/^[@._+-]$/.test(part) && <wbr />}
                </React.Fragment>
              ))
            : '—'}
        </span>
      ),
      colClassName: 'col-span-2',
      exportValue: (c) => c.email ?? '',
    },
    {
      key: 'phone',
      header: t('contacts.columns.phone', 'Phone'),
      cell: (c) => <span className="truncate text-muted-foreground">{c.phone ?? '—'}</span>,
      exportValue: (c) => c.phone ?? '',
    },
  ];
  const exportColumns = columns.filter((column) => column.key !== 'phone');

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
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
            <div className="flex w-full min-w-0 flex-col gap-2 md:w-auto md:flex-1">
              <label htmlFor="contacts-search" className="text-control font-semibold text-foreground">
                {t('contacts.search.ariaLabel', 'Search contacts')}
              </label>
              <SearchMini
                id="contacts-search"
                aria-label={t('contacts.search.ariaLabel', 'Search contacts')}
                placeholder={t('contacts.search.placeholder', 'Search contacts…')}
                value={search}
                onChange={(event) => setFilter('q', event.currentTarget.value)}
                containerClassName="w-full min-w-0 md:flex-1"
              />
            </div>
            <Combobox
              label={t('contacts.filters.companyLabel', 'Filter by company')}
              value={companyFilter && companyFilter !== 'All' ? companyFilter : null}
              selectedOption={companyFilterOptions.find(({ value }) => value === companyFilter) ?? null}
              onChange={(value) => setFilter('company', value)}
              loadOptions={loadCompanyFilterOptions}
              statusOverride={companiesPending ? 'loading' : companiesError ? 'error' : undefined}
              onRetry={() => { void refetchCompanies?.(); }}
              placeholder={t('contacts.filters.allCompanies', 'All companies')}
              noun={t('contacts.filters.companyNoun', 'company')}
              nounPlural={t('contacts.filters.companyNounPlural', 'companies')}
              emptyMessage={() => null}
              className="w-full min-w-0 md:w-56"
            />
            {hasActiveFilter && (
              <Button variant="ghost" className="text-primary-text hover:underline" onClick={clear}>
                {t('contacts.filters.clear', 'Clear all')}
              </Button>
            )}
            {directory.data && !directory.isPlaceholderData && (
              <span aria-live="polite" className="text-control text-muted-foreground">
                {t('ui.listPage.showingOf', 'Showing {{count}} of {{total}}', {
                  count: total,
                  total: directoryTotal,
                })}
              </span>
            )}
          </div>
        )
      }
      desktopToolbarClassName="md:grid-cols-[minmax(0,1fr)_0_auto]"
      exportAction={
        state !== 'loading' && companiesReady && (
          <ExportAllButton
            entity="Contacts"
            columns={exportColumns}
            hasRows={total > 0}
            fetchRows={() =>
              exportAll.mutateAsync({
                companyId: !companyFilter || companyFilter === 'All' ? undefined : companyFilter,
                search: search.trim() || undefined,
              })
            }
          />
        )
      }
      importAction={
        state !== 'loading' && canCreate && (
          <ImportButton
            entity="contact"
            descriptor={importDescriptor}
            onImported={() => void directory.refetch()}
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
          onRetry={() => directory.refetch()}
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

      {state === undefined && awaitingRows && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" shape="table" columns={6} rows={6} />
        </div>
      )}

      {state === undefined && !awaitingRows && (
        <>
          <DataTable<ContactRow>
            rows={pageRows}
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
            state={pageRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('contacts.table.emptyTitle', 'No contacts match your filters')}
            emptySub={t('contacts.table.emptySub', 'Try a different company or clear the search.')}
            emptyAction={{ label: t('contacts.table.clearFilters', 'Clear filters'), onClick: clear }}
          tableId="contacts-table" />

          {/* #1989: the pager under the server page — the Master-data/AdminUsers anatomy. */}
          <nav aria-label={t('contacts.pager.label', 'Pages')} className="mt-3 flex items-center justify-between gap-3 text-control tabular-nums">
            <span>
              {total === 0
                ? ''
                : t('contacts.pager.range', '{{from}}–{{to}} of {{total}}', {
                    from: (page - 1) * PAGE_SIZE + 1,
                    to: Math.min(page * PAGE_SIZE, total),
                    total,
                  })}
            </span>
            <span className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || directory.isFetching}
                onClick={() => setPage((p) => p - 1)}
                aria-label={t('contacts.pager.prev', 'Previous page')}
              >
                <Icon name="back" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * PAGE_SIZE >= total || directory.isFetching}
                onClick={() => setPage((p) => p + 1)}
                aria-label={t('contacts.pager.next', 'Next page')}
              >
                <Icon name="chev" aria-hidden="true" />
              </Button>
            </span>
          </nav>
        </>
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
