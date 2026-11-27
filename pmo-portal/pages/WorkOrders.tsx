import React from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ViewToggle } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useFeature } from '@/src/auth/useFeature';
import { WorkOrdersBoard } from './work-orders/WorkOrdersBoard';
import { OwnerMaterialRollup } from './workOrders/OwnerMaterialRollup';

/** `/work-orders` (#2805): every work order the reader may see, with its figures; a row opens the work order. `?view=materials` (#3010) shows each one's owner-supplied material stages. */
const WorkOrders: React.FC = () => {
  const { t } = useTranslation('workOrders');
  const [params, setParams] = useSearchParams();
  const may = usePermission();
  const materialsOn = useFeature('stock') || may('view', 'clientRequisition');
  const view = materialsOn && params.get('view') === 'materials' ? 'materials' : 'board';
  const choose = (next: 'board' | 'materials') => setParams((c) => {
    const n = new URLSearchParams(c);
    if (next === 'materials') n.set('view', 'materials'); else n.delete('view');
    n.delete('mpage'); n.delete('open');
    return n;
  });
  return (
    <>
      {materialsOn && (
        <div className="mb-3">
          <ViewToggle<'board' | 'materials'> semantics="toggle" value={view} onChange={choose} ariaLabel={t('ownerMaterial.rollup.viewLabel', 'Work orders view')}
            options={[{ value: 'board', label: t('ownerMaterial.rollup.board', 'Work orders'), testId: 'wo-view-board' }, { value: 'materials', label: t('ownerMaterial.rollup.view', 'Materials'), testId: 'wo-view-materials' }]} />
        </div>
      )}
      {view === 'materials' ? <OwnerMaterialRollup /> : <WorkOrdersBoard />}
    </>
  );
};

export default WorkOrders;
