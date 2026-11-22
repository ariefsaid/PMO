import React from 'react';
import { NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { cn } from '@/src/components/ui';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { useIsTwoStep } from '@/src/hooks/useStockTransfers';

/** The filter row of a stock page: under the section tabs, so the tabs stay the first thing on every stock screen. */
export const StockFilters: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>
);

/** Section strip shared by every /stock page: On hand | Documents | Ledger | Reorder | Setup (Setup only for master-data writers). */
const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground');

/** #2690: the Transfers tab exists only once an organisation turns two-step transfers on. */
const TransfersTab: React.FC = () => {
  const { t } = useTranslation('stock');
  const twoStep = useIsTwoStep();
  return twoStep ? <NavLink to="/stock/transfers" end={false} className={tabClass}>{t('tabs.transfers')}</NavLink> : null;
};

export const StockTabs: React.FC = () => {
  const { t } = useTranslation('stock');
  const may = usePermission();
  const { pathname } = useLocation();
  const auth = React.useContext(AuthContext);
  const queryClient = React.useContext(QueryClientContext);
  const hasProviders = Boolean(auth) && Boolean(queryClient); // the Transfers tab reads the organisation's setting
  const tabs = [
    { to: '/stock', label: t('tabs.onHand'), end: true },
    { to: '/stock/documents', label: t('tabs.documents'), end: false },
    { to: '/stock/ledger', label: t('tabs.ledger'), end: true },
    { to: '/stock/reorder', label: t('tabs.reorder'), end: true },
    { to: '/stock/usage-standards', label: t('tabs.usageStandards', 'Usage standards'), end: true },
    { to: '/stock/at-risk', label: t('tabs.atRisk'), end: true },
    ...(may('create', 'stockItem') ? [{ to: '/stock/setup', label: t('tabs.setup'), end: true }] : []),
  ];
  // F10: the grey rule under the strip IS this nav's own bottom border, so a permanent right-edge mask
  // faded the rule's last pixels away although nothing overflowed. The mask now appears only while there
  // is still something to the right to scroll to; when every tab fits, the rule runs edge to edge as on dev.
  const scrollerRef = React.useRef<HTMLElement | null>(null);
  const [moreToRight, setMoreToRight] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setMoreToRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  });
  React.useLayoutEffect(() => {
    const currentTab = scrollerRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    currentTab?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [pathname]);
  return (
    <nav
      ref={scrollerRef}
      aria-label={t('tabs.label')}
      className={cn('mb-4 flex flex-wrap gap-x-1 border-b border-border md:flex-nowrap md:overflow-x-auto', moreToRight && 'scroll-fade-x')}
    >
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
      {hasProviders && <TransfersTab />}
    </nav>
  );
};
