import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, ConfirmDialog, DataTable, EntityFormModal, FormGrid, Icon, ListPage, ListState, SelectField, TextField,
  useEntityForm, useToast, type Column, type SubmitError,
} from '@/src/components/ui';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useCreateAsset, useDeleteAsset, useEquipmentAssets, useUpdateAsset } from '@/src/hooks/useEquipment';
import { LIST_LIMIT, type EquipmentAssetRow } from '@/src/lib/db/equipment';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { unitLabel } from './equipmentLabels';

const NewAssetModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const create = useCreateAsset();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const form = useEntityForm({
    initialValues: { code: '', name: '', unit: 'hours' },
    idPrefix: 'equipment-asset',
    requiredFields: ['code', 'name'],
    validate: () => ({}),
  });
  const code = form.fieldProps('code');
  const name = form.fieldProps('name');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      try {
        await create.mutateAsync({ code: v.code.trim(), name: v.name.trim(), default_unit: v.unit as 'hours' | 'days' });
        toast(t('equipment:assets.created', 'Asset created'), undefined, 'success');
        onClose();
      } catch (err) {
        const c = classifyMutationError(err);
        setSubmitError({ headline: c.headline, detail: c.detail });
      }
    });
  };
  return (
    <EntityFormModal open title={t('equipment:assets.newTitle', 'New equipment asset')}
      submitLabel={t('equipment:assets.create', 'Create asset')} onSubmit={submit} onClose={onClose}
      loading={form.isSubmitting} dirty={form.isDirty} submitDisabled={!form.isComplete} submitError={submitError}>
      <FormGrid>
        <TextField label={t('equipment:assets.code', 'Code')} required mono {...code} />
        <TextField label={t('equipment:assets.name', 'Name')} required {...name} />
        <SelectField label={t('equipment:assets.unit', 'Default unit')} value={form.values.unit} onChange={(v) => form.setValue('unit', v)}
          options={[{ value: 'hours', label: t('equipment:unit.hours', 'hours') }, { value: 'days', label: t('equipment:unit.days', 'days') }]} />
      </FormGrid>
    </EntityFormModal>
  );
};

type Pending = { kind: 'archive' | 'delete'; asset: EquipmentAssetRow } | null;

/** Equipment → Assets: the thin asset reference (FR-EQU-020/022). Archive over delete (ADR-0018); Admin may delete an unused one. */
const EquipmentAssetsPage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const writeCtx = { record: { viewOnly: realRole !== effectiveRole } }; // view-as is read-only
  const { data, isPending, isError, refetch } = useEquipmentAssets();
  const update = useUpdateAsset();
  const del = useDeleteAsset();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const rows = data?.rows ?? [];

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
        : `${c.headline}. ${c.detail}`);
      setPending(null);
    }
  };

  const columns: Column<EquipmentAssetRow>[] = [
    { key: 'code', header: t('equipment:assets.code', 'Code'), kind: 'primary', rowHeader: true, cell: (a) => <span className="font-mono">{a.code}</span> },
    { key: 'name', header: t('equipment:assets.name', 'Name'), cell: (a) => <span className="font-medium">{a.name}</span> },
    { key: 'unit', header: t('equipment:assets.unit', 'Default unit'), cell: (a) => unitLabel(t, a.default_unit) },
    { key: 'ref', header: t('equipment:assets.externalRef', 'ERP reference'),
      cell: (a) => a.external_ref ? <span className="font-mono">{a.external_ref}</span> : null },
  ];

  return (
    <ListPage
      title={t('equipment:assets.title', 'Assets')}
      count={data ? rows.length : undefined}
      primaryAction={<CanWrite entity="equipmentAsset" action="create" ctx={writeCtx}>
        <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" />{t('equipment:assets.new', 'New asset')}</Button>
      </CanWrite>}
    >
      {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
      {isPending && <ListState variant="loading" shape="table" rows={4} />}
      {!isPending && (isError || !data) && (
        <ListState variant="error" title={t('equipment:assets.error', "Couldn't load equipment assets")}
          sub={t('equipment:assets.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void refetch()}
          retryLabel={t('equipment:usage.retry', 'Retry')} />
      )}
      {!isPending && !isError && data && (
        <>
          {data.truncated && <p role="status" className="mb-2 text-sm text-muted-foreground">
            {t('equipment:assets.truncated', 'Showing the first {{count}} assets. Archive the ones you no longer use.', { count: LIST_LIMIT })}</p>}
          <DataTable<EquipmentAssetRow> rows={rows} columns={columns} rowKey={(a) => a.id} tableId="equipment-assets-table"
            onActivate={(a) => navigate(`/equipment/assets/${a.id}`)}
            rowLabel={(a) => t('equipment:assets.rowLabel', 'Open {{name}}', { name: a.name })}
            rowMenu={(a) => [
              ...(may('edit', 'equipmentAsset', writeCtx) ? [{ label: t('equipment:assets.archive', 'Archive'), onClick: () => setPending({ kind: 'archive', asset: a }) }] : []),
              ...(may('delete', 'equipmentAsset', writeCtx) ? [{ label: t('equipment:assets.delete', 'Delete'), danger: true, onClick: () => setPending({ kind: 'delete', asset: a }) }] : []),
            ]}
            state={rows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('equipment:assets.empty', 'No equipment yet')}
            emptySub={t('equipment:assets.emptySub', 'An Admin or Project Manager adds the machines so crews can log their hours.')} />
        </>
      )}
      {creating && <NewAssetModal onClose={() => setCreating(false)} />}
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
