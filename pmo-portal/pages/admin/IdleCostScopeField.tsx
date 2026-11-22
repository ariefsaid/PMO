import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useIdleCostEnabled, useIdleCostScope, useSetIdleCostScope } from '@/src/hooks/useIdleCost';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { IdleCostScope } from '@/src/lib/db/idleCost';

/**
 * The "Idle cost covers" choice (idle-with-rent, AC-IWR-012), rendered inside Administration › Modules › Billing extras.
 * #2746 removed the standalone on/off switch card (idle time as cost is on for everyone); this module card is where the
 * catalogue routes the idle-cost settings, so the scope choice lives here. Admin and Finance change it; it stays hidden
 * while idle cost is off (nothing to cover yet) and from viewers who may not read the labour-cost settings. The
 * migration-1730 RPC is the authority (ADR-0016); `can()` only hides what would be refused.
 */
export default function IdleCostScopeField() {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canView = may('view', 'labourCost');
  const canManage = may('manage', 'labourCost');
  const { toast } = useToast();
  const enabledQ = useIdleCostEnabled(canView);
  const scopeQ = useIdleCostScope(canView);
  const setScope = useSetIdleCostScope();
  if (!canView) return null;
  if (enabledQ.data !== true || scopeQ.data === undefined) return null;
  const refusals = { '42501': t('idleCost.adminOnly', 'Only an Admin or Finance can change this setting.') };
  return <SelectField id="idle-cost-scope" label={t('idleCost.scope', 'Idle cost covers')} value={scopeQ.data}
    disabled={!canManage || setScope.isPending}
    helper={t('idleCost.scopeHelper', 'People: idle hours times the crew present each day. Equipment: standby cost of rented equipment on days with idle time. Neither is added to direct cost.')}
    onChange={(v) => setScope.mutate(v as IdleCostScope, { onError: (e) => { const c = classifyMutationError(e, refusals); toast(c.headline, c.detail, 'warning'); } })}
    options={[
      { value: 'labour_average', label: t('idleCost.scopeLabour', 'Idle hours at the average hourly cost') },
      { value: 'people_and_equipment', label: t('idleCost.scopePeopleEquipment', 'People present and rented equipment on standby') },
    ]} />;
}
