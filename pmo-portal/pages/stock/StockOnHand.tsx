import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Icon, ListPage, ListState, SelectField, StatTiles, StatusPill, TextField, type Column } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useStockKeepers, useStockOnHand, useStockWarehouses } from '@/src/hooks/useStock';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatQuantity, formatStockValue } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { parseStockError } from '@/src/lib/stockErrors';
import type { StockOnHandRow } from '@/src/lib/db/stockReports';

const NEW_KINDS = ['receive', 'transfer', 'issue', 'return', 'count', 'adjustment'] as const;

const StockOnHand: React.FC = () => {
  const { t } = useTranslation('stock');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser?.id;
  const currency = useOrgCurrency();
  const loc = getNumberLocale();
  const [warehouseId, setWarehouseId] = useState('');
  const [includeZero, setIncludeZero] = useState(false);
  const [search, setSearch] = useState('');

  const warehouses = useStockWarehouses(false);
  const keepers = useStockKeepers();
  const onHand = useStockOnHand({ ...(warehouseId ? { warehouseId } : {}), ...(includeZero ? { includeZero } : {}) });

  const isKeeper = (keepers.data ?? []).some((k) => k.user_id === me);
  const canMove = may('create', 'stockDocument', { record: { isKeeper, viewOnly: realRole !== effectiveRole } });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = onHand.data ?? [];
    return q ? all.filter((r) => `${r.itemCode} ${r.itemName}`.toLowerCase().includes(q)) : all;
  }, [onHand.data, search]);
  // Cost columns follow the DATA, not the role: if the server omitted them they are absent, never a fabricated 0.
  const showCost = (onHand.data ?? []).some((r) => r.valueOnHand !== undefined);

  const columns: Column<StockOnHandRow>[] = useMemo(() => {
    const cols: Column<StockOnHandRow>[] = [
      {
        key: 'item', header: t('onHand.columns.item'), rowHeader: true, stickyLeft: true,
        cell: (r) => (
          <div className="min-w-0">
            <Link to={`/stock/ledger?item=${r.itemId}`} className="block truncate font-mono text-sm font-semibold hover:underline">{r.itemCode}</Link>
            <span className="block truncate text-xs text-muted-foreground">{r.itemName}</span>
          </div>
        ),
        exportValue: (r) => r.itemCode,
      },
      {
        key: 'warehouse', header: t('onHand.columns.warehouse'),
        cell: (r) => (
          <div className="flex items-center gap-2">
            <span className="text-sm">{r.warehouseCode}</span>
            <StatusPill variant={r.warehouseKind === 'central' ? 'open' : 'neutral'}>{t(`setup.kinds.${r.warehouseKind}`)}</StatusPill>
          </div>
        ),
        exportValue: (r) => r.warehouseCode,
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
  }, [t, loc, currency, showCost]);

  const lookupError = warehouses.isError || keepers.isError;
  const state: 'loading' | 'empty' | 'error' | undefined =
    onHand.isError || lookupError ? 'error' : onHand.isPending ? 'loading' : rows.length === 0 ? 'empty' : undefined;
  const tooMany = parseStockError(onHand.error)?.code === 'STK_TOO_MANY';

  const itemCount = new Set(rows.map((r) => r.itemId)).size;
  const whCount = new Set(rows.map((r) => r.warehouseId)).size;
  const centralCount = rows.filter((r) => r.warehouseKind === 'central').length;
  const siteCount = rows.length - centralCount;

  return (
    <ListPage
      title={t('onHand.title')}
      description={t('onHand.description')}
      count={state === undefined ? rows.length : undefined}
      primaryAction={canMove && (
        <div className="flex flex-wrap gap-2">
          {NEW_KINDS.map((k) => (
            <Link key={k} to={`/stock/new/${k}`} className="inline-flex">
              <Button variant={k === 'issue' ? 'primary' : 'outline'} size="sm"><Icon name="plus" />{t(`kinds.${k}`)}</Button>
            </Link>
          ))}
        </div>
      )}
      filters={
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            label={t('onHand.filters.warehouse')}
            hideLabel
            value={warehouseId}
            onChange={setWarehouseId}
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))}
            placeholder={t('onHand.filters.allWarehouses')}
          />
          <TextField label={t('onHand.filters.search')} hideLabel value={search} onChange={setSearch} placeholder={t('onHand.filters.search')} type="search" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
            {t('onHand.filters.includeZero')}
          </label>
        </div>
      }
    >
      <StockTabs />
      {state === undefined && (
        <StatTiles
          className="mb-3"
          tiles={[
            { label: t('onHand.tiles.items'), value: itemCount },
            { label: t('onHand.tiles.warehouses'), value: whCount },
            { label: t('onHand.tiles.central'), value: centralCount },
            { label: t('onHand.tiles.site'), value: siteCount },
          ]}
        />
      )}
      {state === 'loading' && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>}
      {state === 'error' && (
        <ListState
          variant="error"
          title={t(tooMany ? 'onHand.states.tooManyTitle' : 'states.errorTitle')}
          sub={t(tooMany ? 'errors.STK_TOO_MANY' : 'states.errorSub')}
          retryLabel={t('actions.retry')}
          onRetry={() => { void onHand.refetch(); void warehouses.refetch(); void keepers.refetch(); }}
        />
      )}
      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="folder"
          title={t(search || warehouseId ? 'onHand.states.noMatch' : 'empty.noStock')}
          sub={t(search || warehouseId ? 'onHand.states.noMatchSub' : 'onHand.states.emptySub')}
        />
      )}
      {state === undefined && (
        <DataTable<StockOnHandRow>
          rows={rows}
          columns={columns}
          rowKey={(r) => `${r.itemId}:${r.warehouseId}`}
          tableId="stock-on-hand"
          accessibleName={t('onHand.title')}
        />
      )}
    </ListPage>
  );
};

export default StockOnHand;
