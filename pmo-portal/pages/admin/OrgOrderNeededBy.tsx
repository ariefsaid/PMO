import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Checkbox, FieldError, ListState } from '@/src/components/ui';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { getPoNeededByRequired, setPoNeededByRequired } from '@/src/lib/db/procurementNeededBy';

const KEY = 'org-po-needed-by-required';

/** 1124d — Administration: require a needed-by date before an order is sent to the supplier. Off by default; orders created before it is turned on are never blocked. Only an Admin changes it (the RPC is the authority). */
export default function OrgOrderNeededBy() {
  const { t } = useTranslation('procurement');
  const orgId = useAuth().currentUser?.org_id;
  const canManage = usePermission()('manage', 'orgAccounting');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [KEY, orgId], queryFn: getPoNeededByRequired, enabled: Boolean(orgId), ...SESSION_QUERY_OPTIONS });
  const set = useMutation({ mutationFn: (on: boolean) => setPoNeededByRequired(on), onSuccess: () => { void qc.invalidateQueries({ queryKey: [KEY, orgId] }); } });
  const error = set.isError ? classifyMutationError(set.error) : null;
  return (
    <section aria-labelledby="order-needed-by-heading">
      <h2 id="order-needed-by-heading" tabIndex={-1} className="scroll-mt-4 text-group font-semibold">{t('orderNeededBy.settingHeading', 'Order needed-by date')}</h2>
      <div className="mt-3 max-w-md space-y-3">
        {q.isError ? <ListState variant="error" title={t('orderNeededBy.loadError', 'Couldn’t load this setting')} onRetry={() => void q.refetch()} />
          : q.isPending ? <ListState variant="loading" rows={1} />
          : (
            <>
              <p className="text-control text-muted-foreground">{t('orderNeededBy.settingHelp', 'When on, an order cannot be sent to the supplier until it has a needed-by date. Orders created before you turn this on are not blocked.')}</p>
              <Checkbox label={t('orderNeededBy.settingLabel', 'Require a needed-by date before an order is sent')} checked={q.data === true} disabled={!canManage || set.isPending}
                onChange={(c) => set.mutate(c === true)}>{t('orderNeededBy.settingLabel', 'Require a needed-by date before an order is sent')}</Checkbox>
              {!canManage && <p className="text-control text-muted-foreground">{t('linePlanning.onlyAdmin', 'Only an Admin can change this.')}</p>}
            </>
          )}
        {error && <FieldError>{error.detail || error.headline}</FieldError>}
      </div>
    </section>
  );
}
