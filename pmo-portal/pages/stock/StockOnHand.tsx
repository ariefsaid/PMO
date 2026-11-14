import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DataTable, Icon, ListPage, ListState, RecordMenu, SelectField, TextField, useUrlFilters, type Column } from '@/src/components/ui';
import { StockFilters, StockTabs } from '@/src/components/stock/StockTabs';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useBelowReorder, useStockKeepers, useStockOnHand, useStockWarehouses } from '@/src/hooks/useStock';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatQuantity, formatStockValue, sumDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { parseStockError } from '@/src/lib/stockErrors';
import type { StockOnHandRow } from '@/src/lib/db/stockReports';

const NEW_KINDS = ['receive', 'transfer', 'issue', 'return', 'count', 'adjustment'] as const;

/**
 * C18 scan order: item first, then warehouse. The read's own `order by w.code, i.code` groups by
 * warehouse, so one item's stores sit apart in the list and finding "where is this item held" takes
 * one look per warehouse. Codes compare numerically ("ITEM-9" before "ITEM-10"), then names, then ids
 * so the order is total and stable across refetches.
 */
const compareBalanceRows = (a: StockOnHandRow, b: StockOnHandRow): number =>
  a.itemCode.localeCompare(b.itemCode, undefined, { numeric: true }) ||
  a.itemName.localeCompare(b.itemName) ||
  a.warehouseCode.localeCompare(b.warehouseCode, undefined, { numeric: true }) ||
  a.warehouseName.localeCompare(b.warehouseName) ||
  a.itemId.localeCompare(b.itemId) ||
  a.warehouseId.localeCompare(b.warehouseId);

const StockOnHand: React.FC = () => {
  const { t } = useTranslation('stock');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser?.id;
  const currency = useOrgCurrency();
  const loc = getNumberLocale();
  // R2: all four filters are URL-owned so Back/refresh keep them; defaults stay out of the URL
  // (empty = all warehouses, zero balances hidden, no search, worklist off).
  const { values, setFilter } = useUrlFilters(['warehouse', 'zero', 'q', 'belowReorder']);
  const warehouseId = values.warehouse;
  const includeZero = values.zero === '1';
  const search = values.q;
  const belowOnly = values.belowReorder === '1';
  const setWarehouseId = (value: string) => setFilter('warehouse', value);
  const setIncludeZero = (checked: boolean) => setFilter('zero', checked ? '1' : '');
  const setSearch = (value: string) => setFilter('q', value);
  const setBelowOnly = (checked: boolean) => setFilter('belowReorder', checked ? '1' : '');
  const navigate = useNavigate();

  const warehouses = useStockWarehouses(false);
  const keepers = useStockKeepers();
  // The worklist always loads: its size is the one thing on this page that waits on someone.
  const below = useBelowReorder(belowOnly);
  const onHand = useStockOnHand({ ...(warehouseId ? { warehouseId } : {}), ...(includeZero || belowOnly ? { includeZero: true } : {}) });

  const isKeeper = (keepers.data ?? []).some((k) => k.user_id === me);
  const canMove = may('create', 'stockDocument', { record: { isKeeper, viewOnly: realRole !== effectiveRole } });

  const allRows = useMemo(() => {
    const have = new Set((onHand.data ?? []).map((r) => `${r.itemId}:${r.warehouseId}`));
    const low = new Set((below.data ?? []).map((b) => `${b.itemId}:${b.warehouseId}`));
    const all = (onHand.data ?? []).filter((r) => !belowOnly || low.has(`${r.itemId}:${r.warehouseId}`));
    // A level set on a never-stocked pair is on the worklist but has no balance row: show it at 0 so the two screens agree.
    if (belowOnly) {
      for (const b of below.data ?? []) {
        const w = (warehouses.data ?? []).find((x) => x.id === b.warehouseId);
        if (have.has(`${b.itemId}:${b.warehouseId}`) || !w || (warehouseId && warehouseId !== b.warehouseId)) continue;
        all.push({ itemId: b.itemId, itemCode: b.itemCode, itemName: b.itemName, unitCode: b.unitCode, wholeOnly: false,
          warehouseId: b.warehouseId, warehouseCode: b.warehouseCode, warehouseName: w.name, warehouseKind: w.kind as 'central' | 'site', qtyOnHand: b.qtyOnHand });
      }
    }
    return all;
  }, [onHand.data, belowOnly, below.data, warehouses.data, warehouseId]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = q ? allRows.filter((r) => `${r.itemCode} ${r.itemName}`.toLowerCase().includes(q)) : allRows;
    return [...visible].sort(compareBalanceRows);
  }, [allRows, search]);
  // Cost columns follow the DATA, not the role: if the server omitted them they are absent, never a fabricated 0.
  const showCost = (onHand.data ?? []).some((r) => r.valueOnHand !== undefined);

  // The code is only said when two warehouses share a name.
  const sharedNames = useMemo(() => {
    const byName = new Map<string, Set<string>>();
    for (const r of allRows) byName.set(r.warehouseName, (byName.get(r.warehouseName) ?? new Set()).add(r.warehouseId));
    return new Set([...byName].filter(([, ids]) => ids.size > 1).map(([name]) => name));
  }, [allRows]);

  const columns: Column<StockOnHandRow>[] = useMemo(() => {
    const cols: Column<StockOnHandRow>[] = [
      {
        key: 'item', header: t('onHand.columns.item'), rowHeader: true, stickyLeft: true,
        cell: (r) => (
          <div className="min-w-0">
            <Link to={`/stock/ledger?item=${r.itemId}`} className="block truncate font-mono text-sm font-semibold hover:underline">{r.itemCode}</Link>
            <span className="block truncate text-sm text-muted-foreground">{r.itemName}</span>
          </div>
        ),
        exportValue: (r) => r.itemCode,
      },
      {
        key: 'warehouse', header: t('onHand.columns.warehouse'),
        cell: (r) => (
          <span className="block truncate text-sm">
            {r.warehouseName}{sharedNames.has(r.warehouseName) && <span className="font-mono text-muted-foreground"> · {r.warehouseCode}</span>}
          </span>
        ),
        exportValue: (r) => r.warehouseName,
      },
      {
        key: 'qty', header: t('onHand.columns.quantity'), align: 'num',
        cell: (r) => <span className="tabular-nums">{formatQuantity(r.qtyOnHand, loc)} <span className="text-muted-foreground">{r.unitCode}</span></span>,
        exportValue: (r) => r.qtyOnHand,
      },
    ];
    if (showCost) {
      cols.push(
        { key: 'avg', header: t('onHand.columns.avgCost'), align: 'num', cell: (r) => <span className="tabular-nums">{formatStockValue(r.avgCost, currency, loc)}</span>, exportValue: (r) => r.avgCost ?? '' },
        { key: 'value', header: t('onHand.columns.value'), align: 'num', cell: (r) => <span className="tabular-nums">{formatStockValue(r.valueOnHand, currency, loc)}</span>, exportValue: (r) => r.valueOnHand ?? '' },
      );
    }
    return cols;
  }, [t, loc, currency, showCost, sharedNames, navigate]);

  const lookupError = warehouses.isError || keepers.isError || (belowOnly && below.isError);
  const state: 'loading' | 'empty' | 'error' | undefined =
    onHand.isError || lookupError ? 'error' : onHand.isPending ? 'loading' : rows.length === 0 ? 'empty' : undefined;
  const tooMany = parseStockError(onHand.error)?.code === 'STK_TOO_MANY';

  const centralCount = rows.filter((r) => r.warehouseKind === 'central').length;
  const itemCount = new Set(rows.map((r) => r.itemId)).size;
  const whCount = new Set(rows.map((r) => r.warehouseId)).size;
  // The total of the Value column on screen; absent whenever the server left the value off.
  const totalValue = showCost ? sumDecimal(rows.flatMap((r) => (r.valueOnHand === undefined ? [] : [r.valueOnHand]))) : null;
  const valueIsScoped = Boolean(warehouseId || includeZero || search.trim() || belowOnly);

  return (
    <ListPage
      title={
        <>
          {t('onHand.title')}
          {state === undefined && (
            /* The count is a count OF BALANCES: the title says so, so "21" never stands alone. */
            <span className="ml-2.5 align-middle text-control font-semibold tabular-nums text-muted-foreground">
              {rows.length < allRows.length
                ? t('onHand.countOfTotal', 'Showing {{shown}} of {{total}} balances', { shown: rows.length, total: allRows.length })
                : rows.length === 1
                  ? t('onHand.countOne', '1 balance')
                  : t('onHand.count', '{{shown}} balances', { shown: rows.length })}
            </span>
          )}
        </>
      }
      primaryAction={canMove && (
        <div className="flex items-center gap-2">
          <Link to="/stock/new/issue" className="inline-flex">
            <Button variant="primary"><Icon name="plus" />{t('kinds.issue')}</Button>
          </Link>
          <RecordMenu
            label={t('onHand.moreMovements')}
            ariaLabel={t('onHand.moreMovements')}
            items={NEW_KINDS.filter((k) => k !== 'issue').map((k) => ({ key: k, label: t(`kinds.${k}`), onSelect: () => navigate(`/stock/new/${k}`) }))}
          />
        </div>
      )}
    >
      <StockTabs />
      <StockFilters>
        {/* One row of fields on a phone (the labels are hidden), then the two boxes on one line,
            so the four filters take two rows instead of half of the first screen. */}
        <div className="grid w-full grid-cols-2 gap-2 md:contents">
          <SelectField
            label={t('onHand.filters.warehouse')}
            hideLabel
            value={warehouseId}
            onChange={setWarehouseId}
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))}
            placeholder={t('onHand.filters.allWarehouses')}
          />
          <TextField label={t('onHand.filters.search')} hideLabel value={search} onChange={setSearch} placeholder={t('onHand.filters.search')} type="search" />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* The shared Checkbox carries its own visible words inside the hit target (A2's `children`
              API), so the words toggle it and a screen reader hears the name once. The 32px box keeps
              the control's centre on the same line as the fields beside it. */}
          <div className="flex h-8 items-center">
            <Checkbox checked={belowOnly} onChange={setBelowOnly} label={t('onHand.filters.belowReorder')} className="font-medium">
              {t('onHand.filters.belowReorder')}
            </Checkbox>
          </div>
          <div className="flex h-8 items-center">
            <Checkbox checked={includeZero} onChange={setIncludeZero} label={t('onHand.filters.includeZero')}>
              {t('onHand.filters.includeZero')}
            </Checkbox>
          </div>
        </div>
      </StockFilters>
      {state === undefined && (
        <div className="mb-3">
          {totalValue !== null && (
            <figure className="mb-2">
              <figcaption className="text-sm font-medium text-muted-foreground">
                {valueIsScoped ? t('onHand.valueShown', 'Value of shown balances') : t('onHand.columns.value')}
              </figcaption>
              <div className="text-[30px] font-semibold leading-tight tabular-nums text-foreground">
                {formatStockValue(totalValue, currency, loc)}
              </div>
            </figure>
          )}
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span><b className="font-semibold text-foreground tabular-nums">{itemCount}</b> {t('onHand.tiles.items')}</span>
            <span><b className="font-semibold text-foreground tabular-nums">{whCount}</b> {t('onHand.tiles.warehouses')}</span>
            <span><b className="font-semibold text-foreground tabular-nums">{centralCount}</b> {t('onHand.tiles.central')}</span>
            <span><b className="font-semibold text-foreground tabular-nums">{rows.length - centralCount}</b> {t('onHand.tiles.site')}</span>
          </p>
        </div>
      )}
      {state === 'loading' && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>}
      {state === 'error' && (
        <ListState
          variant="error"
          title={t(tooMany ? 'onHand.states.tooManyTitle' : 'states.errorTitle')}
          sub={t(tooMany ? 'errors.STK_TOO_MANY' : 'states.errorSub')}
          retryLabel={t('actions.retry')}
          onRetry={() => { void onHand.refetch(); void warehouses.refetch(); void keepers.refetch(); void below.refetch(); }}
        />
      )}
      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="folder"
          title={t(search || warehouseId || belowOnly ? 'onHand.states.noMatch' : 'empty.noStock')}
          sub={t(search || warehouseId || belowOnly ? 'onHand.states.noMatchSub' : 'onHand.states.emptySub')}
        />
      )}
      {state === undefined && (
        <DataTable<StockOnHandRow>
          rows={rows}
          columns={columns}
          onActivate={(r) => navigate(`/stock/ledger?item=${r.itemId}`)}
          rowKey={(r) => `${r.itemId}:${r.warehouseId}`}
          tableId="stock-on-hand"
          accessibleName={t('onHand.title')}
          // F12: a compact card may not drop a fact. Every cell the table carries keeps its label here —
          // Warehouse, On hand, and (only for a reader the server sends cost to) Average cost and Value —
          // laid out as a tight two-column list so the card stays short without losing a line.
          mobileCardTitle={(r) => (
            <div className="min-w-0">
              <Link to={`/stock/ledger?item=${r.itemId}`} className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-sm font-semibold hover:underline">{r.itemCode}</Link>
              <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted-foreground">{r.itemName}</span>
            </div>
          )}
          mobileCardDetails={(r) => (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 text-control">
              <dt className="text-muted-foreground">{t('onHand.columns.warehouse')}</dt>
              <dd className="min-w-0">
                {r.warehouseName}{sharedNames.has(r.warehouseName) && <span className="font-mono text-muted-foreground"> · {r.warehouseCode}</span>}
              </dd>
              <dt className="text-muted-foreground">{t('onHand.columns.quantity')}</dt>
              <dd className="tabular-nums font-semibold">
                {formatQuantity(r.qtyOnHand, loc)} <span className="font-normal text-muted-foreground">{r.unitCode}</span>
              </dd>
              {showCost && (
                <>
                  {/* Average cost is blank for a zero balance (the read computes it only above zero): the
                      shared empty marker says "not known", never a fabricated 0. */}
                  <dt className="text-muted-foreground">{t('onHand.columns.avgCost')}</dt>
                  <dd className="tabular-nums">{formatStockValue(r.avgCost, currency, loc) || <span className="text-muted-foreground">—</span>}</dd>
                  <dt className="text-muted-foreground">{t('onHand.columns.value')}</dt>
                  <dd className="tabular-nums">{formatStockValue(r.valueOnHand, currency, loc) || <span className="text-muted-foreground">—</span>}</dd>
                </>
              )}
            </dl>
          )}
        />
      )}
    </ListPage>
  );
};

export default StockOnHand;
