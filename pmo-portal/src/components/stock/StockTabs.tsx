import React from 'react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { cn } from '@/src/components/ui';

/** The filter row of a stock page: under the section tabs, so the tabs stay the first thing on every stock screen. */
export const StockFilters: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>
);

/** Section strip shared by every /stock page: On hand | Documents | Ledger | Reorder | Setup (Setup only for master-data writers). */
export const StockTabs: React.FC = () => {
  const { t } = useTranslation('stock');
  const may = usePermission();
  const tabs = [
    { to: '/stock', label: t('tabs.onHand'), end: true },
    { to: '/stock/documents', label: t('tabs.documents'), end: false },
    { to: '/stock/ledger', label: t('tabs.ledger'), end: true },
    { to: '/stock/reorder', label: t('tabs.reorder'), end: true },
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
  return (
    <nav
      ref={scrollerRef}
      aria-label={t('tabs.label')}
      className={cn('mb-4 flex gap-1 overflow-x-auto border-b border-border', moreToRight && 'scroll-fade-x')}
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
    </nav>
  );
};
