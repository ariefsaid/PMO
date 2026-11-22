import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MyDelivery } from '@/src/lib/repositories/myHome';
import { MySection } from './MySection';

/**
 * Deliveries addressed to the person: a transfer sent to them that waits for their count. Each row opens the transfer, where they
 * count, photograph and confirm (`receive_stock_transfer`). Shown on the phone home of a light account and on the full account's
 * home; nothing is shown while the list is empty.
 */
export const DeliveriesSection: React.FC<{ deliveries: MyDelivery[] }> = ({ deliveries }) => {
  const { t } = useTranslation('myHome');
  if (deliveries.length === 0) return null;
  return (
    <MySection id="my-deliveries" title={t('myHome:deliveries.title', 'A delivery for you')}>
      <ul className="space-y-2">
        {deliveries.map((d) => (
          <li key={d.id}>
            <Link to={`/stock/transfers/${d.id}`} className="block min-h-11 rounded-md border border-border p-3 text-control">
              <span className="font-medium">{d.number}</span>
              <span className="block text-muted-foreground">{t('myHome:deliveries.lines', { count: d.lineCount })}{d.description ? ` · ${d.description}` : ''}</span>
              <span className="block font-medium">{t('myHome:deliveries.open', 'Count and confirm')}</span>
            </Link>
          </li>))}
      </ul>
    </MySection>
  );
};
