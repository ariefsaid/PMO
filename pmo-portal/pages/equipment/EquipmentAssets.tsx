import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, ConfirmDialog, DataTable, Icon, ListPage, ListState, useToast, type Column,
} from '@/src/components/ui';
import { AssetFormModal } from './AssetFormModal';
import { EquipmentAssetImport } from './EquipmentAssetImport';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useDeleteAsset, useEquipmentAssetPages, useUpdateAsset } from '@/src/hooks/useEquipment';
import { LIST_LIMIT, type EquipmentAssetRow } from '@/src/lib/db/equipment';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';
import { unitLabel } from './equipmentLabels';
import { VendorResponseSummaryCard } from './VendorResponseSummary';

type Pending = { kind: 'archive' | 'delete'; asset: EquipmentAssetRow } | null;

/** Equipment → Assets: the thin asset reference (FR-EQU-020/022). Archive over delete (ADR-0018); Admin may delete an unused one. */
const EquipmentAssetsPage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const writeCtx = { record: { viewOnly: realRole !== effectiveRole } }; // view-as is read-only
  const { data, total: exactTotal, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = useEquipmentAssetPages();
  const update = useUpdateAsset();
  const del = useDeleteAsset();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EquipmentAssetRow | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pages = data?.pages ?? [];
  const rows = pages.flatMap((page) => page.rows);
  const total = exactTotal;

  const run = async () => {
    const p = pending;
    if (!p) return;
    setProblem(null);
    try {
      if (p.kind === 'archive') await update.mutateAsync({ id: p.asset.id, patch: { archived_at: new Date().toISOString() } });
      else await del.mutateAsync(p.asset.id);
      toast(p.kind === 'archive' ? t('equipment:assets.archived', 'Asset archived') : t('equipment:assets.deleted', 'Asset deleted'), undefined, 'success');
      setPending(null);
    } catch (err) {
      const c = classifyMutationError(err);
      setProblem(c.classification === 'in_use'
        ? t('equipment:assets.inUse', 'This asset is in use by usage entries or costing. Archive it instead.')
        : joinSentences(c.headline, c.detail));
      setPending(null);
    }
  };

  const columns: Column<EquipmentAssetRow>[] = [
    { key: 'code', header: t('equipment:assets.code', 'Code'), kind: 'primary', rowHeader: true, cell: (a) => <span className="record-id font-semibold text-foreground">{a.code}</span> },
    { key: 'name', header: t('equipment:assets.name', 'Name'), cell: (a) => <span>{a.name}</span> },
    { key: 'ownership', header: t('equipment:assets.ownership', 'Owned or rented'), cell: (a) => (a.ownership === 'rented' ? t('equipment:assets.rented', 'Rented') : t('equipment:assets.owned', 'Owned')) },
    { key: 'unit', header: t('equipment:assets.unit', 'Default unit'), cell: (a) => unitLabel(t, a.default_unit) },
    { key: 'ref', header: t('equipment:assets.externalRef', 'ERP reference'),
      cell: (a) => a.external_ref ? <span className="record-id">{a.external_ref}</span> : null },
  ];

  return (
    <ListPage
      title={t('equipment:assets.title', 'Assets')}
      count={total}
      importAction={<CanWrite entity="equipmentAsset" action="create" ctx={writeCtx}>
        <EquipmentAssetImport onImported={() => void refetch()} />
      </CanWrite>}
      primaryAction={<CanWrite entity="equipmentAsset" action="create" ctx={writeCtx}>
        <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" />{t('equipment:assets.new', 'New asset')}</Button>
      </CanWrite>}
    >
      {problem && <p role="alert" className="mb-3 text-destructive-text">{problem}</p>}
      {isPending && <ListState variant="loading" shape="table" rows={4} />}
      {!isPending && (isError || !data) && (
        <ListState variant="error" title={t('equipment:assets.error', "Couldn't load equipment assets")}
          sub={t('equipment:assets.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void refetch()}
          retryLabel={t('equipment:usage.retry', 'Retry')} />
      )}
      {!isPending && !isError && data && (
        <>
          {pages[0]?.truncated && rows.length <= LIST_LIMIT && <p role="status" className="mb-2 text-sm text-muted-foreground">
            {t('equipment:assets.truncated', 'Showing the first {{count}} assets. Archive the ones you no longer use.', { count: LIST_LIMIT })}</p>}
          <DataTable<EquipmentAssetRow> rows={rows} columns={columns} rowKey={(a) => a.id} tableId="equipment-assets-table"
            onActivate={(a) => navigate(`/equipment/assets/${a.id}`)}
            rowHref={(a) => `/equipment/assets/${a.id}`}
            rowLabel={(a) => t('equipment:assets.rowLabel', 'Open {{name}}', { name: a.name })}
            rowMenu={(a) => [
              ...(may('edit', 'equipmentAsset', writeCtx) ? [{ label: t('equipment:assets.edit', 'Edit'), onClick: () => setEditing(a) }] : []),
              ...(may('edit', 'equipmentAsset', writeCtx) ? [{ label: t('equipment:assets.archive', 'Archive'), onClick: () => setPending({ kind: 'archive', asset: a }) }] : []),
              ...(may('delete', 'equipmentAsset', writeCtx) ? [{ label: t('equipment:assets.delete', 'Delete'), danger: true, onClick: () => setPending({ kind: 'delete', asset: a }) }] : []),
            ]}
            total={total}
            hasMore={Boolean(hasNextPage)}
            isLoadingMore={isFetchingNextPage}
            onLoadMore={() => void fetchNextPage()}
            loadMoreLabel={t('equipment:assets.loadMore', 'Load more')}
            state={rows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('equipment:assets.empty', 'No assets yet')}
            emptySub={t('equipment:assets.emptySub', 'Add the machines crews log their hours against.')}
            emptyAction={may('create', 'equipmentAsset', writeCtx)
              ? { label: t('equipment:assets.new', 'New asset'), onClick: () => setCreating(true) }
              : undefined}
            emptyActionVariant="outline" />
          <VendorResponseSummaryCard assets={rows} />
        </>
      )}
      {creating && <AssetFormModal onClose={() => setCreating(false)} />}
      {editing && <AssetFormModal asset={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={pending !== null} tone={pending?.kind === 'delete' ? 'destructive' : 'default'}
        title={pending?.kind === 'delete' ? t('equipment:assets.deleteTitle', 'Delete this asset?') : t('equipment:assets.archiveTitle', 'Archive this asset?')}
        description={pending?.kind === 'delete'
          ? t('equipment:assets.deleteBody', '{{name}} is removed for good. An asset with usage or costing cannot be deleted; archive it instead.', { name: pending.asset.name })
          : t('equipment:assets.archiveBody', '{{name}} leaves the pickers. Its past usage and costing stay.', { name: pending?.asset.name ?? '' })}
        confirmLabel={pending?.kind === 'delete' ? t('equipment:assets.deleteConfirm', 'Delete asset') : t('equipment:assets.archiveConfirm', 'Archive asset')}
        onCancel={() => setPending(null)} onConfirm={() => void run()} />
    </ListPage>
  );
};
export default EquipmentAssetsPage;
