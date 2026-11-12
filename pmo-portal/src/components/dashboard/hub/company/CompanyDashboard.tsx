import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { cn } from '@/src/components/ui/cn';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { Icon } from '@/src/components/ui/icons';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { LateText } from '@/src/components/ui/LateText';
import { isMostUrgentLateRow } from '@/src/components/ui/lateTextRows';
import { ListState } from '@/src/components/ui/ListState';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useHomeLayout } from '@/src/hooks/useHomeLayout';
import { can } from '@/src/auth/policy';
import { useFinanceBudgetReview, useSalesPipeline } from '@/src/hooks/useDashboard';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useProjects } from '@/src/hooks/useProjects';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useCompanyFigures } from '@/src/components/dashboard/restructure/useCompanyFigures';
import { useNeedsYou } from '@/src/components/dashboard/restructure/useNeedsYou';
import { PeriodPicker } from '@/src/components/dashboard/restructure/PeriodPicker';
import { usePeriod } from '@/src/components/dashboard/restructure/usePeriod';
import type { DashboardFigure } from '@/src/components/dashboard/restructure/FigureGroup';
import { moneyTileValue } from '@/src/components/dashboard/dashMoney';
import { Analysis, DashboardWaitsOnYou, ProjectRows, type ProjectRow, type WaitRow } from '@/src/components/dashboard/DashParts';
import { StatusBarChart } from '@/src/components/dashboard/StatusBarChart';
import { WinRateCard } from '@/src/components/dashboard/WinRateCard';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { stageForStatus, PROCUREMENT_STAGES, type ProcurementStage } from '@/src/lib/procurement/stage';
import { formatTableMoney } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { ACTIVE_PROJECT_STATUSES } from '@/src/lib/db/projects';
import { ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';
import { invoiceGross } from '@/src/lib/revenue/nativeInvoice';
import { trendWindow } from '@/src/lib/dashboardTrend';
import { monthsBetween } from '@/src/lib/reports/months';
import type { Role } from '@/src/auth/AuthContext';
import { InvoicedTrendCard } from './InvoicedTrendCard';
import { PlanVsActualChart } from './PlanVsActualChart';
import { SalesFunnel } from './SalesFunnel';
import { BudgetReviewCard, FinanceAnalysis, ReadyToPayCard } from './FinanceBlocks';
import { useSupplierUnpaid } from './financeData';
import { InvoicedCollectedCard, LossReasonsCard, PurchasingCard, ReceivablesAgeCard, SalesOverviewCard } from './OverviewCards';
import { ApprovalItems } from './ApprovalItems';
import { FindingLine, UncheckedReport } from './FindingLine';
import { ProjectHealthCard } from './ProjectHealthCard';
import { healthOrder, isOffTrack, overBudget, overdueTaskCount } from './homeHealth';

type TileOpts = { label?: string; caption?: string; reason?: string; link?: { to: string; label: string }; hide?: boolean };
/** The order of "waits on you" rows per role (a row is drawn only when its count is above zero). */
const WAIT_ORDER: Record<'Executive' | 'Admin' | 'Finance', string[]> = {
  Executive: ['approvals'],
  Admin: ['approvals'],
  Finance: ['approvals', 'supplier-invoices', 'overdue-invoices', 'ready-to-bill'],
};


export function CompanyDashboard({ role }: { role: Extract<Role, 'Executive' | 'Admin' | 'Finance'> }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { realRole } = useEffectiveRole();
  const overview = useHomeLayout().homeLayout === 'overview';
  const canOpenAccounting = can('edit', 'budgetLine', { realRole });
  const periodState = usePeriod();
  const figures = useCompanyFigures(periodState.period);
  const needs = useNeedsYou(role);
  const projects = useProjects();
  const procurements = useProcurements({ lean: true });
  const pipeline = useSalesPipeline();
  const budgetReview = useFinanceBudgetReview();
  const orgCurrency = useOrgCurrency();
  const data = figures.dashboard;
  const finance = role === 'Finance';
  const unpaidOf = useSupplierUnpaid(finance);
  const financePosition = useFinancePosition(finance, { withRoutes: true });
  const todayFigure = (id: string) => figures.today.find((figure) => figure.id === id);
  const { period } = periodState;
  const periodLabel = period.key === 'custom'
    ? [period.from, period.to].filter(Boolean).join(' – ')
    : ({ month: t('period.month', 'This month'), quarter: t('period.quarter', 'This quarter'), ytd: t('period.ytd', 'Year to date'), '12m': t('period.12m', 'Last 12 months') } as Record<string, string>)[period.key];
  const periodFigure = (id: string) => figures.period.find((figure) => figure.id === id);
  const setUp = canOpenAccounting ? { to: '/administration/accounting', label: t('home.setUp', 'Set up') } : undefined;

  // Projects off track: over budget or with overdue work, worst first (the server's order), at most five.
  const attention = data?.attention_projects ?? [];
  const offTrack = attention.filter((row) => overBudget(row) || row.overdue_items > 0)
    .sort((a, b) => (overdueTaskCount(b) ?? -1) - (overdueTaskCount(a) ?? -1))
    .slice(0, 5);
  // Project health (overview): every attention project, worst first; one delivery read covers both layouts.
  const healthRows = healthOrder(attention);
  const healthDelivery = useProjectsDelivery(attention.map((row) => row.id));
  const deliveryQuery = healthDelivery;
  const offTrackCount = attention.filter(isOffTrack).length;
  // The server sends the top five by attention; when all five are off track there may be more.
  const offTrackSaturated = attention.length >= 5 && offTrackCount === attention.length;
  const activeProjectCount = data?.active_delivery_projects ?? data?.active_projects;
  const projectRows: ProjectRow[] = offTrack.map((row) => {
    // F2: an unknown count stays unknown (null), never a printed 0.
    const overdueTasks = overdueTaskCount(row);
    return {
    id: row.id,
    name: projectDisplayName(row),
    title: projectDisplayName(row) !== row.name ? row.name : undefined,
    reason: null,
    needs: {
      tasksOverdue: overdueTasks,
      phasesLate: row.overdue_milestones,
      invoicesOverdue: row.overdue_invoices,
      awaitingApproval: row.waiting_approvals,
      overBudget: overBudget(row),
    },
    status: row.status,
    offTrack: true,
    href: `/projects/${row.id}`,
    delivery: deliveryQuery.data?.[row.id] ?? null,
    budgetUsed: row.budget_used_ratio === null ? null : row.budget_used_ratio * 100,
  }; });
  const projectsPending = figures.dashboardPending || projects.isPending;
  const projectsError = figures.dashboardError || projects.isError;
  const unchecked = data?.risk_unchecked_projects ?? 0;

  const refresh = () => {
    figures.todayRetry(); figures.periodRetry(); figures.dashboardRetry(); figures.pipelineRetry(); needs.refetch();
    void procurements.refetch(); void budgetReview.refetch(); void projects.refetch();
  };

  const hasEvidence = Boolean(data && ((data.projects_by_status ?? []).some((row) => row.count > 0) || (data.procurements_by_status ?? []).some((row) => row.count > 0)))
    || Boolean(procurements.data?.length || figures.pipeline?.projects?.length);
  if (!figures.todayPending && !figures.periodPending && !figures.pipelinePending && !procurements.isPending && !needs.isPending
    && !figures.dashboardError && !figures.periodError && !figures.pipelineError && !needs.isError && figures.isEmpty && !hasEvidence) {
    return <div className="space-y-4"><h1 className="text-page font-bold">{t('dashboard:hub.company.title', 'Dashboard')}</h1><ListState variant="empty" icon="grid" title={t('dashboard:hub.company.emptyTitle', 'No company activity yet')} sub={t('dashboard:hub.company.emptySub', 'Projects, sales, billing, and purchasing will appear here as records are added.')} /></div>;
  }

  // "Waits on you": one row per kind, each a link to the fix.
  const waitRows: WaitRow[] = WAIT_ORDER[role].flatMap((id) => needs.items.filter((item) => item.id === id)).map((item) => ({
    id: item.id,
    count: item.countLabel ?? item.count,
    label: item.id === 'approvals' ? t('home.approvalsCompact', 'Approvals') : item.label,
    amount: item.amount,
    detail: item.detail,
    href: item.href,
    tone: item.tone,
  }));

  const helpText: Record<string, string> = {
    'contract-on-hand': t('dashboard:hub.company.help.contract', 'Sum of contract values for delivery work, in each project currency.'),
    'billed-margin': t('dashboard:hub.company.help.margin', 'Known margin is billed-work revenue less recorded spending. It is not cash received.'),
    'owed-clients': t('home.help.owedClients', 'Outstanding balance of every open client invoice. Hidden while any balance is unknown.'),
    'supplier-payables': t('dashboard:hub.company.help.supplierPayables', 'Sum of procurement cases in the supplier-invoiced state awaiting payment.'),
    invoiced: t('dashboard:hub.company.help.invoiced', 'Sum of invoices issued within the selected period, excluding tax.'),
    collected: t('dashboard:hub.company.help.collected', 'Sum of recorded incoming payments received within the selected period.'),
    'left-to-bill': t('dashboard:hub.company.help.leftToBill', 'Signed contract value less invoices issued, in each contract currency.'),
  };
  // One money tile from a figure: unknown (no amounts) draws nothing and is reported to the page's one hidden-figures line.
  const moneyTile = (figure: DashboardFigure | undefined, opts: TileOpts = {}) => {
    if (!figure) return null;
    const money = opts.hide ? null : moneyTileValue(figure.amounts, orgCurrency);
    const label = opts.label ?? figure.label;
    const caption = opts.caption ?? (typeof figure.subline === 'string' ? figure.subline : undefined);
    return <KPITile key={figure.id} icon="grid" tone="blue" label={label} value={money?.value ?? null} exactValue={money?.exact} unavailableReason={money ? undefined : opts.reason ?? figure.unavailableReason} hiddenLink={opts.link} caption={caption} to={figure.href} linkLabel={label} loading={figures.todayPending} help={helpText[figure.id]} />;
  };

  const supplier = todayFigure('supplier-payables');
  const toPay = typeof supplier?.subline === 'string' ? supplier.subline.replace(/^(\d+)\s.*$/, (_, n: string) => t('home.toPay', '{{count}} to pay', { count: Number(n) })) : undefined;
  const invoiced = periodFigure('invoiced');
  const collected = periodFigure('collected');
  const margin = todayFigure('billed-margin');
  // The caption counts the same projects the contract figure sums: every on-hand state, not only "ongoing".
  const onHandCount = data ? (data.projects_by_status ?? []).filter((row) => ON_HAND_STATUSES.includes(row.status)).reduce((sum, row) => sum + row.count, 0) : undefined;
  // Collected: no receipts recorded is not evidence of "nothing collected" while client balances are not synced.
  const collectedUnsynced = (collected?.amounts ?? []).every((row) => row.amount === 0) && todayFigure('owed-clients')?.amounts == null;
  const collectedOpts = { label: t('home.collected', 'Collected'), caption: periodLabel, hide: collectedUnsynced, reason: t('home.reasonCollected', 'incoming payments are not synced'), link: setUp };
  const positionTiles = figures.todayPending || figures.periodPending
    ? Array.from({ length: 4 }, (_, i) => <KPITile key={i} loading icon="grid" tone="blue" label="" value="" className="min-h-[96px]" />)
    : (finance
    ? [
      moneyTile(todayFigure('owed-clients'), { link: setUp }),
      moneyTile(supplier, { caption: toPay }),
      moneyTile(invoiced, { label: t('home.invoiced', 'Invoiced'), caption: periodLabel }),
      moneyTile(collected, collectedOpts),
    ]
    : [
      moneyTile(todayFigure('contract-on-hand'), { caption: onHandCount === undefined ? undefined : t('home.projectCount', { count: onHandCount, defaultValue_one: '{{count}} project', defaultValue_other: '{{count}} projects' }), reason: t('home.reasonContract', 'contract values are missing') }),
      moneyTile(invoiced, { label: t('home.invoiced', 'Invoiced'), caption: periodLabel }),
      moneyTile(todayFigure('owed-clients'), { link: setUp }),
      moneyTile(supplier, { caption: toPay }),
      // Known margin is a fifth tile only when the accounting source provides it.
      margin?.amounts ? moneyTile(margin, { caption: '' }) : null,
    ]).filter((tile) => tile !== null);

  const linkClass = 'inline-flex items-center gap-1 text-control font-medium text-primary-text hover:underline pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  const cardLink = (to: string, label: string) => <Link to={to} className={linkClass}><span>{label}</span><Icon name="chev" className="size-4" /></Link>;

  // Sales (exec/admin): the open stages as one bar set, then what was won in the period.
  const won = periodFigure('won');
  const weighted = moneyTileValue(todayFigure('pipeline')?.amounts, orgCurrency);
  const salesCard = (
    <Card>
      <CardHead level={2} actions={cardLink('/sales', t('dashboard:hub.company.openSales', 'Open sales'))}>{t('home.sales', 'Sales')}</CardHead>
      <CardPad className="grid gap-3">
        {weighted && <div><div className="text-control text-muted-foreground">{t('home.pipelineWeighted', 'Weighted pipeline')}</div><div className="text-[23px] font-bold leading-tight tabular" title={weighted.exact}>{weighted.value}</div>{data?.pipeline_projected_margin != null && <div className="text-control text-muted-foreground">{t('dashboard:hub.company.forecastMargin', 'Forecast margin')}: {(data.pipeline_projected_margin * 100).toFixed(1)}%</div>}</div>}
        {pipeline.isPending ? <ListState variant="loading" shape="chart" rows={2} />
          : pipeline.isError ? <ListState variant="error" title={t('dashboard:hub.company.pipelineError', "Couldn't load pipeline stages")} onRetry={() => { void pipeline.refetch(); }} />
          : <SalesFunnel stages={pipeline.data?.stages ?? []} currency={orgCurrency} period="" won={won?.amounts && won.count !== undefined ? { count: won.count, amounts: won.amounts, href: won.href } : undefined} />}
      </CardPad>
    </Card>
  );

  // Analysis (no page of its own yet): plan vs actual, win rate with loss reasons, purchasing, billing trend.
  const stageCounts = PROCUREMENT_STAGES.map((stage) => ({
    status: stage,
    count: (data?.procurements_by_status ?? []).filter((row) => stageForStatus(row.status) === stage).reduce((sum, row) => sum + row.count, 0),
  }));
  const stageName = (stage: ProcurementStage) => ({
    Request: t('dashboard:hub.company.stageRequest', 'Request'),
    Order: t('dashboard:hub.company.stageOrder', 'Order'),
    Receive: t('dashboard:hub.company.stageReceive', 'Receive'),
    Pay: t('dashboard:hub.company.stagePay', 'Pay'),
  })[stage];
  const planCard = (
    <Card>
      <CardHead level={2} actions={cardLink('/projects', t('dashboard:hub.company.openProjects', 'Open projects'))}>{t('dashboard:hub.company.planVsActual.title', 'Plan vs actual')}</CardHead>
      <CardPad>{projectsPending ? <ListState variant="loading" shape="chart" rows={4} /> : projectsError ? <ListState variant="error" title={t('dashboard:hub.company.projectsError', "Couldn't load delivery projects")} onRetry={() => { figures.dashboardRetry(); void projects.refetch(); }} /> : <PlanVsActualChart projects={data?.top_projects ?? []} currency={orgCurrency} />}</CardPad>
    </Card>
  );
  const purchasingCard = (
    <Card>
      <CardHead level={2} actions={cardLink('/procurement', t('dashboard:hub.company.openProcurements', 'Open procurements'))}>{t('dashboard:hub.company.purchasingByStage', 'Purchasing by stage')}</CardHead>
      <CardPad>
        {figures.dashboardError ? <ListState variant="error" title={t('dashboard:hub.company.purchasesError', "Couldn't load purchasing stages")} onRetry={figures.dashboardRetry} /> : figures.dashboardPending ? <ListState variant="loading" shape="chart" rows={2} /> : stageCounts.every((row) => row.count === 0) ? <ListState variant="empty" icon="cart" title={t('dashboard:hub.company.noPurchases', 'No procurements to show')} /> : <StatusBarChart data={stageCounts} toneFor={(stage) => chartTheme.categorical[PROCUREMENT_STAGES.indexOf(stage)] ?? chartTheme.categorical[0]} label={t('dashboard:hub.company.purchasingByStage', 'Purchasing by stage')} noun={t('dashboard:hub.company.procurementPlural', 'procurements')} hrefFor={(stage) => `/procurement?stage=${stage.toLowerCase()}`} labelFor={stageName} compactSegments />}
      </CardPad>
    </Card>
  );
  const billingCard = (
    <Card>
      <CardHead level={2} actions={cardLink('/finance/receivables', t('dashboard:hub.company.openInvoices', 'Open invoices'))}>{t('home.billing', 'Billing')}</CardHead>
      <CardPad className="grid gap-3">
        <KPIRow className="grid-cols-2">
          {moneyTile(collected, collectedOpts)}
          {moneyTile(todayFigure('left-to-bill'), { label: t('home.leftToBill', 'Left to bill'), caption: '' })}
        </KPIRow>
        <InvoicedTrendCard bare trend={figures.invoicedTrend} pending={figures.trendPending} error={figures.trendError} onRetry={figures.trendRetry} />
      </CardPad>
    </Card>
  );
  const analysis = finance ? <FinanceAnalysis /> : (
    <>
      {planCard}
      <Card><CardPad><WinRateCard currency={orgCurrency} range={figures.winRateRange} hidePeriodControl embedded helpInPage /></CardPad></Card>
      {purchasingCard}
      {billingCard}
    </>
  );

  // Finance: who owes us, worst first (the full list is Receivables).
  const overdueRows = financePosition.position.overdue.slice(0, 5);
  const overdueColumns: Column<(typeof overdueRows)[number]>[] = [
    { key: 'client', header: t('home.colClient', 'Client'), rowHeader: true, cell: (row) => <span className="font-medium">{row.invoice.customer_name}</span>, exportValue: (row) => row.invoice.customer_name ?? '' },
    { key: 'invoice', header: t('home.colInvoice', 'Invoice'), cell: (row) => row.invoice.pmo_number ?? row.invoice.si_number ?? row.invoice.reference_number ?? null, exportValue: (row) => row.invoice.pmo_number ?? row.invoice.si_number ?? row.invoice.reference_number ?? '' },
    { key: 'total', header: t('home.colInvoiceTotal', 'Total'), kind: 'money', align: 'num', cell: (row) => { const gross = invoiceGross(row.invoice); return gross === null ? null : formatTableMoney(gross, row.invoice.currency); }, exportValue: (row) => invoiceGross(row.invoice) ?? '' },
    { key: 'outstanding', header: t('home.colOutstanding', 'Outstanding'), kind: 'money', align: 'num', cell: (row) => row.outstanding === null ? null : <span className={cn('tabular', isMostUrgentLateRow(overdueRows, row) ? 'text-metric font-semibold' : 'text-control font-normal')}>{formatTableMoney(row.outstanding / 100, row.invoice.currency)}</span>, exportValue: (row) => row.outstanding === null ? '' : row.outstanding / 100 },
    { key: 'late', header: t('home.colLate', 'Overdue'), align: 'num', cell: (row) => <LateText emphasis={isMostUrgentLateRow(overdueRows, row)}>{t('home.daysOverdue', { count: row.daysOverdue, defaultValue_one: '{{count}} day overdue', defaultValue_other: '{{count}} days overdue' })}</LateText>, exportValue: (row) => row.daysOverdue },
  ];
  const activeStatuses = new Set<string>(ACTIVE_PROJECT_STATUSES);
  const budgetRows = (budgetReview.data ?? []).filter((row) => activeStatuses.has(row.status)).slice(0, 5);

  const waitsEl = <DashboardWaitsOnYou rows={waitRows} pending={needs.isPending} error={needs.isError} onRetry={needs.refetch} />;
  const overdueCard = (
    <Card>
      <CardHead level={2} actions={cardLink('/finance/receivables?overdue=true', t('home.allOverdue', 'All overdue'))}>{t('home.overdueFromClients', 'Client overdue')}</CardHead>
      <div className="overflow-x-auto [--table-cell-inset:var(--panel-inset)]">
        <DataTable rows={overdueRows} columns={overdueColumns} rowKey={(row) => row.invoice.id} onActivate={() => navigate('/finance/receivables?overdue=true')} rowLabel={(row) => t('home.openInvoiceFor', 'Open overdue invoice for {{name}}', { name: row.invoice.customer_name ?? '' })} state={financePosition.isPending ? 'loading' : financePosition.isError ? 'error' : overdueRows.length === 0 ? 'empty' : undefined} onRetry={() => figures.todayRetry()} emptyTitle={t('home.noOverdue', 'No overdue client invoices')} errorTitle={t('home.overdueError', "Couldn't load overdue invoices")} tableId="dashboard-company-overdue-clients" embedded />
      </div>
    </Card>
  );
  const readyCard = <ReadyToPayCard rows={procurements.data ?? []} pending={procurements.isPending} error={procurements.isError} retry={() => void procurements.refetch()} unpaidOf={unpaidOf} />;
  const offTrackEl = (
    <ProjectRows
      title={t('home.offTrack', 'Projects off track')}
      rows={projectRows}
      pending={projectsPending}
      error={projectsError}
      onRetry={() => { figures.dashboardRetry(); void projects.refetch(); }}
      allLink={{ to: '/projects', label: projects.isPending || projects.isError ? t('home.allProjectsBare', 'All projects') : t('home.allProjects', 'All {{count}} projects', { count: projects.data?.length ?? 0 }) }}
      emptyLabel={unchecked > 0 ? t('home.noneCheckedOffTrack', 'No checked project is off track.') : t('home.noneOffTrack', 'No project is off track.')}
    />
  );
  const header = (
    <div>
      <PageHeader
        className="mb-2"
        title={t('dashboard:hub.company.title', 'Dashboard')}
        help={t('home.help.basis', 'Position today in each record currency. Invoiced, collected and won cover the period chosen.')}
        action={<div className="flex flex-wrap items-end gap-2"><PeriodPicker period={periodState.period} selectPeriod={periodState.selectPeriod} setCustomMonth={periodState.setCustomMonth} /><Button variant="outline" size="sm" onClick={refresh} aria-label={t('dashboard:hub.company.refresh', 'Refresh dashboard')}><Icon name="refresh" /><span className="hidden sm:inline">{t('dashboard:hub.company.refresh', 'Refresh')}</span></Button></div>}
      />
      <FigureHiddenLine compact />
    </div>
  );
  const tilesRow = (cols: string, tileList: React.ReactNode[]) => figures.todayError
    ? <ListState variant="error" title={t('dashboard:hub.company.figuresError', "Couldn't load company position figures")} onRetry={figures.todayRetry} />
    : <KPIRow aria-label={t('dashboard:hub.company.keyFigures', 'Company figures')} className={cols}>{tileList}</KPIRow>;

  if (overview) {
    // One grid: 12 columns, one gutter (--space-panel-gap, 24px desktop). At 1440 the canvas is 1168px:
    // 12c + 11 x 24 = 1168 -> c = 75.33; a half is 6c + 5g = 572, a third 4c + 3g = 373.3; 3 x 373.3 + 2 x 24 = 1168.
    // Rows: figures (12) · Project health (6) | Finances (6) · [Waits on you over Purchasing] (4) | Sales with win and loss (8).
    // Finance: figures · health | finances (with owed by age) · Waits on you (4) | Payables (8) · Client overdue (12, a table).
    // Below 900px every block takes the full width, in the phone order: finding, figures, waits, health, finances, the rest.
    const lossRange = figures.winRateRange;
    const wonAmounts = won?.amounts && won.count !== undefined ? { count: won.count, amounts: won.amounts, href: won.href } : undefined;
    const trendRange = trendWindow(figures.organizationToday);
    const trendMonths = trendRange.from && trendRange.to ? monthsBetween(trendRange.from, trendRange.to).map((month) => month.slice(0, 7)) : [];
    const half = 'min-w-0 min-[900px]:col-span-6';
    const third = 'min-w-0 min-[900px]:col-span-4';
    const bandTiles = figures.todayPending || figures.periodPending
      ? Array.from({ length: 4 }, (_, i) => <KPITile key={i} loading icon="grid" tone="blue" label="" value="" className="min-h-[96px]" />)
      : [
        moneyTile(todayFigure('contract-on-hand'), { caption: onHandCount === undefined ? undefined : t('home.projectCount', { count: onHandCount, defaultValue_one: '{{count}} project', defaultValue_other: '{{count}} projects' }), reason: t('home.reasonContract', 'contract values are missing') }),
        moneyTile(invoiced, { label: t('home.invoiced', 'Invoiced'), caption: periodLabel }),
        moneyTile(collected, collectedOpts),
        moneyTile(todayFigure('left-to-bill'), { label: t('home.leftToBill', 'Left to bill'), caption: '' }),
        margin?.amounts ? moneyTile(margin, { caption: '' }) : null,
      ].filter((tile) => tile !== null);
    const band = tilesRow('grid-cols-2 min-[900px]:grid-flow-col min-[900px]:auto-cols-fr', bandTiles);

    // Finances: what is owed to us (and how much of it is late), what we owe suppliers, and money in by month.
    const overdue = needs.overdueInvoices;
    const overdueKnown = overdue && overdue.unknownBalances === 0 ? moneyTileValue(overdue.knownTotals, orgCurrency) : null;
    const vendorInvoiced = (procurements.data ?? []).filter((row) => row.status === 'Vendor Invoiced');
    const oldestSupplierDays = vendorInvoiced.length === 0 ? null
      : Math.max(...vendorInvoiced.map((row) => Math.max(0, Math.floor((Date.now() - new Date(row.vendor_invoiced_at ?? row.updated_at).getTime()) / 86400000))));
    const supplierCaption = oldestSupplierDays === null ? toPay
      : t('home.toPayOldest', { count: vendorInvoiced.length, days: oldestSupplierDays, defaultValue_one: '{{count}} to pay · oldest {{days}} days', defaultValue_other: '{{count}} to pay · oldest {{days}} days' });
    const financesCard = (
      <Card data-testid="finances" className={cn(half, 'flex flex-col max-[899px]:order-5')}>
        <CardHead level={2} actions={cardLink('/finance/receivables', t('home.openReceivables', 'Open receivables'))}>{t('home.finances', 'Finances')}</CardHead>
        <KPIRow aria-label={t('home.finances', 'Finances')} className="rounded-none border-x-0 grid-cols-1 min-[480px]:grid-flow-col min-[480px]:auto-cols-fr [&>*]:px-[var(--panel-inset)]">
          {moneyTile(todayFigure('owed-clients'), { label: t('home.owedToUs', 'Owed to us'), link: setUp })}
          <KPITile icon="grid" tone="red" label={t('home.overdueLabel', 'Overdue')} value={overdueKnown?.value ?? null} exactValue={overdueKnown?.exact} negative={(overdue?.count ?? 0) > 0}
            unavailableReason={overdue ? t('home.reasonOverdueBalance', 'some overdue balances are unknown') : t('home.reasonOverdueUnknown', 'overdue invoices could not be read')}
            caption={overdue && overdue.count > 0 && overdue.oldestDays !== null ? t('home.oldestDays', 'oldest {{days}} days', { days: overdue.oldestDays }) : undefined}
            to="/finance/receivables?overdue=true" linkLabel={t('home.overdueLabel', 'Overdue')} loading={needs.isPending} />
          {moneyTile(supplier, { label: t('home.owedToSuppliers', 'Owed to suppliers'), caption: supplierCaption })}
        </KPIRow>
        <div className="flex flex-1 flex-col gap-4 px-[var(--panel-inset)] pb-4 pt-4">
          {finance && <ReceivablesAgeCard embedded ageing={financePosition.position.receivablesAgeing} unknownCount={financePosition.position.receivablesUnknownCount} currency={orgCurrency} pending={financePosition.isPending} error={financePosition.isError} retry={() => figures.todayRetry()} />}
          <InvoicedCollectedCard embedded chartHeight={finance ? 120 : 180} months={figures.trendInvoicedByMonth} periodMonths={trendMonths} collectedByMonth={figures.collectedByMonth} collectedUnsynced={collectedUnsynced} pending={figures.trendPending || figures.todayPending} error={figures.trendError} retry={figures.periodRetry} currency={orgCurrency} />
        </div>
      </Card>
    );
    const healthCard = (
      <ProjectHealthCard className={cn(half, 'max-[899px]:order-4')} rows={healthRows} delivery={healthDelivery.data} allCount={projects.isPending || projects.isError ? undefined : projects.data?.length}
        pending={projectsPending} error={projectsError} retry={() => { figures.dashboardRetry(); void projects.refetch(); }} />
    );
    const approvalsTotal = needs.approvals?.length ?? 0;
    const waits = (
      <DashboardWaitsOnYou className={cn(third, 'max-[899px]:order-3')} rows={waitRows.filter((row) => row.id !== 'approvals')} pending={needs.isPending} error={needs.isError} onRetry={needs.refetch}
        lead={needs.approvals && needs.approvals.length > 0 ? <ApprovalItems entries={needs.approvals} /> : undefined}
        actions={approvalsTotal > 0 ? cardLink('/approvals', t('home.allApprovals', { count: approvalsTotal, defaultValue_one: 'All {{count}} approvals', defaultValue_other: 'All {{count}} approvals' })) : undefined} />
    );
    const lowerRow = finance ? (
      <>
        {waits}
        <div className={cn('min-w-0 min-[900px]:col-span-8 [&>*]:h-full', 'max-[899px]:order-6')}>{readyCard}</div>
        <div className={cn('min-w-0 min-[900px]:col-span-12', 'max-[899px]:order-7')}>{overdueCard}</div>
      </>
    ) : (
      <>
        {/* Left third: Waits on you over Purchasing by stage (the column closes level with Sales; Purchasing takes the slack). */}
        <div className={cn(third, 'flex flex-col gap-[var(--space-panel-gap)] max-[899px]:contents')}>
          {waits}
          <PurchasingCard className="flex-1 max-[899px]:order-7" counts={stageCounts} stageName={stageName} pending={figures.dashboardPending} error={figures.dashboardError} retry={figures.dashboardRetry} />
        </div>
        <SalesOverviewCard wide className={cn('min-w-0 min-[900px]:col-span-8', 'max-[899px]:order-6')} weighted={weighted} forecastMargin={data?.pipeline_projected_margin} stages={pipeline.data?.stages ?? []} pending={pipeline.isPending} error={pipeline.isError} retry={() => { void pipeline.refetch(); }} currency={orgCurrency} period="" won={wonAmounts} range={lossRange}
          aside={<LossReasonsCard embedded range={lossRange} />} />
      </>
    );
    return (
      <FigureScope>
        <UncheckedReport count={unchecked} />
        <div className="space-y-[var(--space-panel-gap)]" data-company-role={role} data-home-layout="overview">
          <div>
            <PageHeader
              className="mb-1"
              title={t('dashboard:hub.company.title', 'Dashboard')}
              help={t('home.help.basis', 'Position today in each record currency. Invoiced, collected and won cover the period chosen.')}
              action={<div className="flex flex-wrap items-end gap-2"><PeriodPicker period={periodState.period} selectPeriod={periodState.selectPeriod} setCustomMonth={periodState.setCustomMonth} /><Button variant="outline" size="sm" onClick={refresh} aria-label={t('dashboard:hub.company.refresh', 'Refresh dashboard')}><Icon name="refresh" /><span className="hidden sm:inline">{t('dashboard:hub.company.refresh', 'Refresh')}</span></Button></div>}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <FindingLine offTrack={projectsPending || projectsError ? undefined : { count: offTrackCount, atLeast: offTrackSaturated, total: activeProjectCount }} overdue={needs.isPending ? undefined : overdue} approvals={needs.approvals?.length} />
              <FigureHiddenLine compact />
            </div>
          </div>
          {band}
          <div data-testid="home-grid" className="grid items-stretch gap-[var(--space-panel-gap)] max-[899px]:grid-cols-1 min-[900px]:grid-cols-12">
            {healthCard}
            {financesCard}
            {lowerRow}
          </div>
          {finance && <Analysis title={t('home.analysis', 'Analysis')}><FinanceAnalysis /></Analysis>}
        </div>
      </FigureScope>
    );
  }
  return (
    <FigureScope>
      <UncheckedReport count={unchecked} />
      <div className="space-y-[var(--space-panel-gap)]" data-company-role={role} data-home-layout="focused">
        {header}
        {waitsEl}
        {finance ? <>{overdueCard}{readyCard}</> : offTrackEl}
        {(() => {
          const tiles = tilesRow(finance ? 'grid-cols-2 min-[900px]:auto-cols-fr min-[900px]:grid-flow-col' : 'grid-cols-2 [&>*:last-child:nth-child(odd)]:col-span-2', positionTiles);
          // Executive: the position tiles and the Sales card share one row on desktop (Sales at half width); stacked on a phone.
          return finance ? tiles : <div className="grid items-start gap-[var(--space-panel-gap)] min-[900px]:grid-cols-2">{tiles}{salesCard}</div>;
        })()}
        {finance && <BudgetReviewCard rows={budgetRows} pending={budgetReview.isPending} error={budgetReview.isError} retry={() => void budgetReview.refetch()} />}
        <Analysis title={t('home.analysis', 'Analysis')}>{analysis}</Analysis>
      </div>
    </FigureScope>
  );
}
