import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MyHomeWorkOrder } from '@/src/lib/repositories/myHome';
import { useTerms } from '@/src/lib/i18n/terms';
import { MySection } from './MySection';

/**
 * The work orders the person is on today (their roster), under the terminology dictionary's name: project and crew, so a person
 * can see which job they are on. Read-only; a light account has no work-order page.
 */
export const MyWorkOrders: React.FC<{ workOrders: MyHomeWorkOrder[] }> = ({ workOrders }) => {
  const { t } = useTranslation('myHome');
  const terms = useTerms();
  const unique = [...new Map(workOrders.map((w) => [w.work_order_id, w])).values()];
  return (
    <MySection id="my-work-orders" title={terms.clientWorkOrder}>
      {unique.length === 0 ? <p className="text-control text-muted-foreground">{t('myHome:workOrders.empty', 'You are not on a work order today')}</p> : (
        <ul className="space-y-2">
          {unique.map((w) => (
            <li key={w.work_order_id} className="rounded-md border border-border p-3">
              <p className="text-control font-semibold">{w.title}</p>
              <p className="text-control text-muted-foreground">{w.project_name} · {w.crew_name}</p>
            </li>
          ))}
        </ul>
      )}
    </MySection>
  );
};
