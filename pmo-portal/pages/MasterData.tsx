/** FR-ODC-111: the Odoo directory pages: items, units, warehouses and locations, cost accounts, and (Admin, Executive, Finance) accounts and taxes, read from PMO's mirror. */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { AccessDenied, Button, DataTable, Icon, ListPage, SearchMini, StatusPill, Tabs, tabId, tabPanelId, type Column } from '@/src/components/ui';
import { useMasterRecords, useMasterSummary, useOdooConnection } from '@/src/hooks/useOdoo';
import type { DirectoryKind, MasterRecord } from '@/src/lib/repositories/odoo';
import { OdooConnectionBanner } from '@/src/components/integrations/odoo/OdooConnectionBanner';
import { OdooWarehouseDefault } from '@/src/components/integrations/odoo/OdooWarehouseDefault';
import { useOdooCan } from '@/src/components/integrations/odoo/useOdooCan';
import { missingForKind } from '@/src/lib/adapterSeam/odoo/kinds';
import { formatInstantDate, formatNumberWhole } from '@/src/lib/format';

const PAGE_SIZE = 50;
const LOCATION_CAP = 1000;   // the platform's max rows per read; more than this for one page of warehouses shows a notice
type PageKind = Exclude<DirectoryKind, 'location'>;
const KINDS: PageKind[] = ['product', 'uom', 'warehouse', 'analytic_account', 'account', 'tax'];
const FINANCIAL: PageKind[] = ['account', 'tax'];

export default function MasterDataPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = useOdooCan();
  const { kind: param } = useParams();
  const kind = KINDS.includes(param as PageKind) ? (param as PageKind) : null;
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(false);

  // Search is applied 300 ms after the last keystroke; a new term or a new kind starts at page 1.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => { setPage(1); setTyped(''); setSearch(''); }, [kind]);

  const conn = useOdooConnection().data;
  const blocked = kind && FINANCIAL.includes(kind) && !may.viewFinancialDirectory;
  const reasons = kind && conn?.capabilities ? missingForKind(kind, conn.capabilities.missing ?? []) : [];
  const enabled = Boolean(kind) && !blocked && reasons.length === 0;
  const isWarehouses = kind === 'warehouse';
  const list = useMasterRecords({ kind: kind ?? 'product', search: search || undefined, page, pageSize: PAGE_SIZE, includeInactive }, enabled);
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  // Units name the unit column of items and the parent of units; locations nest under warehouses. Both are read for the visible page only, so nothing is cut off by a row cap.
  const unitIds = useMemo(() => [...new Set(rows.map((r) => (kind === 'uom' ? r.parent_external_id : r.attrs.uom_id)).filter((v): v is string => typeof v === 'string' && v !== ''))], [rows, kind]);
  const units = useMasterRecords({ kind: 'uom', page: 1, pageSize: Math.max(unitIds.length, 1), includeInactive: true, externalIds: unitIds }, enabled && (kind === 'product' || kind === 'uom') && unitIds.length > 0);
  const warehouseIds = useMemo(() => (isWarehouses ? rows.map((r) => r.external_id) : []), [rows, isWarehouses]);
  const locations = useMasterRecords({ kind: 'location', page: 1, pageSize: LOCATION_CAP, warehouseIds }, enabled && isWarehouses && warehouseIds.length > 0 && missingForKind('location', conn?.capabilities?.missing ?? []).length === 0);
  const summary = useMasterSummary(kind ?? 'product', enabled);

  const unitName = useMemo(() => new Map((units.data?.rows ?? []).map((u) => [u.external_id, u.name])), [units.data]);
  const total = list.data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  if (!kind) return <Navigate to="/master-data/product" replace />;
  if (blocked) return <AccessDenied onBack={() => navigate('/')} />;

  const tabLabels: Record<PageKind, string> = { product: t('administration:odoo.master.items', 'Items'), uom: t('administration:odoo.master.units', 'Units'), warehouse: t('administration:odoo.master.warehouses', 'Warehouses and locations'),
      analytic_account: t('administration:odoo.master.costAccounts', 'Cost accounts'), account: t('administration:odoo.master.accounts', 'Accounts'), tax: t('administration:odoo.master.taxes', 'Taxes'),
  };
  const tabs = KINDS.filter((k) => !FINANCIAL.includes(k) || may.viewFinancialDirectory).map((k) => ({ value: k, label: tabLabels[k] }));

  const status = (r: MasterRecord) => r.tombstoned_at
    ? <StatusPill variant="lost">{t('administration:odoo.master.deleted', 'Deleted in Odoo')}</StatusPill>
    : r.active ? <StatusPill variant="won">{t('administration:odoo.master.active', 'Active')}</StatusPill> : <StatusPill variant="neutral">{t('administration:odoo.master.inactive', 'Inactive')}</StatusPill>;
  const text = (v: unknown) => (v == null || v === '' ? '—' : String(v));
  const code: Column<MasterRecord> = { key: 'code', header: t('administration:odoo.master.code', 'Code'), cell: (r) => text(r.code), kind: 'text' };
  const name: Column<MasterRecord> = { key: 'name', header: t('administration:odoo.master.name', 'Name'), cell: (r) => r.name, rowHeader: true };
  const st: Column<MasterRecord> = { key: 'status', header: t('administration:odoo.master.status', 'Status'), cell: status };
  const columns: Record<PageKind, Column<MasterRecord>[]> = {
    product: [code, name,
      { key: 'unit', header: t('administration:odoo.master.unit', 'Unit'), cell: (r) => unitName.get(String(r.attrs.uom_id)) ?? text(r.attrs.uom_id) },
      { key: 'use', header: t('administration:odoo.master.use', 'Use'), cell: (r) => [r.attrs.purchasable ? t('administration:odoo.master.purchasable', 'Purchasable') : null, r.attrs.sellable ? t('administration:odoo.master.sellable', 'Sellable') : null].filter(Boolean).join(', ') || '—' }, st],
    uom: [name,
      { key: 'factor', header: t('administration:odoo.master.factor', 'Factor'), cell: (r) => text(r.attrs.relative_factor), align: 'num' },
      { key: 'parent', header: t('administration:odoo.master.parentUnit', 'Relative to'), cell: (r) => (r.parent_external_id ? unitName.get(r.parent_external_id) ?? r.parent_external_id : '—') }, st],
    warehouse: [code, name, st],
    analytic_account: [code, name, st],
    account: [code, name, { key: 'type', header: t('administration:odoo.master.accountType', 'Type'), cell: (r) => text(r.attrs.account_type) }, st],
    tax: [name, { key: 'rate', header: t('administration:odoo.master.rate', 'Rate'), cell: (r) => (typeof r.attrs.amount === 'number' ? `${r.attrs.amount}%` : '—'), align: 'num' },
      { key: 'use', header: t('administration:odoo.master.taxUse', 'Applies to'), cell: (r) => text(r.attrs.use) }, st],
  };

  const asOf = summary.data?.asOf ?? rows.map((r) => r.as_of).sort().at(-1) ?? null;
  const state = list.isPending ? 'loading' : list.isError ? 'error' : rows.length === 0 ? 'empty' : undefined;
  const locs = locations.data?.rows ?? [];
  const locationsCut = (locations.data?.total ?? 0) > locs.length;

  return (
    <ListPage
      title={t('administration:odoo.master.title', 'Odoo directories')}
      description={t('administration:odoo.master.description', 'A read copy of your Odoo lists, kept up to date by PMO.')}
      count={enabled ? total : undefined}
      banner={conn && <OdooConnectionBanner connection={conn.connection} binding={{ status: conn.status, activated: conn.activated }} />}
    >
      <div className="flex flex-wrap items-center gap-x-3 border-b border-border">
        <Tabs items={tabs} value={kind} onChange={(k) => navigate(`/master-data/${k}`)} ariaLabel={t('administration:odoo.master.tabs', 'Directories')} idBase="odoo-master" className="mb-0 min-w-0 flex-1 border-b-0" />
        <div className="w-full shrink-0 py-1.5 sm:w-56">
          <SearchMini aria-label={t('administration:odoo.master.search', 'Search code or name')} placeholder={t('administration:odoo.master.search', 'Search code or name')} value={typed} onChange={(e) => setTyped(e.target.value)} type="search" />
        </div>
      </div>

      <div role="tabpanel" id={tabPanelId('odoo-master', kind)} aria-labelledby={tabId('odoo-master', kind)}>
      {reasons.length > 0 ? (
        <div role="status" className="mt-3 flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/12 px-3.5 py-3 text-[13px]">
          <Icon name="alert" className="mt-px size-[17px] shrink-0" aria-hidden="true" />
          <div>
            <div className="font-semibold">{t('administration:odoo.master.unavailable', 'Odoo is missing an app this list needs')}</div>
            <div className="text-muted-foreground">{t('administration:odoo.master.unavailableWhy', 'Missing: {{missing}}. Install or allow it in Odoo, then Re-check on the Integrations page.', { missing: reasons.join(', ') })}</div>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <span>{t('administration:odoo.master.hidden', '{{inactive}} inactive · {{deleted}} deleted in Odoo', { inactive: summary.data?.inactive ?? 0, deleted: summary.data?.tombstoned ?? 0 })}</span>
            {asOf && <span>{t('administration:odoo.master.asOf', 'As of {{when}}', { when: formatInstantDate(asOf) })}</span>}
            <label className="inline-flex min-h-9 items-center gap-1.5">
              <input type="checkbox" checked={includeInactive} onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }} />
              {t('administration:odoo.master.showInactive', 'Show inactive and deleted')}
            </label>
          </div>

          {isWarehouses && <div className="mt-3"><OdooWarehouseDefault /></div>}

          {isWarehouses && state === undefined ? (
            <div className="mt-3 space-y-3">
              {locationsCut && <p role="status" className="text-sm text-muted-foreground">{t('administration:odoo.master.locationsCut', 'Some locations are not shown. Odoo has more than this page can list.')}</p>}
              {rows.map((w) => (
                <section key={w.id} role="group" aria-label={`${w.name}${w.code ? ` (${w.code})` : ''}`} className="rounded-lg border border-border bg-card p-3">
                  <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">{w.name}{w.code && <span className="font-mono text-xs text-muted-foreground">{w.code}</span>}{status(w)}</h2>
                  <ul className="mt-2 divide-y divide-border text-sm">
                    {locs.filter((l) => l.attrs.warehouse_id === w.external_id).map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-3 py-1.5"><span className="min-w-0 break-words">{l.name}</span><span className="text-xs text-muted-foreground">{text(l.attrs.usage)}</span></li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="mt-3">
              <DataTable<MasterRecord> rows={rows} columns={columns[kind]} rowKey={(r) => r.id} tableId={`masterdata-${kind}`} state={state} accessibleName={tabs.find((x) => x.value === kind)?.label}
                emptyTitle={t('administration:odoo.master.empty', 'Nothing here yet')} emptySub={t('administration:odoo.master.emptySub', 'Nothing matches, or the first sync has not finished.')}
                errorTitle={t('administration:odoo.master.error', 'This list could not be loaded')} onRetry={() => void list.refetch()} />
            </div>
          )}

          <nav aria-label={t('administration:odoo.master.pager', 'Pages')} className="mt-3 flex items-center justify-between gap-3 text-[13px] tabular-nums">
            <span>{total === 0 ? '' : t('administration:odoo.master.range', '{{from}}–{{to}} of {{total}}', { from: formatNumberWhole(from), to: formatNumberWhole(to), total: formatNumberWhole(total) })}</span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t('administration:odoo.master.prev', 'Previous page')}><Icon name="back" aria-hidden="true" /></Button>
              <Button variant="outline" size="sm" disabled={to >= total} onClick={() => setPage((p) => p + 1)} aria-label={t('administration:odoo.master.next', 'Next page')}><Icon name="chev" aria-hidden="true" /></Button>
            </span>
          </nav>
        </>
      )}
      </div>
    </ListPage>
  );
}
