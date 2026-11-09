/** AC-ODC-060, FR-ODC-080: the org's default receiving warehouse, chosen from active warehouses only. Archiving or deleting it in Odoo marks it "needs attention" rather than silently keeping it. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, SelectField, StatusPill } from '@/src/components/ui';
import { useMasterRecords, useOdooConnection, useOdooSetup } from '@/src/hooks/useOdoo';
import { odooErrorMessage } from './odooErrors';
import { useOdooCan } from './useOdooCan';

const PAGE = 200;

export function OdooWarehouseDefault() {
  const { t } = useTranslation();
  const may = useOdooCan();
  const read = useOdooConnection().data;
  const ready = read?.status === 'active' && read.activated;
  const savedId = typeof read?.config.default_warehouse_id === 'string' ? read.config.default_warehouse_id : null;
  const list = useMasterRecords({ kind: 'warehouse', page: 1, pageSize: PAGE }, Boolean(ready));
  // The saved warehouse is read by id with inactive rows included, so an archived or deleted one can be named.
  const chosen = useMasterRecords({ kind: 'warehouse', page: 1, pageSize: 1, externalIds: savedId ? [savedId] : [], includeInactive: true }, Boolean(ready && savedId));
  const save = useOdooSetup('save-defaults');
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!ready) return null;

  const live = (list.data?.rows ?? []).filter((r) => r.active && !r.tombstoned_at);
  const savedRow = chosen.data?.rows[0];
  const savedState = !savedId || !chosen.data ? null : !savedRow || savedRow.tombstoned_at ? 'deleted' : !savedRow.active ? 'archived' : null;
  const label = (r: { code: string | null; name: string }) => [r.code, r.name].filter(Boolean).join(' ');
  const value = picked ?? (savedId && !savedState ? savedId : '');

  if (!may.setValue) {
    return savedId && !savedState && savedRow ? (
      <p className="text-sm text-muted-foreground" data-testid="odoo-warehouse-default">{t('administration:odoo.warehouse.current', 'Default receiving warehouse')}: <span className="font-medium text-foreground">{savedRow.name}</span></p>
    ) : null;
  }
  const submit = async () => {
    setError(null);
    try { await save.mutateAsync({ default_warehouse_id: value }); setPicked(null); } catch (err) { setError(odooErrorMessage(t, err)); }
  };
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="odoo-warehouse-default">
      <div className="min-w-0 flex-1 basis-64">
        <SelectField label={t('administration:odoo.mapOnce.warehouseLabel', 'Default receiving warehouse')} value={value} onChange={setPicked} placeholder={t('administration:odoo.mapOnce.choose', 'Choose…')}
          options={live.map((r) => ({ value: r.external_id, label: label(r) }))} fullWidth />
      </div>
      <Button size="sm" variant="outline" loading={save.isPending} disabled={!value || value === savedId} onClick={() => void submit()}>{t('administration:odoo.warehouse.save', 'Save')}</Button>
      {savedState && (
        <p className="flex basis-full flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <StatusPill variant="warn">{t('administration:odoo.mapOnce.attention', 'Needs attention')}</StatusPill>
          <span>{savedState === 'archived'
            ? t('administration:odoo.warehouse.archived', 'Needs attention: the default warehouse was archived in Odoo. Choose another.')
            : t('administration:odoo.warehouse.deleted', 'Needs attention: the default warehouse was deleted in Odoo. Choose another.')}</span>
        </p>
      )}
      {error && <p role="alert" className="basis-full text-sm text-destructive">{error}</p>}
    </div>
  );
}
