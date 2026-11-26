import { useSettingsSaveEntry } from '@/src/components/admin/settingsSaveContext';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, RecordSection, SelectField, useToast } from '@/src/components/ui';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { materialRequestRepository as repo } from '@/src/lib/repositories/materialRequests';
import type { UsageInstalledSource } from '@/src/lib/db/materialRequests';
import { useUsageInstalledSource } from '@/src/hooks/useMaterialRequests';
import { useRefusalLine } from '@/src/lib/refusals';

/** The Admin chooses what counts as installed material for the usage warning: validated site reports (default) or storekeeper issues. */
export const UsageInstalledSourceEditor: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { toast } = useToast();
  const refusal = useRefusalLine();
  const q = useUsageInstalledSource();
  const [edited, setEdited] = useState<UsageInstalledSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setEdited(null); }, [q.data]);
  const value = edited ?? q.data ?? 'site_reports';
  const save = async () => {
    if (edited === null) return;
    setError(null); setSaving(true);
    try { await repo.setUsageInstalledSource(edited); await q.refetch(); toast(t('usage.installedSaved', 'Source saved'), undefined, 'success'); }
    catch (err) { setError(refusal(err)); }
    finally { setSaving(false); }
  };
  const pageSave = useSettingsSaveEntry({ dirty: edited !== null && edited !== q.data, invalid: q.isError, busy: saving, save });
  return (
    <RecordSection title={t('usage.installedTitle', 'What counts as installed')} subline={t('usage.installedSub', 'The usage warning compares installed material with the plan. Choose where installed quantities come from.')}>
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      <div className="flex flex-wrap items-end gap-2">
        <SelectField label={t('usage.installedLabel', 'Installed material comes from')} value={value} onChange={(v) => setEdited(v as UsageInstalledSource)}
          options={[{ value: 'site_reports', label: t('usage.installedSiteReports', 'Validated site reports') }, { value: 'stock_issues', label: t('usage.installedStockIssues', 'Storekeeper issues to the work order (less returns)') }]} />
        {!pageSave && <Button variant="primary" disabled={edited === null || edited === q.data} loading={saving} onClick={() => void save()}>{t('usage.installedSave', 'Save source')}</Button>}
      </div>
    </RecordSection>
  );
};
