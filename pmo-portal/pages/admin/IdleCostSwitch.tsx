import React from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, ListState, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useIdleCostEnabled, useSetIdleCostEnabled } from '@/src/hooks/useIdleCost';
import { useLabourCostEnabled } from '@/src/hooks/useLabourCost';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * Administration › Idle time as cost (#2673, spec docs/specs/idle-hours-cost.spec.md). Admin and Finance switch it on;
 * it works only while labour cost in money is on. OFF by default. The migration-1255 RPC is the authority (ADR-0016);
 * `can()` only hides what would be refused. Idle reasons stay where they already are (the client's own list).
 */
export default function IdleCostSwitch() {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canView = may('view', 'labourCost');
  const canManage = may('manage', 'labourCost');
  const { toast } = useToast();
  const labourQ = useLabourCostEnabled(canView);
  const q = useIdleCostEnabled(canView);
  const set = useSetIdleCostEnabled();
  if (!canView) return null;
  const labourOn = labourQ.data === true;
  const refusals = { '42501': t('idleCost.adminOnly', 'Only an Admin or Finance can change this setting.') };
  const title = t('idleCost.title', 'Idle time as cost');
  return <section aria-label={title} className="max-w-3xl space-y-3" data-testid="idle-cost-settings">
    <h3 className="text-base font-semibold">{title}</h3>
    <p className="text-sm text-muted-foreground">{t('idleCost.intro', 'Cost the idle hours recorded on daily site reports at the work order\'s average hourly cost, per idle reason. Shown apart from direct cost, which already includes those hours. Needs labour cost in money.')}</p>
    {q.isError ? <ListState variant="error" title={t('idleCost.loadError', "Couldn't load this setting")} retryLabel={t('admin.retry', 'Retry')} onRetry={() => void q.refetch()} />
      : q.data === undefined ? <ListState variant="loading" rows={1} />
      : <Checkbox checked={q.data} disabled={!canManage || set.isPending}
          label={t('idleCost.switch', 'Cost idle hours in money')}
          onChange={(v) => set.mutate(v, { onError: (e) => { const c = classifyMutationError(e, refusals); toast(c.headline, c.detail, 'warning'); } })} />}
    {q.data === true && !labourOn && <p role="status" className="text-sm text-muted-foreground">{t('idleCost.needsLabour', 'Nothing shows until labour cost in money is switched on.')}</p>}
    {!canManage && <p className="text-sm text-muted-foreground">{t('idleCost.adminOnly', 'Only an Admin or Finance can change this setting.')}</p>}
  </section>;
}
