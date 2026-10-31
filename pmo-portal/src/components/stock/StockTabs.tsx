import React from 'react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { cn } from '@/src/components/ui';

/** Section strip shared by every /stock page: On hand | Documents | Ledger | Setup (Setup only for master-data writers). */
export const StockTabs: React.FC = () => {
  const { t } = useTranslation('stock');
  const may = usePermission();
  const tabs = [
    { to: '/stock', label: t('tabs.onHand'), end: true },
    { to: '/stock/documents', label: t('tabs.documents'), end: false },
    { to: '/stock/ledger', label: t('tabs.ledger'), end: true },
    ...(may('create', 'stockItem') ? [{ to: '/stock/setup', label: t('tabs.setup'), end: true }] : []),
  ];
  return (
    <nav aria-label={t('tabs.label')} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((x) => (
        <NavLink
          key={x.to}
          to={x.to}
          end={x.end}
          className={({ isActive }) =>
            cn('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')
          }
        >
          {x.label}
        </NavLink>
      ))}
    </nav>
  );
};
