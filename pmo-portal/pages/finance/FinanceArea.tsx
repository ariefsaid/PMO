import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useFeature } from '@/src/auth/useFeature';
import { AccessDenied, Button, Icon, Tabs, ViewToggle } from '@/src/components/ui';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { FinanceAttention } from '@/src/components/finance/FinanceAttention';
import { PayablesList } from '@/src/components/finance/PayablesList';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { useFinancialStatementCatalogue } from '@/src/hooks/useFinancialStatements';
import { formatCurrencyCents, formatMonthYear } from '@/src/lib/format';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import SalesInvoices from '@/pages/SalesInvoices';
import IncomingPayments from '@/pages/IncomingPayments';
import ManagementPack from '@/pages/ManagementPack';
import FinancialStatements from '@/pages/FinancialStatements';

type FinanceLayout = 'a' | 'b' | 'c';
type FinanceAreaName = 'receivables' | 'payables' | 'reports' | 'statements';

const AREA_NAMES: FinanceAreaName[] = ['receivables', 'payables', 'reports', 'statements'];
const RECEIVABLE_BUCKETS = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;

const currencyLine = (values: Record<string, number>): string =>
  Object.entries(values).map(([currency, amount]) => formatCurrencyCents(amount, currency)).join(' · ');

const formatMonth = (date: string): string => formatMonthYear(new Date(`${date.slice(0, 10)}T12:00:00Z`));

function totalReceivablesByCurrency(position: FinancePosition): Record<string, number> {
  return Object.fromEntries(Object.entries(position.receivablesAgeing).map(([currency, buckets]) => [
    currency,
    RECEIVABLE_BUCKETS.reduce((sum, key) => sum + buckets[key], 0),
  ]));
}

function useLayoutLink(layout: FinanceLayout) {
  return useCallback((path: string) => {
    const url = new URL(path, window.location.origin);
    url.searchParams.set('layout', layout);
    return `${url.pathname}${url.search}${url.hash}`;
  }, [layout]);
}

const FinanceArea: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const location = useLocation();
  const navigate = useNavigate();
  const { area: routeArea } = useParams<{ area?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedLayout = searchParams.get('layout');
  const layout: FinanceLayout = requestedLayout === 'b' || requestedLayout === 'c' ? requestedLayout : 'a';
  const withLayout = useLayoutLink(layout);
  const canView = may('view', 'finance');
  const canAct = may('act', 'finance');
  const hasRevenue = useFeature('revenue');
  const hasProcurement = useFeature('procurement');
  const canViewStatements = may('view', 'financialStatements');
  const finance = useFinancePosition(canView);
  const reportSummary = useManagementPack({}, canView && layout === 'b' && hasRevenue);
  const statementCatalogue = useFinancialStatementCatalogue({ kind: 'company' }, canView && layout === 'b' && canViewStatements);
  const [receivablesView, setReceivablesView] = useState<'invoices' | 'payments'>(
    searchParams.get('view') === 'payments' ? 'payments' : 'invoices',
  );

  const areaLabels: Record<FinanceAreaName, string> = {
    receivables: t('finance:area.receivables', 'Receivables'),
    payables: t('finance:area.payables', 'Payables'),
    reports: t('finance:area.reports', 'Reports'),
    statements: t('finance:area.statements', 'Statements'),
  };
  const availableAreas = useMemo(() => AREA_NAMES.filter((area) =>
    area === 'receivables' || area === 'reports' ? hasRevenue
      : area === 'payables' ? hasProcurement
        : canViewStatements,
  ), [canViewStatements, hasProcurement, hasRevenue]);
  const activeArea: FinanceAreaName = AREA_NAMES.includes(routeArea as FinanceAreaName)
    ? routeArea as FinanceAreaName
    : 'receivables';
  const isAreaRoute = routeArea !== undefined;
  const defaultArea = availableAreas[0] ?? 'receivables';
  const jumpAreaIds = useMemo(() => {
    const preferred = canAct
      ? ['needs-you', 'receivables', 'payables', 'reports', 'statements']
      : ['reports', 'statements', 'receivables', 'payables'];
    return preferred.filter((id) => id === 'needs-you' ? canAct : availableAreas.includes(id as FinanceAreaName));
  }, [availableAreas, canAct]);
  const [activeJump, setActiveJump] = useState(() => location.hash.slice(1) || routeArea || jumpAreaIds[0] || 'receivables');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (requestedLayout !== 'off' && isAreaRoute && !AREA_NAMES.includes(routeArea as FinanceAreaName)) {
      navigate(withLayout('/finance'), { replace: true });
    }
  }, [isAreaRoute, navigate, requestedLayout, routeArea, withLayout]);

  useEffect(() => {
    if (layout === 'a' && !availableAreas.includes(activeArea)) {
      navigate(withLayout(`/finance/${defaultArea}`), { replace: true });
    }
  }, [activeArea, availableAreas, defaultArea, layout, navigate, withLayout]);

  useEffect(() => {
    if ((layout === 'b' || layout === 'c') && isAreaRoute && !availableAreas.includes(activeArea)) {
      navigate(withLayout('/finance'), { replace: true });
    }
  }, [activeArea, availableAreas, isAreaRoute, layout, navigate, withLayout]);

  const createInvoice = () => {
    const path = layout === 'a' || layout === 'b' ? '/finance/receivables' : '/finance';
    const params = new URLSearchParams(layout === 'c' ? searchParams : undefined);
    params.set('layout', layout);
    params.set('create', '1');
    navigate(`${path}?${params.toString()}`);
  };

  const changeReceivablesView = (view: 'invoices' | 'payments') => {
    setReceivablesView(view);
    const next = new URLSearchParams(searchParams);
    next.set('layout', layout);
    if (view === 'payments') next.set('view', 'payments');
    else next.delete('view');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    setReceivablesView(searchParams.get('view') === 'payments' ? 'payments' : 'invoices');
  }, [searchParams]);

  const attentionProps = {
    position: finance.position,
    canAct,
    isPending: finance.isPending,
    isError: finance.isError,
    onRetry: finance.retry,
    withLayout,
  };

  const receivablesContent = (showAttention: boolean) => (
    <div className="min-w-0">
      {showAttention && <FinanceAttention {...attentionProps} scope="receivables" />}
      <AgeingStrip kind="receivables" values={finance.position.receivablesAgeing} />
      <div className="mb-3 max-w-full overflow-x-auto">
        <ViewToggle
          options={[
            { value: 'invoices', label: t('finance:area.invoicesList', 'Invoices') },
            { value: 'payments', label: t('finance:area.paymentsList', 'Payments received') },
          ]}
          value={receivablesView}
          onChange={changeReceivablesView}
          ariaLabel={t('finance:area.viewInvoicesOrPayments', 'Receivables list')}
        />
      </div>
      {receivablesView === 'payments' ? <IncomingPayments embedded /> : <SalesInvoices embedded />}
    </div>
  );

  const payablesContent = () => (
    <div className="min-w-0">
      <AgeingStrip kind="payables" values={finance.position.payablesAgeing} />
      <PayablesList position={finance.position} isPending={finance.isPending} isError={finance.isError} onRetry={finance.retry} withLayout={withLayout} />
    </div>
  );

  const areaContent = (area: FinanceAreaName, showAttention = false) => {
    if (area === 'receivables') return receivablesContent(showAttention);
    if (area === 'payables') return payablesContent();
    if (area === 'reports') return <ManagementPack embedded />;
    return <FinancialStatements embedded />;
  };

  const owedAmounts = totalReceivablesByCurrency(finance.position);
  const receivablesAnswer = t('finance:area.receivablesAnswer', '{{owed}} owed to you · {{overdue}} overdue', {
    owed: currencyLine(owedAmounts) || '—',
    overdue: currencyLine(finance.position.overdueTotals) || '—',
  });
  const payablesAnswer = t('finance:area.payablesAnswer', '{{amount}} to pay suppliers', {
    amount: currencyLine(finance.position.payablesTotals) || '—',
  });
  const reportTotals = reportSummary.data?.totals ?? [];
  const reportMonth = reportSummary.data?.to ? formatMonth(reportSummary.data.to) : '';
  const reportAmount = reportTotals.map((total) => {
    const month = total.months[total.months.length - 1];
    return month ? formatCurrencyCents(month.unbilled, total.currency) : null;
  }).filter((amount): amount is string => amount !== null).join(' · ');
  const reportAnswer = reportSummary.isPending || reportSummary.isError || !reportMonth
    ? t('finance:area.notAvailableYet', 'Not available yet')
    : t('finance:area.revenueAnswer', '{{amount}} earned, not yet invoiced · through {{month}}', {
      amount: reportAmount || '—',
      month: reportMonth,
    });
  const latestStatement = (statementCatalogue.data?.periods ?? [])
    .filter((period) => period.currentStart <= (finance.today ?? '9999-12-31'))
    .slice()
    .sort((a, b) => b.currentStart.localeCompare(a.currentStart))[0];
  const statementAnswer = latestStatement
    ? t('finance:area.latestPeriod', 'Latest period {{month}}', { month: formatMonth(latestStatement.currentStart) })
    : t('finance:area.notAvailableYet', 'Not available yet');

  const areaRows: Array<{ area: FinanceAreaName; answer: string }> = [
    { area: 'receivables', answer: receivablesAnswer },
    { area: 'payables', answer: payablesAnswer },
    { area: 'reports', answer: reportAnswer },
    { area: 'statements', answer: statementAnswer },
  ].filter((item) => availableAreas.includes(item.area));

  const areasBlock = (
    <section aria-labelledby="finance-areas-title">
      <h2 id="finance-areas-title" className="mb-2 text-[18px] font-semibold">{t('finance:area.areas', 'Areas')}</h2>
      <div className="divide-y divide-border border-y border-border">
        {areaRows.map(({ area, answer }) => (
          <Link
            key={area}
            to={withLayout(`/finance/${area}`)}
            className="flex min-h-14 items-center justify-between gap-3 py-2.5 hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="text-[15px] font-semibold">{areaLabels[area]}</span>
            <span className="flex min-w-0 items-center gap-2 text-right">
              <span className="tabular text-[16px] font-semibold">{answer}</span>
              <Icon name="chevronRight" className="size-4 shrink-0 text-muted-foreground" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );

  const openNewInvoice = canAct && (
    <Button variant="primary" onClick={createInvoice}>
      <Icon name="plus" />
      {t('finance:area.newInvoice', 'New invoice')}
    </Button>
  );

  const jumpAreas: Array<{ id: string; label: string; render: () => React.ReactNode }> = jumpAreaIds.map((id) => ({
    id,
    label: id === 'needs-you'
      ? t('finance:area.needsYou', 'Needs you')
      : id === 'reports'
        ? t('finance:area.revenue', 'Revenue')
        : areaLabels[id as FinanceAreaName],
    render: () => id === 'needs-you'
      ? <FinanceAttention {...attentionProps} scope="all" />
      : areaContent(id as FinanceAreaName, id === 'receivables'),
  }));

  useEffect(() => {
    if (layout !== 'c') return;
    const target = location.hash.slice(1) || routeArea || jumpAreaIds[0];
    if (!target || !jumpAreaIds.includes(target)) return;
    setActiveJump(target);
    const timer = window.setTimeout(() => sectionRefs.current[target]?.scrollIntoView({ block: 'start', behavior: 'auto' }), 0);
    return () => window.clearTimeout(timer);
  }, [jumpAreaIds, layout, location.hash, routeArea]);

  useEffect(() => {
    if (layout !== 'c' || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]?.target.id) setActiveJump(visible[0].target.id);
    }, { rootMargin: '-72px 0px -65% 0px', threshold: 0 });
    for (const id of jumpAreaIds) {
      const element = sectionRefs.current[id];
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [jumpAreaIds, layout]);

  useEffect(() => {
    if (layout !== 'c' || !activeJump || location.hash === `#${activeJump}`) return;
    navigate(`${location.pathname}${location.search}#${activeJump}`, { replace: true });
  }, [activeJump, layout, location.pathname, location.search, location.hash, navigate]);

  if (requestedLayout === 'off') return <Navigate to="/sales-invoices" replace />;
  if (!canView) {
    return (
      <AccessDenied
        title={t('finance:area.finance', 'Finance')}
        sub={t('finance:area.availableOnlyToFinance', 'Finance is available to Finance, Executive and Admin roles.')}
        onBack={() => navigate('/')}
      />
    );
  }

  if (layout === 'a') {
    const tabs = availableAreas.map((area) => ({
      value: area,
      label: areaLabels[area],
      ...(area === 'receivables' ? { count: finance.position.overdue.length } : area === 'payables' ? { count: finance.position.payables.length } : {}),
    }));
    return (
      <div className="min-w-0">
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t('finance:area.finance', 'Finance')}</h1>
          {activeArea === 'receivables' ? openNewInvoice : null}
        </header>
        {tabs.length > 0 ? (
          <Tabs
            idBase="finance-area"
            items={tabs}
            value={activeArea}
            onChange={(value) => navigate(withLayout(`/finance/${value}`))}
            ariaLabel={t('finance:area.viewAreas', 'Finance areas')}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('finance:area.noAreas', 'No Finance areas are available for this organization.')}</p>
        )}
        {availableAreas.includes(activeArea) && (
          <div role="tabpanel" id={`finance-area-tabpanel-${activeArea}`} aria-label={areaLabels[activeArea]}>
            {areaContent(activeArea, activeArea === 'receivables')}
          </div>
        )}
      </div>
    );
  }

  if (layout === 'b') {
    if (isAreaRoute) {
      return (
        <div className="min-w-0">
          <Link to={withLayout('/finance')} className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <Icon name="chevronLeft" className="size-4" />
            {t('finance:area.backToFinance', 'Back to Finance')}
          </Link>
          <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-[24px] font-bold tracking-[-0.02em]">{areaLabels[activeArea]}</h1>
            {activeArea === 'receivables' ? openNewInvoice : null}
          </header>
          {areaContent(activeArea)}
        </div>
      );
    }
    const needsHeading = canAct ? t('finance:area.needsYou', 'Needs you') : t('finance:area.needsAttention', 'Needs attention');
    return (
      <div className="min-w-0">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t('finance:area.finance', 'Finance')}</h1>
          {openNewInvoice}
        </header>
        {realRole === 'Executive' ? (
          <div className="space-y-6">
            {areasBlock}
            <section aria-labelledby="finance-needs-title">
              <h2 id="finance-needs-title" className="mb-2 text-[18px] font-semibold">{needsHeading}</h2>
              <FinanceAttention {...attentionProps} scope="all" />
            </section>
          </div>
        ) : (
          <div className="space-y-6">
            <section aria-labelledby="finance-needs-title">
              <h2 id="finance-needs-title" className="mb-2 text-[18px] font-semibold">{needsHeading}</h2>
              <FinanceAttention {...attentionProps} scope="all" />
            </section>
            {areasBlock}
          </div>
        )}
      </div>
    );
  }

  const handleJump = (section: string) => {
    setActiveJump(section);
    sectionRefs.current[section]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div className="min-w-0">
      <header className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t('finance:area.finance', 'Finance')}</h1>
        {openNewInvoice}
      </header>
      <nav aria-label={t('finance:area.jumpMenu', 'Finance sections')} className="sticky top-0 z-10 -mx-4 mb-1 flex min-w-0 gap-1 overflow-x-auto border-b border-border bg-background px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {jumpAreas.map((section) => (
          <Link
            key={section.id}
            to={`${location.pathname}${location.search}#${section.id}`}
            onClick={() => handleJump(section.id)}
            aria-current={activeJump === section.id ? 'location' : undefined}
            className={`flex min-h-11 shrink-0 items-center px-2.5 text-sm font-medium ${activeJump === section.id ? 'border-b-2 border-primary text-primary-text' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {section.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-1">
        {jumpAreas.map((section) => (
          <section
            key={section.id}
            id={section.id}
            ref={(element) => { sectionRefs.current[section.id] = element; }}
            className="scroll-mt-12 pt-9"
          >
            <h2 className="mb-2 text-[18px] font-semibold">{section.label}</h2>
            {section.render()}
          </section>
        ))}
      </div>
    </div>
  );
};

export default FinanceArea;
