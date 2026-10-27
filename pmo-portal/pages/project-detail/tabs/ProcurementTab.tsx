import React from 'react';
import { useTranslation } from 'react-i18next';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';
import { Tooltip } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
import { ErpPurchasesSection } from '../ErpPurchasesSection';

export interface ProcurementTabProps {
  projectId: string;
}

/** Project-detail composition: shared PMO list/drawer plus its existing unlinked ERP section. */
const ProcurementTab: React.FC<ProcurementTabProps> = ({ projectId }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const canSeeMoney = may('view', 'procurement');
  const erp = useErpPurchases(projectId, { enabled: canSeeMoney });
  const showErp = canSeeMoney && (
    erp.isError || (erp.data ?? []).some((row) => row.procurementId === null || Number(row.outstanding ?? 0) > 0)
  );

  return (
    <div className="space-y-4">
      <ProcurementBlock projectId={projectId} />
      {showErp && (
        <div className="rounded-lg border border-border bg-card px-3 py-3 sm:px-4">
          <ErpPurchasesSection
            projectId={projectId}
            className="mt-0"
            title={t('projectDetail.procurement.erpCard.title', 'From the accounting system · not linked to a procurement')}
            subtitle={(
              <Tooltip content={t('projectDetail.procurement.erpCard.qualifier', 'These costs are already counted in project spending. Linking connects the paperwork and does not add spend.')}>
                <span tabIndex={0} className="rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  {t('projectDetail.procurement.erpCard.alreadyInSpending', 'Already in spending')}
                </span>
              </Tooltip>
            )}
          />
        </div>
      )}
    </div>
  );
};

export default ProcurementTab;
