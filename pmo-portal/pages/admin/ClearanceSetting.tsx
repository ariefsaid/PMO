import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { FieldError, ListState, Switch } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useOrgSwitch, useSetOrgSwitch } from '@/src/hooks/useOrgSwitch';

/**
 * #2707 — the organisation switch for the cleared-for-site checklist, default off. Anyone who can open the People section sees
 * it; only an Admin changes it (UX gate; RLS and the column grant are the authority). While off, nothing else in PMO changes.
 */
export default function ClearanceSetting() {
  const { t } = useTranslation('administration');
  const labelId = useId();
  const canManage = usePermission()('manage', 'clearanceItem');
  const q = useOrgSwitch('clearance');
  const m = useSetOrgSwitch('clearance');
  const err = m.isError ? classifyMutationError(m.error) : null;
  return (
    <section aria-labelledby="clearance-setting-heading" className="mt-6 border-t border-border pt-6">
      <h2 id="clearance-setting-heading" className="text-group font-semibold">{t('clearance.setting.heading', 'Cleared-for-site checklist')}</h2>
      <div className="mt-3 max-w-md">
        {q.isError ? <ListState variant="error" title={t('clearance.setting.loadError', 'Couldn’t load this setting')} onRetry={() => void q.refetch()} />
          : q.isPending ? <ListState variant="loading" rows={1} />
          : (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-control">
              <Switch checked={q.data} onChange={(next) => { m.reset(); m.mutate(next); }} labelledBy={labelId} disabled={!canManage || m.isPending} className="mt-0.5" />
              <span className="min-w-0">
                <span id={labelId} className="block font-medium">{t('clearance.setting.label', 'Track who is cleared to go to site')}</span>
                <span className="block text-muted-foreground">{t('clearance.setting.help', 'Adds a Clearance section where you list what each person needs and record when it is done. Nothing else changes.')}</span>
              </span>
            </label>
          )}
        {!canManage && <p className="mt-2 text-control text-muted-foreground">{t('clearance.setting.onlyAdmin', 'Only an Admin can change this.')}</p>}
        {err && <FieldError>{err.detail || err.headline}</FieldError>}
      </div>
    </section>
  );
}
