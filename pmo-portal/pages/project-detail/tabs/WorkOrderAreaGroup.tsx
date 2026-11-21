import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui';
import { statusLabel } from '@/src/lib/status/statusMap';
import { useWorkOrderLists } from '@/src/hooks/useWorkOrderLists';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

/**
 * #2668 (FR-WAG-006/007): a row's area and group as text, and (for a Draft row, which carries no status colour today)
 * the status pill. Renders nothing while the organisation has no area or group list, so a screen reads as it always did.
 */
export const WorkOrderAreaGroup: React.FC<{ row: WorkOrderRow; withStatus?: boolean; wrapperClassName?: string }> = ({ row, withStatus = false, wrapperClassName }) => {
  const { t } = useTranslation('project');
  const { hasLists, areas, groups } = useWorkOrderLists();
  if (!hasLists) return null;
  const area = areas.find((entry) => entry.id === row.area_id)?.name;
  const group = groups.find((entry) => entry.id === row.group_id)?.name;
  const content = (
    <>
      {withStatus && <StatusPill variant="neutral">{statusLabel('workOrder', row.status, t)}</StatusPill>}
      {area && <span data-testid={`wo-area-${row.id}`} className="text-sm text-muted-foreground">{t('projectDetail.workOrders.areaLabel', 'Area')} {area}</span>}
      {group && <span data-testid={`wo-group-${row.id}`} className="text-sm text-muted-foreground">{t('projectDetail.workOrders.groupLabel', 'Group')} {group}</span>}
    </>
  );
  return wrapperClassName ? <span className={wrapperClassName}>{content}</span> : content;
};
