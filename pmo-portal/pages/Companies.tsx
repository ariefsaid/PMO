import { useDomainOwnershipMode } from '@/src/hooks/useDomainOwnershipMode';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ListPage,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  GateNotice,
  AccessDenied,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { ExportAllButton } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { companyImportDescriptor } from '@/src/lib/import';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useCompaniesExportAll, useCompaniesPage, useCompaniesTotal, useCompanyMutations } from '@/src/hooks/useCompanies';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import { useListSearchWorkingSet } from '@/src/hooks/useListSearchWorkingSet';
import { useListReturn } from '@/src/hooks/useListReturn';
import type { CompanyTypeFilter } from '@/src/lib/listWorkingSet';
import type { CompanyListRow } from '@/src/lib/db/companies';
import { companyTypeVariant } from '@/src/lib/status/statusVariants';
import { CompanyFormModal } from './company/CompanyFormModal';
import { typeLabels } from './company/companyTypeLabels';
import { IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';

/** Type filter segments: All + the three company_type enum values (Internal / Client / Vendor).
 *  Reuses the URL codec's own `CompanyTypeFilter` type so the toolbar and the `type`/`q` URL
 *  working set (list-working-set-return, #683) never drift into two shapes for the same filter. */
type TypeFilter = CompanyTypeFilter;
const TYPE_FILTERS: TypeFilter[] = ['All', 'Internal', 'Client', 'Vendor'];

/** The server page size (#1989): 50, the established Odoo-directory/AdminUsers page size. */
const PAGE_SIZE = 50;

// Company-type pill comes from the single status registry's CATEGORY family
// (`companyTypeVariant`): Client = categorical `violet` (the highlighted type),
// Vendor / Internal = `neutral`. Per the Freed-Blue Status Rule, a type pill never
// uses the action-blue (`open`) and never borrows a workflow tint (`won`/`lost`);
// the distinct LABEL carries identity, so the types read apart by label + dot.

const Companies: React.FC = () => {
  const { t } = useTranslation();
  const ownership = useDomainOwnershipMode('companies');
  const ownershipReady = ownership.mode === 'pmo' || ownership.mode === 'external';
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  // `?? IDLE_PENDING_PUSH` — existing hook mocks (RBAC/export test suites) predate this field.
  const { create, update, setProjectNumberSegment, archive, remove, pendingPush = IDLE_PENDING_PUSH } = useCompanyMutations();
  const exportAll = useCompaniesExportAll();

  // A-5 (rbac-visibility §D): Companies directory view = Admin·Exec·PM·Finance; Engineer = ○
  // (no nav, no page). The rail hides it but the ROUTE does not — so an Engineer reaching
  // /companies by URL gets a clean access-denied surface, not the master-data directory. RLS
  // is the authority for the rows; this is FE clarity.
  const canView = may('view', 'company');

  // list-working-set-return (#683): `type`/`q` are URL-owned (AC-LRC-006) — a copied link and a
  // refresh reproduce the same filtered set. Search stays LOCAL text, written to the URL after a
  // pause (never bound straight to `workingSet.q` — see useUrlSearchInput's search contract). A
  // Back return restores the list's scroll once its rows have loaded (`contentReady`).
  const { workingSet, setWorkingSet, search, setSearch, clearFilters } =
    useListSearchWorkingSet('companies');
  const filter = workingSet.type;
  const [page, setPage] = useState(1);
  // #1989 (the Master-data pattern): the directory reads ONE server page with the type filter and
  // search applied SERVER-side, plus the exact matching total. The whole directory is no longer
  // loaded to filter it in the browser.
  const directory = useCompaniesPage({ type: filter, search, page, pageSize: PAGE_SIZE });
  const { openRecord } = useListReturn({ list: 'companies', contentReady: !directory.isPending && !directory.isError });
  const unfiltered = filter === 'All' && !search.trim();
  // "Showing X of Y" keeps its meaning on a filtered view: Y is the whole directory, read as one
  // head count only while a filter/search is active (unfiltered, X IS Y — one request, not two).
  const totalCount = useCompaniesTotal({ enabled: !unfiltered });
  const pageRows = useMemo(() => directory.data?.rows ?? [], [directory.data]);
  const total = directory.data?.total ?? 0;
  const directoryTotal = unfiltered ? total : (totalCount.data ?? total);

  // A committed filter/search change (typing pause, a tab switch, or a Back-restore of the URL
  // working set) makes the old page number meaningless — always land on page 1.
  useEffect(() => { setPage(1); }, [filter, search]);

  // Out-of-range correction (the AdminUsers ruling): a deletion or a narrowing filter can leave
  // `page` past the last page — an empty page-N is corrected down instead of shown as truth.
  useEffect(() => {
    if (!directory.data || pageRows.length > 0 || total === 0 || page <= 1) return;
    setPage(Math.max(1, Math.ceil(total / PAGE_SIZE)));
  }, [directory.data, pageRows.length, total, page]);

  // Modal: null = closed; { company: null } = create; { company } = edit.
  const [formTarget, setFormTarget] = useState<{ company: CompanyListRow | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CompanyListRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyListRow | null>(null);
  // In-use delete block (23503): the company whose hard-delete the RPC refused
  // because it is still referenced. Drives the inline GateNotice + Archive-instead
  // recovery path (crud-components §5.3).
  const [blockedCompany, setBlockedCompany] = useState<CompanyListRow | null>(null);

  const canCreate = ownershipReady && may('create', 'company');
  const canEdit = ownershipReady && may('edit', 'company');
  const canArchive = ownershipReady && may('archive', 'company');
  const canDelete = ownership.mode === 'pmo' && may('delete', 'company');
  const canRowWrite = canEdit || canArchive || canDelete;

  const typeLabel = typeLabels(t);
  const filterLabel = (f: TypeFilter) => (f === 'All' ? t('companies.filters.all', 'All') : typeLabel[f]);

  // AC-LRC-012 (server-page form): the DataTable's `empty` branch below (with `clearFilters`)
  // only ever renders when the DIRECTORY holds rows (`unfiltered` false ⇒ the zero-match is a
  // filtered zero-match; the collection-empty case is the page-level `state === 'empty'`), so a
  // zero-match result there is always a filtered zero-match — clearing both controls is safe.

  // ── States ──────────────────────────────────────────────────────────────
  const state: 'loading' | 'empty' | 'error' | undefined = directory.isPending
    ? 'loading'
    : directory.isError || !directory.data
      ? 'error'
      : total === 0 && unfiltered
        ? 'empty'
        : undefined;

  // A-5 page view-gate (after all hooks — Rules of Hooks): a denied role (Engineer) gets the
  // shared access-denied surface, not the directory.
  if (!canView) {
    return (
      <AccessDenied
        title={t('companies.accessDenied.title', "You don't have access to Companies")}
        sub={t(
          'companies.accessDenied.sub',
          'The company directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks.',
        )}
        onBack={() => navigate('/')}
      />
    );
  }

  const columns: Column<CompanyListRow>[] = [
    {
      key: 'name',
      header: t('companies.columns.name', 'Company'),
      cell: (c) => (
        <div className="min-w-0" title={c.name}>
          <span className="block truncate font-semibold">{companyDisplayName(c)}</span>
          {c.short_name?.trim() && c.short_name.trim() !== c.name && (
            <span className="block truncate text-xs text-muted-foreground">{c.name}</span>
          )}
        </div>
      ),
      exportValue: (c) => c.name,
    },
    {
      key: 'type',
      // The pill reads the localised LABEL; `exportValue` keeps the raw enum so a spreadsheet
      // round-trips back into the same filter/import values regardless of the viewer's language.
      header: t('companies.columns.type', 'Type'),
      cell: (c) => <StatusPill variant={companyTypeVariant(c.type)}>{typeLabel[c.type]}</StatusPill>,
      exportValue: (c) => c.type,
    },
  ];

  const rowMenu = (c: CompanyListRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canEdit)
      items.push({
        label: t('companies.actions.edit', 'Edit'),
        onClick: () => setFormTarget({ company: c }),
      });
    if (canArchive)
      items.push({
        label: t('companies.actions.archive', 'Archive'),
        onClick: () => setArchiveTarget(c),
      });
    if (canDelete)
      items.push({
        label: t('companies.actions.delete', 'Delete'),
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
      toast(t('companies.toast.archived', 'Company archived'), target.name, 'success');
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
      toast(t('companies.toast.deleted', 'Company deleted'), target.name, 'success');
      setDeleteTarget(null);
      setBlockedCompany(null);
    } catch (err) {
      // Centralized classification (ADR-0017): 23503 foreign_key_violation (referenced by
      // projects/procurements/profiles) → "Still in use"; for that case surface the recovery
      // path (Archive instead) as the detail rather than the verbatim FK message.
      const { headline, detail } = classifyMutationError(err);
      const isInUse = (err as { code?: string })?.code === '23503';
      toast(
        headline,
        // ⚑ NOT EXTRACTED — this sentence embeds a value. `t()` interpolation is unsafe in this
        // repo today: the unit suite mounts no i18next instance, so react-i18next's notReady `t`
        // returns the default string and SILENTLY DROPS the options bag — the screen would read
        // "{{name}} is referenced by…". See the report; the fix belongs in test/setup.ts, not here.
        isInUse
          ? `${target.name} is referenced by other records and can't be deleted. Archive it instead to keep the audit trail.`
          : detail,
        'warning',
      );
      setDeleteTarget(null);
      // A referenced company also renders a persistent inline GateNotice (the toast
      // auto-dismisses; the gate keeps the recovery path within reach).
      setBlockedCompany(isInUse ? target : null);
    }
  };

  return (
    <ListPage
      title={t('companies.title', 'Companies')}
      count={directory.data ? total : undefined}
      total={directory.data && !unfiltered ? directoryTotal : undefined}
      description={t(
        'companies.description',
        'Clients and suppliers used across projects and procurement. Master data shared by the whole organisation.',
      )}
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ company: null })}>
            <Icon name="plus" />
            {t('companies.actions.new', 'New company')}
          </Button>
        )
      }
      /* In-use delete block (23503) — inline GateNotice with an Archive-instead
         recovery path. Persists until the user archives or dismisses it. */
      banner={
        blockedCompany && (
          <GateNotice variant="blocked" className="mb-3.5" data-testid="company-delete-gate">
            {/* ⚑ The sentence body is NOT extracted: it wraps the company name in <b>, so it needs
                <Trans> (or interpolation), and both are unsafe here — see the note on the in-use
                toast above. The two buttons around it ARE extracted. */}
            <div>
              <b className="font-semibold">{blockedCompany.name}</b> is referenced by other
              records and can&rsquo;t be deleted. Archive it instead to remove it from new records
              while keeping the audit trail.
              <div className="mt-2.5 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setArchiveTarget(blockedCompany);
                    setBlockedCompany(null);
                  }}
                >
                  {t('companies.deleteGate.archiveInstead', 'Archive instead')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setBlockedCompany(null)}>
                  {t('companies.deleteGate.dismiss', 'Dismiss')}
                </Button>
              </div>
            </div>
          </GateNotice>
        )
      }
      filters={
        state !== 'loading' && (
          <ViewToggle<TypeFilter>
            options={TYPE_FILTERS.map((f) => ({ value: f, label: filterLabel(f) }))}
            value={filter}
            onChange={(v) => {
              setWorkingSet((ws) => ({ ...ws, type: v }));
              trackFilterApplied('type', TYPE_FILTERS.length, 'companies');
            }}
            ariaLabel={t('companies.filters.ariaLabel', 'Filter by type')}
          />
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder={t('companies.search.placeholder', 'Search companies…')}
            aria-label={t('companies.search.ariaLabel', 'Search companies')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            searchSurface="companies-list"
            module="companies"
            resultCount={total}
            // Below `sm` the toolbar stacks: `basis-full` forces the search onto
            // its own full-width row and `min-w-0` drops the base min-w-[190px]
            // clip, so it shrinks to the viewport and stays reachable at 375px. At
            // `sm`+ it right-aligns at its natural width (ml-auto).
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        )
      }
      exportAction={
        state !== 'loading' && (
          // #1989: the page holds ONE server page, but Export still delivers EVERY company
          // matching the current filter/search — the full set is read at click time.
          <ExportAllButton
            entity="Companies"
            columns={columns}
            hasRows={total > 0}
            fetchRows={() =>
              exportAll.mutateAsync({
                type: filter === 'All' ? undefined : filter,
                search: search.trim() || undefined,
              })
            }
          />
        )
      }
      /* Bulk import (ADR-0027): role-gated via can('create','company'); reuses the
         entity's create repository so RLS stamps org_id + gates the write role. On a
         successful import the wizard close refetches the list. */
      importAction={
        state !== 'loading' && canCreate && (
          <ImportButton
            entity="company"
            descriptor={companyImportDescriptor}
            onImported={() => void directory.refetch()}
          />
        )
      }
    >
      {/* Body */}
      {!ownershipReady && <p className="mb-3 text-sm text-muted-foreground">{ownership.mode === 'error' ? t('crm:ownershipError', 'Ownership could not be loaded. Try again.') : t('crm:ownershipChecking', 'Checking ownership…')}{ownership.mode === 'error' && <Button variant="ghost" size="sm" onClick={ownership.retry}>{t('crm:retry', 'Retry')}</Button>}</p>}
      {ownership.mode === 'external' && may('delete', 'company') && <p className="mb-3 text-sm text-muted-foreground">{t('crm:deleteManaged', 'Records managed in ERP can be archived here.')}</p>}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" shape="table" columns={6} rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('companies.states.errorTitle', "Couldn't load companies")}
          sub={t('companies.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => directory.refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="folder"
          title={t('companies.states.emptyTitle', 'No companies yet')}
          sub={t(
            'companies.states.emptySub',
            'Add your first client or supplier to start linking projects and procurement cases to a directory.',
          )}
          stateId="companies-empty"
          role={realRole ?? undefined}
          module="companies"
          action={
            canCreate
              ? {
                  label: t('companies.actions.new', 'New company'),
                  onClick: () => setFormTarget({ company: null }),
                }
              : undefined
          }
        />
      )}

      {state === undefined && (
        <>
          <DataTable<CompanyListRow>
            rows={pageRows}
            columns={columns}
            rowKey={(c) => c.id}
            // CW-4b: rows now NAVIGATE to the routable `/companies/:id` record page (the
            // drawer-as-record is retired). Create/edit-in-modal are unchanged.
            // list-working-set-return (#683): capture the current filtered/searched Companies URL
            // + scroll position as return context (AC-LRC-006) instead of a bare navigate.
            onActivate={(c) => openRecord(`/companies/${c.id}`)}
            // ⚑ Not extracted — embeds a value; see the interpolation note above.
            rowLabel={(c) => `Open ${companyDisplayName(c)}`}
            rowMenu={canRowWrite ? rowMenu : undefined}
            state={pageRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('companies.table.emptyTitle', 'No companies match your filters')}
            emptySub={t('companies.table.emptySub', 'Try a different type or clear the search.')}
            emptyAction={{ label: t('companies.table.clearFilters', 'Clear filters'), onClick: clearFilters }}
          tableId="companies-table" />

          {/* #1989: the pager under the server page — the Master-data/AdminUsers anatomy. */}
          <nav aria-label={t('companies.pager.label', 'Pages')} className="mt-3 flex items-center justify-between gap-3 text-[13px] tabular-nums">
            <span>
              {total === 0
                ? ''
                : t('companies.pager.range', '{{from}}–{{to}} of {{total}}', {
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
                aria-label={t('companies.pager.prev', 'Previous page')}
              >
                <Icon name="back" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * PAGE_SIZE >= total || directory.isFetching}
                onClick={() => setPage((p) => p + 1)}
                aria-label={t('companies.pager.next', 'Next page')}
              >
                <Icon name="chev" aria-hidden="true" />
              </Button>
            </span>
          </nav>
        </>
      )}

      {/* Create / edit modal — the ONE shared company form (PGA02-003/OE01-005). The record
          page's edit modal uses the same module, so field/validation/error behavior can only
          ever be one thing. The edit save separates the company row from the client-number
          segment: a segment failure after the row committed is reported as PARTIAL success
          in-dialog (PGA02-001), not as a failed save that invites a blind retry. */}
      {formTarget && (
        <CompanyFormModal
          company={formTarget.company}
          ownership={ownership.mode}
          pendingPush={pendingPush}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            toast(t('companies.toast.created', 'Company created'), input.name, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input, segment) => {
            await update.mutateAsync({ id, input });
            try {
              await setProjectNumberSegment.mutateAsync({ id, segment });
            } catch (segmentSaveError) {
              // The company row is already saved — the shared form states the partial truth.
              return { segmentSaveError };
            }
            toast(t('companies.toast.updated', 'Company updated'), input.name, 'success');
            setFormTarget(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      {/* Archive confirm (default tone) */}
      <ConfirmDialog
        open={!!archiveTarget}
        tone="default"
        /* ⚑ The named branch stays a template literal — see the interpolation note above. */
        title={
          archiveTarget
            ? `Archive ${archiveTarget.name}?`
            : t('companies.confirm.archiveTitle', 'Archive company?')
        }
        description={t(
          'companies.confirm.archiveDescription',
          "It will be hidden from the default list and can't be selected on new records. Existing references stay intact. You can restore it any time.",
        )}
        confirmLabel={t('companies.confirm.archiveConfirm', 'Archive company')}
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      {/* Delete confirm (destructive tone) */}
      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={
          deleteTarget
            ? `Delete ${deleteTarget.name}?`
            : t('companies.confirm.deleteTitle', 'Delete company?')
        }
        description={t(
          'companies.confirm.deleteDescription',
          "This permanently removes the company. A company referenced by projects or procurements can't be deleted; archive it instead.",
        )}
        confirmLabel={t('companies.confirm.deleteConfirm', 'Delete company')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ListPage>
  );
};

export default Companies;
