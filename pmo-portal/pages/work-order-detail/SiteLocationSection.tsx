import React from 'react';
import { useTranslation } from 'react-i18next';
import { RecordSection, SelectField } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useDsrStockMutations, useDsrStockSettings, useSiteLocations, useWorkOrderSiteLocation } from '@/src/hooks/useDsrStockIssue';

/** #2676: the work order's site location, where validated daily reports take material from. Shown only while the organisation's setting is on. */
export const SiteLocationSection: React.FC<{ workOrderId: string; projectId: string }> = ({ workOrderId, projectId }) => {
  const { t } = useTranslation('workOrders');
  const may = usePermission();
  const on = useDsrStockSettings().data?.enabled === true;
  const current = useWorkOrderSiteLocation(workOrderId, on);
  const options = useSiteLocations(projectId, on);
  const { setLocation } = useDsrStockMutations();
  if (!on || current.data === undefined) return null;
  const canEdit = may('create', 'workOrder');
  const name = (options.data ?? []).find((o) => o.id === current.data)?.name;
  return (
    <RecordSection title={t('siteLocation.title', 'Site location')} data-testid="wo-site-location">
      {canEdit ? (
        <SelectField label={t('siteLocation.label', 'Material for daily reports comes from')} value={current.data ?? ''} disabled={setLocation.isPending}
          onChange={(v) => setLocation.mutate({ workOrderId, warehouseId: v || null })}
          options={[{ value: '', label: t('siteLocation.none', 'Not set') }, ...(options.data ?? []).map((o) => ({ value: o.id, label: o.name }))]}
          helper={t('siteLocation.help', 'A validated daily report issues its material from here to this work order.')} />
      ) : (
        <p className="text-foreground">{name ?? t('siteLocation.none', 'Not set')}</p>
      )}
      {setLocation.isError && <p role="alert" className="text-destructive">{t('siteLocation.error', "Couldn't save the site location")}</p>}
    </RecordSection>
  );
};
