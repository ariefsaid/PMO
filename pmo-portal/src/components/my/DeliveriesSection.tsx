import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MyDelivery } from '@/src/lib/repositories/myHome';
import { MySection } from './MySection';

/**
 * Deliveries addressed to the person, to confirm with count and photo. SEAM: the handover ticket (OD-SCOPE-10) supplies the source
 * (`useMyDeliveries`) and the confirm action; this build writes nothing and shows nothing while the list is empty.
 */
export const DeliveriesSection: React.FC<{ deliveries: MyDelivery[] }> = ({ deliveries }) => {
  const { t } = useTranslation('myHome');
  if (deliveries.length === 0) return null;
  return (
    <MySection id="my-deliveries" title={t('myHome:deliveries.title', 'Deliveries to confirm')}>
      <ul className="space-y-2">
        {deliveries.map((d) => <li key={d.id} className="rounded-md border border-border p-3 text-control">{d.description}</li>)}
      </ul>
    </MySection>
  );
};
