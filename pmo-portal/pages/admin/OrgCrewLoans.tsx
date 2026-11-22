import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useOrgSwitch, useSetOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { FieldError, ListState, Switch } from '@/src/components/ui';

/**
 * Administration › People › Crew loans (#2704, migration 1249). Off by default: the Crews page then shows no loans.
 * Anyone who can open Administration sees the switch; only an Admin changes it (UX gate; `set_org_crew_loans_enabled`
 * is the authority, ADR-0016).
 */
export default function OrgCrewLoans() {
  const { t } = useTranslation('administration');
  const canManage = usePermission()('manage', 'orgAccounting');
  const labelId = useId();
  const query = useOrgSwitch('crewLoans');
  const mutation = useSetOrgSwitch('crewLoans');
  const saveError = mutation.isError ? classifyMutationError(mutation.error) : null;
  return (
    <section id="org-crew-loans" tabIndex={-1} className="scroll-mt-4 mt-6" aria-labelledby="org-crew-loans-heading">
      <h2 id="org-crew-loans-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.crewLoans.title', 'Crew loans')}</h2>
      <div className="mt-3 max-w-md">
        {query.isError ? <ListState variant="error" title={t('admin.crewLoans.loadError', "Couldn't load the crew loans setting")} onRetry={() => void query.refetch()} />
          : query.isPending ? <ListState variant="loading" rows={1} />
          : (
            <label className="flex min-h-11 items-start gap-3 py-1.5 text-control">
              <Switch checked={query.data === true} onChange={(next) => { mutation.reset(); mutation.mutate(next); }} labelledBy={labelId}
                disabled={!canManage || mutation.isPending} className="mt-0.5" />
              <span className="min-w-0">
                <span id={labelId} className="block font-medium">{t('admin.crewLoans.label', 'Allow lending workers between crews')}</span>
                <span className="block text-muted-foreground">{t('admin.crewLoans.helper', 'A lent worker follows the host crew on its roster and attendance for the loan period. Off, the Crews page shows no loans.')}</span>
              </span>
            </label>
          )}
        {!canManage && <p className="mt-2 text-control text-muted-foreground">{t('admin.crewLoans.adminOnly', 'Only an Admin can change this.')}</p>}
        {saveError && <FieldError>{saveError.detail || saveError.headline}</FieldError>}
      </div>
    </section>
  );
}
