import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox } from '@/src/components/ui';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { BUILT_IN_ROLES } from '@/src/auth/builtInRoles';
import { isLightRoleKey } from '@/src/auth/lightAccount';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { workOrderMaterialAlertsRepository } from '@/src/lib/repositories/workOrderMaterialAlerts';

/**
 * Which roles are told, besides the project manager, when material issued to a work order runs ahead of its progress
 * (material-vs-progress FR-MVP-010). An Admin edits; anyone else sees the list read-only with the reason. The database refuses a
 * non-Admin and any key that is not a built-in role. A light account is never told, so those roles are not offered.
 */
export function WorkOrderAheadAlertRolesPanel({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation('stock');
  const errorText = useStockErrorText();
  const roleName = useBuiltInRoleName();
  const qc = useQueryClient();
  const current = useQuery({ queryKey: ['wo-ahead-alert-roles'], queryFn: () => workOrderMaterialAlertsRepository.roles() });
  const [draft, setDraft] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const selected = draft ?? current.data ?? [];
  const save = useMutation({
    mutationFn: () => workOrderMaterialAlertsRepository.setRoles(selected),
    onSuccess: async () => { setError(''); setSaved(true); setDraft(null); await qc.invalidateQueries({ queryKey: ['wo-ahead-alert-roles'] }); },
    onError: (err) => { setSaved(false); setError(errorText(err) || t('siteWork.materialProgress.alert.roles.saveError')); },
  });
  const toggle = (key: string, on: boolean) => {
    setSaved(false); setError('');
    setDraft(on ? [...selected, key] : selected.filter((k) => k !== key));
  };
  const offered = BUILT_IN_ROLES.filter((r) => !isLightRoleKey(r.key));
  return (
    <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t('siteWork.materialProgress.alert.roles.manage')}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setSaved(false); save.mutate(); }}>
        <fieldset className="space-y-2" disabled={!canEdit || current.isPending}>
          <legend className="text-control font-semibold">{t('siteWork.materialProgress.alert.roles.label')}</legend>
          <p className="text-sm text-muted-foreground">{t('siteWork.materialProgress.alert.roles.help')}</p>
          {current.isError && <p role="alert" className="text-sm text-destructive-text">{t('siteWork.materialProgress.alert.roles.loadError')}</p>}
          {selected.length === 0 && !current.isPending && <p className="text-sm text-muted-foreground">{t('siteWork.materialProgress.alert.roles.none')}</p>}
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {offered.map((r) => (
              <Checkbox key={r.key} checked={selected.includes(r.key)} disabled={!canEdit || current.isPending}
                onChange={(on) => toggle(r.key, on)} label={roleName(r.key)}>
                {roleName(r.key)}
              </Checkbox>
            ))}
          </div>
        </fieldset>
        {!canEdit && <p className="text-sm text-muted-foreground">{t('siteWork.materialProgress.alert.roles.adminOnly')}</p>}
        {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
        {saved && <p role="status" className="text-sm text-muted-foreground">{t('siteWork.materialProgress.alert.roles.saved')}</p>}
        {canEdit && <Button variant="primary" type="submit" disabled={draft === null || save.isPending || current.isPending}>{t('siteWork.materialProgress.alert.roles.save')}</Button>}
      </form>
    </section>
  );
}
