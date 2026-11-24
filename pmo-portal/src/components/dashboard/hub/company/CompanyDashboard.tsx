import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { cn } from '@/src/components/ui/cn';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { Icon } from '@/src/components/ui/icons';
import { KPIRow, KPITile, KPITileError } from '@/src/components/ui/KPITile';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { LateText } from '@/src/components/ui/LateText';
import { isMostUrgentLateRow } from '@/src/components/ui/lateTextRows';
import { ListState } from '@/src/components/ui/ListState';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { ClaimsBoardLink } from '@/src/components/finance/ClaimsBoardLink';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { useHomeLayout } from '@/src/hooks/useHomeLayout';
import { can } from '@/src/auth/policy';
import { useFinanceBudgetReview, useSalesPipeline } from '@/src/hooks/useDashboard';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useProjects } from '@/src/hooks/useProjects';
import { useProjectManagementOverview, useProjectsDelivery, useProjectsDeliverySummary } from '@/src/hooks/useProjectsDelivery';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useCompanyFigures } from '@/src/components/dashboard/restructure/useCompanyFigures';
import { useNeedsYou } from '@/src/components/dashboard/restructure/useNeedsYou';
import { PeriodPicker } from '@/src/components/dashboard/restructure/PeriodPicker';
import { usePeriod } from '@/src/components/dashboard/restructure/usePeriod';
import type { DashboardFigure } from '@/src/components/dashboard/restructure/FigureGroup';
import { moneyTileValue } from '@/src/components/dashboard/dashMoney';
import { Analysis, DashboardWaitsOnYou, ProjectRows, type ProjectRow, type WaitRow } from '@/src/components/dashboard/DashParts';
import { StageSegments } from '@/src/components/dashboard/StageSegments';
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
import { BudgetReviewCard, FinanceAnalysis, PHONE_TABLE_HOLD, ReadyToPayCard } from './FinanceBlocks';
import { useSupplierUnpaid } from './financeData';
import { InvoicedCollectedCard, LossReasonsCard, PurchasingCard, ReceivablesAgeCard, SalesOverviewCard } from './OverviewCards';
import { ApprovalItems } from './ApprovalItems';
import { FindingLine, PipelineCurrencyReport, UncheckedReport } from './FindingLine';
import { ProjectHealthCard } from './ProjectHealthCard';
import { FinancesCard, LeftToBillSection } from './FinancesCard';
import { healthOrder, overBudget, overdueTaskCount } from './homeHealth';
import { WorkOrdersTile } from '@/src/components/dashboard/WorkOrdersTile';
import { ProjectPortfolioTable } from './ProjectPortfolioTable';

type TileOpts = { label?: string; caption?: string; reason?: string; link?: { to: string; label: string }; hide?: boolean };
const MARGIN_HINT_KEY = 'pmo.home.marginTile';
/** The order of "waits on you" rows per role (a row is drawn only when its count is above zero). */
const WAIT_ORDER: Record<'Executive' | 'Admin' | 'Finance', string[]> = {
  Executive: ['approvals', 'billing-steps-waiting', 'check-ins-waiting'],
  Admin: ['approvals', 'billing-steps-waiting', 'check-ins-waiting'],
  Finance: ['approvals', 'supplier-invoices', 'overdue-invoices', 'ready-to-bill', 'billing-steps-waiting'],
};


export function CompanyDashboard({ role }: { role: Extract<Role, 'Executive' | 'Admin' | 'Finance'> }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { realRole } = useEffectiveRole();
  const managementViewsEnabled = useOrgSwitch('managementViews').data === true;
  const overview = useHomeLayout().homeLayout === 'overview';
  const canOpenAccounting = can('edit', 'budgetLine', { realRole });
  const periodState = usePeriod();
  const figures = useCompanyFigures(periodState.period);
  const needs = useNeedsYou(role);
  const projects = useProjects();
  const portfolioProjects = managementViewsEnabled
    ? (projects.data ?? []).filter((project) => ON_HAND_STATUSES.includes(project.status))
    : [];
  const portfolioIds = portfolioProjects.map((project) => project.id);
  const portfolioMilestones = useProjectManagementOverview(portfolioIds);
  const portfolioDelivery = useProjectsDeliverySummary(portfolioIds);
  const procurements = useProcurements({ lean: true });
  const pipeline = useSalesPipeline();
  const budgetReview = useFinanceBudgetReview();
  const orgCurrency = useOrgCurrency();
  const data = figures.dashboard;
  const finance = role === 'Finance';
  // Finance's billing chart grows to the ageing list beside it on a wide screen; on a phone it is the usual chart height.
  const wide = useIsDesktop(900);
  const unpaidOf = useSupplierUnpaid(finance);
  const financePosition = useFinancePosition(finance, { withRoutes: true });
  // Same query key as the figure hooks, so no extra request; present so Retry can re-run it.
  const erpPurchases = useErpPurchases();
  const [refreshToken, setRefreshToken] = React.useState(0);
  const todayFigure = (id: string) => figures.today.find((figure) => figure.id === id);
  // ponytail: one browser-wide hint (not per organisation); a sign-in to a different organisation can still jump once.
  const marginSettled = !figures.figureStatus('billed-margin').pending && !figures.figureStatus('billed-margin').error;
  const marginShownNow = Boolean(todayFigure('billed-margin')?.amounts);
  React.useEffect(() => {
    if (marginSettled) try { localStorage.setItem(MARGIN_HINT_KEY, marginShownNow ? '1' : '0'); } catch { /* the hint is optional */ }
  }, [marginSettled, marginShownNow]);
  const marginShownBefore = React.useMemo(() => { try { return localStorage.getItem(MARGIN_HINT_KEY) === '1'; } catch { return false; } }, []);
  const { period } = periodState;
  const periodLabel = period.key === 'custom'
    ? [period.from, period.to].filter(Boolean).join(' – ')
    : ({ month: t('period.month', 'This month'), quarter: t('period.quarter', 'This quarter'), ytd: t('period.ytd', 'Year to date'), '12m': t('period.12m', 'Last 12 months') } as Record<string, string>)[period.key];
  const periodFigure = (id: string) => figures.period.find((figure) => figure.id === id);
  const setUp = canOpenAccounting ? { to: '/administration/accounting', label: t('home.setUp', 'Set up') } : undefined;

  // Projects off track: over budget or with overdue work, worst first (the server's order), at most five.
  const attention = data?.attention_projects ?? [];
  const offTrackRows = attention.filter((row) => overBudget(row) || row.overdue_items > 0)
    .sort((a, b) => (overdueTaskCount(b) ?? -1) - (overdueTaskCount(a) ?? -1));
  // Project health (overview): every attention project, worst first; one delivery read covers both layouts.
  const healthRows = healthOrder(attention);
  const healthDelivery = useProjectsDelivery(attention.map((row) => row.id));
  const deliveryQuery = healthDelivery;
  const offTrackCount = offTrackRows.length;
  // The server sends the top five by attention; when all five are off track there may be more.
  const offTrackSaturated = attention.length >= 5 && offTrackCount === attention.length;
  const activeProjectCount = data?.active_delivery_projects ?? data?.active_projects;
  const projectRows: ProjectRow[] = offTrackRows.slice(0, 5).map((row) => {
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
  // A7: project rows and the plan chart are drawn from the dashboard read alone; the project list only names the link.
  const projectsPending = figures.dashboardPending;
  const projectsError = figures.dashboardError;
  const unchecked = data?.risk_unchecked_projects ?? 0;

  const refresh = () => {
    figures.todayRetry(); figures.periodRetry(); figures.dashboardRetry(); figures.pipelineRetry(); needs.refetch();
    void procurements.refetch(); void budgetReview.refetch();
    void projects.refetch();
    if (finance) void financePosition.retry();
    void erpPurchases.refetch();
    if (attention.length > 0) void healthDelivery.refetch();
    figures.trendRetry();
    setRefreshToken((current) => current + 1);
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
    // A1/A4: a tile waits on (and fails with) the one read it is made of; a failed read says so, never blank, never 0.
    const figureStatus = figures.figureStatus(figure.id);
    const status = figure.id === 'supplier-payables' && erpPurchases.isError
      ? { ...figureStatus, error: true, retry: () => { figureStatus.retry?.(); void erpPurchases.refetch(); } }
      : figureStatus;
    if (status.error) {
      // A failed tile keeps the filled tile's three lines (label, value, caption), so the band never changes shape.
      return <KPITileError key={figure.id} testId={`figure-error-${figure.id}`} label={label} caption={caption} onRetry={() => status.retry?.()} />;
    }
    // While loading, the caption line is held (a blank line) so the tile is already its filled height. Every band
    // caption is read whole, wrapping when a language needs it: a phone has no hover for a cut-off title.
    return <KPITile key={figure.id} icon="grid" tone="blue" label={label} value={money?.value ?? null} exactValue={money?.exact} unavailableReason={money ? undefined : opts.reason ?? figure.unavailableReason} hiddenLink={opts.link} caption={status.pending && caption !== undefined ? caption || '\u00a0' : caption} captionWrap to={figure.href} linkLabel={label} loading={status.pending} help={helpText[figure.id]} />;
  };

  const supplier = todayFigure('supplier-payables');
  // #2203: the held contracts with no value, left out of Left to bill, take the tile's one caption when any exist.
  const leftToBill = todayFigure('left-to-bill');
  const leftToBillNote = typeof leftToBill?.subline === 'string' ? leftToBill.subline : undefined;
  const toPay = typeof supplier?.subline === 'string' ? supplier.subline.replace(/^(\d+)\s.*$/, (_, n: string) => t('home.toPay', '{{count}} to pay', { count: Number(n) })) : undefined;
  const invoiced = periodFigure('invoiced');
  const collected = periodFigure('collected');
  const margin = todayFigure('billed-margin');
  // The caption counts the same projects the contract figure sums: every on-hand state, not only "ongoing".
  const onHandCount = data ? (data.projects_by_status ?? []).filter((row) => ON_HAND_STATUSES.includes(row.status)).reduce((sum, row) => sum + row.count, 0) : undefined;
  // Collected: no receipts recorded is not evidence of "nothing collected" while client balances are not synced.
  const collectedUnsynced = (collected?.amounts ?? []).every((row) => row.amount === 0) && todayFigure('owed-clients')?.amounts == null;
  const collectedOpts = { label: t('home.collected', 'Collected'), caption: periodLabel, hide: collectedUnsynced, reason: t('home.reasonCollected', 'incoming payments are not synced'), link: setUp };
  // A1: each tile fills in on its own read (no shared skeleton row).
  const positionTiles = (finance
    ? [
      moneyTile(todayFigure('owed-clients'), { link: setUp }),
      moneyTile(supplier, { caption: toPay }),
      moneyTile(invoiced, { label: t('home.invoiced', 'Invoiced'), caption: periodLabel }),
      moneyTile(collected, collectedOpts),
    ]
    : [
      moneyTile(todayFigure('contract-on-hand'), { caption: onHandCount === undefined ? undefined : t('home.projectCount', { count: onHandCount, defaultValue_one: '{{count}} project', defaultValue_other: '{{count}} projects' }), reason: t('home.reasonContract', 'contract values are missing') }),
      moneyTile(invoiced, { label: t('home.invoiced', 'Invoiced'), caption: periodLabel }),
      moneyTile(collected, collectedOpts),
      moneyTile(leftToBill, { label: t('home.leftToBill', 'Left to bill'), caption: leftToBillNote ?? '' }),
      moneyTile(todayFigure('owed-clients'), { link: setUp }),
      moneyTile(supplier, { caption: toPay }),
      // Known margin is a fifth tile only when the accounting source provides it.
      margin?.amounts ? moneyTile(margin, { caption: '' }) : null,
    ]).filter((tile) => tile !== null);

  const linkClass = 'inline-flex items-center gap-1 text-control font-medium text-primary-text hover:underline pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  const cardLink = (to: string, label: string) => <Link to={to} className={linkClass}><span>{label}</span><Icon name="chev" className="size-4" /></Link>;

  // Sales (exec/admin): the open stages as one bar set, then what was won in the period.
  const won = periodFigure('won');
  const pipelineProjects = pipeline.data?.projects;
  const openCurrencies = new Set(pipelineProjects?.map((project) => project.currency) ?? []);
  const pipelineMixed = openCurrencies.size > 1;
  // 0187:101 stamps new budgets in org currency; this proxy breaks if budgets gain their own currency.
  const marginMismatch = pipelineProjects?.some((project) => project.currency !== orgCurrency) ?? false;
  const safeMargin = pipelineProjects && !marginMismatch ? data?.pipeline_projected_margin : null;
  const weighted = pipelineProjects && !pipelineMixed ? moneyTileValue(todayFigure('pipeline')?.amounts, orgCurrency) : null;
  const salesCard = (
    <Card>
      <CardHead level={2} actions={cardLink('/sales', t('dashboard:hub.company.openSales', 'Open sales'))}>{t('home.sales', 'Sales')}</CardHead>
      <CardPad className="grid gap-3">
        {weighted && <div><div className="text-control text-muted-foreground">{t('home.pipelineWeighted', 'Weighted pipeline')}</div><div className="text-[23px] font-bold leading-tight tabular" title={weighted.exact}>{weighted.value}</div>{safeMargin != null && <div className="text-control text-muted-foreground">{t('dashboard:hub.company.forecastMargin', 'Forecast margin')}: {(safeMargin * 100).toFixed(1)}%</div>}</div>}
        {pipeline.isPending ? <ListState variant="loading" shape="chart" rows={2} />
          : pipeline.isError ? <ListState variant="error" title={t('dashboard:hub.company.pipelineError', "Couldn't load pipeline stages")} onRetry={() => { void pipeline.refetch(); }} />
          : <SalesFunnel stages={pipeline.data?.stages ?? []} projects={pipelineProjects} currency={orgCurrency} period="" won={won?.amounts && won.count !== undefined ? { count: won.count, amounts: won.amounts, href: won.href } : undefined} />}
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
        {figures.dashboardError ? <ListState variant="error" title={t('dashboard:hub.company.purchasesError', "Couldn't load purchasing stages")} onRetry={figures.dashboardRetry} /> : figures.dashboardPending ? <ListState variant="loading" shape="chart" rows={2} /> : stageCounts.every((row) => row.count === 0) ? <ListState variant="empty" icon="cart" title={t('dashboard:hub.company.noPurchases', 'No procurements to show')} /> : <StageSegments data={stageCounts} toneFor={(stage) => chartTheme.categorical[PROCUREMENT_STAGES.indexOf(stage)] ?? chartTheme.categorical[0]} label={t('dashboard:hub.company.purchasingByStage', 'Purchasing by stage')} noun={t('dashboard:hub.company.procurementPlural', 'procurements')} hrefFor={(stage) => `/procurement?stage=${stage.toLowerCase()}`} labelFor={stageName} />}
      </CardPad>
    </Card>
  );
  // One tap from home to the board of claims by step and age; only where the board's own route is open to this person.
  const billingActions = (
    <>
      <ClaimsBoardLink className={linkClass} chevron={<Icon name="chev" className="size-4" />} />
      {cardLink('/finance/receivables', t('dashboard:hub.company.openInvoices', 'Open invoices'))}
    </>
  );
  const billingCard = (
    <Card>
      <CardHead level={2} actions={billingActions}>{t('home.billing', 'Billing')}</CardHead>
      <CardPad className="grid gap-3">
        <InvoicedTrendCard bare trend={figures.invoicedTrend} pending={figures.trendPending} error={figures.trendError} onRetry={figures.trendRetry} />
      </CardPad>
    </Card>
  );
  const analysis = finance ? <>{planCard}<FinanceAnalysis /></> : (
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
    { key: 'outstanding', header: t('home.colOutstanding', 'Outstanding'), kind: 'money', align: 'num', cell: (row) => row.outstanding === null ? null : <span className="tabular">{formatTableMoney(row.outstanding / 100, row.invoice.currency)}</span>, exportValue: (row) => row.outstanding === null ? '' : row.outstanding / 100 },
    { key: 'late', header: t('home.colLate', 'Overdue'), align: 'num', cell: (row) => <LateText emphasis={isMostUrgentLateRow(overdueRows, row)}>{t('home.daysOverdue', { count: row.daysOverdue, defaultValue_one: '{{count}} day overdue', defaultValue_other: '{{count}} days overdue' })}</LateText>, exportValue: (row) => row.daysOverdue },
  ];
  const activeStatuses = new Set<string>(ACTIVE_PROJECT_STATUSES);
  const budgetRows = (budgetReview.data ?? []).filter((row) => activeStatuses.has(row.status)).slice(0, 5);
  const budgetByProject = new Map((budgetReview.data ?? []).map((row) => [row.id, row]));
  const portfolioRows = portfolioProjects.map((project) => {
    const budget = budgetByProject.get(project.id);
    const milestones = portfolioMilestones.data?.[project.id];
    return {
      id: project.id,
      name: projectDisplayName(project),
      spent: budget?.spent ?? null,
      actualCurrency: budget?.actual_currency ?? null,
      budget: budget?.budget ?? null,
      budgetCurrency: budget?.budget_currency ?? null,
      doneMilestones: milestones?.doneCount ?? null,
      totalMilestones: milestones?.totalCount ?? null,
      lateMilestones: milestones?.lateCount ?? null,
      plannedPct: milestones?.plannedPct ?? null,
      actualPct: portfolioDelivery.data?.[project.id]?.deliveryPct ?? null,
    };
  });
  const portfolioPending = projects.isPending || (portfolioIds.length > 0 && (portfolioMilestones.isPending || portfolioDelivery.isPending || budgetReview.isPending));
  const portfolioError = projects.isError || (portfolioIds.length > 0 && (portfolioMilestones.isError || portfolioDelivery.isError || budgetReview.isError));
  const retryPortfolio = () => { void projects.refetch(); void portfolioMilestones.refetch(); void portfolioDelivery.refetch(); void budgetReview.refetch(); };

  const waitsEl = <DashboardWaitsOnYou rows={waitRows} pending={needs.isPending} error={needs.isError} onRetry={needs.refetch} />;
  const overdueCard = (
    <Card id="client-overdue">
      <CardHead level={2} actions={cardLink('/finance/receivables?overdue=true', t('home.allOverdue', 'All overdue'))}>{t('home.overdueFromClients', 'Client overdue')}</CardHead>
      {financePosition.isError && !financePosition.isPending
        ? <div className="px-[var(--panel-inset)] pb-1"><ListState variant="error" title={t('home.overdueError', "Couldn't load overdue invoices")} onRetry={financePosition.retry} quiet /></div>
        : (
          <div className={cn('overflow-x-auto [--table-cell-inset:var(--panel-inset)]', financePosition.isPending && PHONE_TABLE_HOLD)}>
            <DataTable rows={overdueRows} columns={overdueColumns} rowKey={(row) => row.invoice.id} onActivate={() => navigate('/finance/receivables?overdue=true')} rowHref={() => '/finance/receivables?overdue=true'} rowLabel={(row) => t('home.openInvoiceFor', 'Open overdue invoice for {{name}}', { name: row.invoice.customer_name ?? '' })} state={financePosition.isPending ? 'loading' : overdueRows.length === 0 ? 'empty' : undefined} emptyTitle={t('home.noOverdue', 'No overdue client invoices')} tableId="dashboard-company-overdue-clients" embedded />
          </div>
        )}
    </Card>
  );
  const readyCard = <ReadyToPayCard rows={procurements.data ?? []} pending={procurements.isPending} error={procurements.isError} retry={() => void procurements.refetch()} unpaidOf={unpaidOf} today={figures.organizationToday} />;
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
        action={<div className="flex flex-wrap items-end gap-2"><PeriodPicker period={periodState.period} selectPeriod={periodState.selectPeriod} setCustomMonth={periodState.setCustomMonth} compact /><Button variant="outline" size="sm" onClick={refresh} aria-label={t('dashboard:hub.company.refresh', 'Refresh dashboard')}><Icon name="refresh" /><span className="hidden sm:inline">{t('dashboard:hub.company.refresh', 'Refresh')}</span></Button></div>}
      />
      <FigureHiddenLine compact />
    </div>
  );
  // Each tile carries its own error, so one failed read never hides the healthy figures beside it.
  const tilesRow = (cols: string, tileList: React.ReactNode[]) => <KPIRow panelInset aria-label={t('dashboard:hub.company.keyFigures', 'Company figures')} className={cols}>{tileList}</KPIRow>;

  if (overview) {
    // One grid: 12 columns, one gutter (--space-panel-gap, 24px desktop). At 1440 the canvas is 1168px:
    // 12c + 11 x 24 = 1168 -> c = 75.33; a half is 6c + 5g = 572, a third 4c + 3g = 373.3; 3 x 373.3 + 2 x 24 = 1168.
    // Rows: figures (12) · Project health (7) | [Waits on you, Finances, and for Executive/Admin Purchasing by stage] (5) · Billing (12) · then
    // Executive/Admin: Sales (12); Finance: Billing carries owed by age · Client overdue (12) · Ready to pay (12).
    // Below 900px every block takes the full width, in the phone order: finding, figures, waits, health, finances, the rest.
    const lossRange = figures.winRateRange;
    const wonAmounts = won?.amounts && won.count !== undefined ? { count: won.count, amounts: won.amounts, href: won.href } : undefined;
    const trendRange = trendWindow(figures.organizationToday);
    const trendMonths = trendRange.from && trendRange.to ? monthsBetween(trendRange.from, trendRange.to).map((month) => month.slice(0, 7)) : [];
    // A1: every tile fills in on its own read; there is no band-wide skeleton or band-wide error.
    // Each tile carries a secondary line so their captions end together at the band's foot.
    const marginStatus = figures.figureStatus('billed-margin');
    const bandTiles = [
      moneyTile(todayFigure('contract-on-hand'), { caption: onHandCount === undefined ? '' : t('home.signedContractCount', { count: onHandCount, defaultValue_one: '{{count}} with a signed contract', defaultValue_other: '{{count}} with a signed contract' }), reason: t('home.reasonContract', 'contract values are missing') }),
      moneyTile(invoiced, { label: t('home.invoiced', 'Invoiced'), caption: periodLabel }),
      moneyTile(collected, collectedOpts),
      moneyTile(leftToBill, { label: t('home.leftToBill', 'Left to bill'), caption: leftToBillNote ?? t('home.onSignedContracts', 'On signed contracts') }),
      // One label in every state: the figure is always the known amount (AC-1414), so it says so before its read lands.
      // While loading, the tile is held only if it showed last time, so the band does not settle from five to four.
      (marginStatus.pending && marginShownBefore) || marginStatus.error || margin?.amounts
        ? moneyTile(margin, { label: t('dashboard:hub.company.knownMarginOnBilledWork', 'Known margin on billed work'), caption: t('home.marginCaption', 'Billed revenue less spending') }) : null,
    ].filter((tile) => tile !== null);
    // Five figures do not fit one line below 1280px (values ran past their cells at 1024): there they sit three over two.
    const band = tilesRow(cn('grid-cols-2 max-[899px]:[&>*:last-child:nth-child(odd)]:col-span-2', bandTiles.length >= 5
      ? 'min-[900px]:max-[1279px]:grid-cols-6 min-[900px]:max-[1279px]:[&>*]:col-span-2 min-[900px]:max-[1279px]:[&>*:nth-child(n+4)]:col-span-3 min-[1280px]:grid-flow-col min-[1280px]:auto-cols-fr'
      : 'min-[900px]:grid-flow-col min-[900px]:auto-cols-fr'), bandTiles);

    // Each card takes its natural height; for Executive/Admin, Purchasing by stage (the right column's last card)
    // absorbs the few pixels that let the column end level with Project health.
    // First row: Project health beside what waits on you and what is owed each way, so both questions
    // (are operations running well, are the finances in order) and the decisions waiting are answered before scrolling.
    const overdue = needs.overdueInvoices;
    const retryOwed = () => { figures.todayRetry(); figures.periodRetry(); void erpPurchases.refetch(); };
    const owedCard = (
      <FinancesCard className="max-[899px]:order-5" currency={orgCurrency}
        receivables={figures.receivables} receivablesPending={figures.receivablesPending} receivablesError={figures.receivablesError}
        payables={figures.payables} payablesPending={figures.payablesPending} payablesError={figures.payablesError || erpPurchases.isError}
        retry={retryOwed} />
    );
    const healthCard = (
      <ProjectHealthCard className={cn('min-w-0 min-[900px]:col-span-6', finance && 'min-[900px]:col-start-7 min-[900px]:row-start-1', 'max-[899px]:order-4')} rows={healthRows} delivery={healthDelivery.data}
        pending={figures.dashboardPending} error={figures.dashboardError} retry={figures.dashboardRetry}
        budgetLinkOnOverBudget={finance} />
    );
    const approvalsTotal = needs.approvals?.length ?? 0;
    const otherWaits = waitRows.filter((row) => row.id !== 'approvals');
    const nothingYet = otherWaits.length === 0 && approvalsTotal === 0;
    // The badge counts the items themselves (each approval, each invoice in a row), never the number of rows.
    const waitingTotal = approvalsTotal + otherWaits.reduce((sum, row) => sum + (typeof row.count === 'number' ? row.count : 0), 0);
    const waits = (
      <DashboardWaitsOnYou plain count={waitingTotal || undefined} linkCount={approvalsTotal} skeletonRows={finance ? 5 : 3} className="max-[899px]:order-3" rows={otherWaits}
        pending={needs.approvalsPending || (nothingYet && needs.isPending)} error={needs.approvalsError || (nothingYet && needs.isError)} onRetry={needs.refetch}
        lead={needs.approvals && needs.approvals.length > 0 ? <ApprovalItems entries={needs.approvals} /> : undefined}
        actions={approvalsTotal > 0 ? cardLink('/approvals', t('home.allApprovals', { count: approvalsTotal, defaultValue_one: 'All {{count}} approvals', defaultValue_other: 'All {{count}} approvals' })) : undefined} />
    );
    const firstRow = (
      <>
        {healthCard}
        {/* Finance reads its chase queue first: on a wide screen Waits on you takes the left, first-read column. */}
        <div className={cn('flex min-w-0 flex-col gap-[var(--space-panel-gap)] min-[900px]:col-span-6', finance && 'min-[900px]:col-start-1 min-[900px]:row-start-1', 'max-[899px]:contents')}>
          {waits}
          {owedCard}
          {!finance && <PurchasingCard className="max-[899px]:order-7" counts={stageCounts} stageName={stageName} pending={figures.dashboardPending} error={figures.dashboardError} retry={figures.dashboardRetry} />}
        </div>
      </>
    );
    // Money in: invoiced and collected by month beside what is left to bill on signed work (one band, one card).
    const billingBand = (
      <Card data-testid="billing" className={cn('min-w-0 min-[900px]:col-span-12', 'max-[899px]:order-6')}>
        <CardHead level={2} actions={billingActions}>{t('home.billing', 'Billing')}</CardHead>
        {/* With the monthly chart withheld (too few months), what is left to bill takes the whole card. */}
        <CardPad className="grid gap-x-[var(--space-panel-gap)] gap-y-5 min-[900px]:grid-cols-12 min-[900px]:[&>:only-child]:col-span-12">
          <InvoicedCollectedCard className="min-w-0 min-[900px]:col-span-7" embedded chartHeight={188} fill={finance && wide} months={figures.trendInvoicedByMonth} periodMonths={trendMonths} collectedByMonth={figures.collectedByMonth} collectedUnsynced={collectedUnsynced} pending={figures.trendPending || figures.collectedPending} error={figures.trendError} retry={figures.trendRetry} currency={orgCurrency} />
          <div className="flex min-w-0 flex-col gap-5 min-[900px]:col-span-5">
            <LeftToBillSection limit={finance ? 3 : 5} currency={orgCurrency} rows={figures.leftToBillByProject} pending={figures.figureStatus('left-to-bill').pending} error={figures.figureStatus('left-to-bill').error} retry={retryOwed} />
            {/* Finance: what clients owe, by how long it has been due, under what is left to bill. */}
            {finance && <ReceivablesAgeCard embedded rowPitch={36} ageing={financePosition.position.receivablesAgeing} unknownCount={financePosition.position.receivablesUnknownCount} noDueDateCount={financePosition.position.receivablesNoDueDateCounts?.[orgCurrency] ?? 0} currency={orgCurrency} pending={financePosition.isPending} error={financePosition.isError} retry={financePosition.retry} />}
          </div>
        </CardPad>
      </Card>
    );
    const portfolio = managementViewsEnabled
      ? <ProjectPortfolioTable rows={portfolioRows} pending={portfolioPending} error={portfolioError} retry={retryPortfolio} />
      : null;
    // Finance: who owes us (worst first), then what is ready to pay.
    // Executive and Admin: Sales as one full-width band (purchasing by stage sits under Finances).
    const lowerRows = finance ? (
      <>
        <div className={cn('min-w-0 min-[900px]:col-span-12', 'max-[899px]:order-7')}>{overdueCard}</div>
        <div className={cn('min-w-0 min-[900px]:col-span-12', 'max-[899px]:order-9')}>{readyCard}</div>
      </>
    ) : (
      <>
        <SalesOverviewCard wide className={cn('min-w-0 min-[900px]:col-span-12', 'max-[899px]:order-8')} weighted={weighted} forecastMargin={safeMargin} stages={pipeline.data?.stages ?? []} projects={pipelineProjects} pending={pipeline.isPending} error={pipeline.isError} retry={() => { void pipeline.refetch(); }} currency={orgCurrency} period="" won={wonAmounts} range={lossRange}
          aside={<LossReasonsCard embedded range={lossRange} refreshToken={refreshToken} />} />
      </>
    );
    return (
      <FigureScope>
        <UncheckedReport count={unchecked} />
        {!finance && <PipelineCurrencyReport mixed={pipelineMixed} margin={marginMismatch} />}
        <div className="space-y-[var(--space-panel-gap)]" data-company-role={role} data-home-layout="overview">
          <div>
            <PageHeader
              className="mb-1"
              title={t('dashboard:hub.company.title', 'Dashboard')}
              help={t('home.help.basis', 'Position today in each record currency. Invoiced, collected and won cover the period chosen.')}
              action={<div className="flex flex-wrap items-end gap-2"><PeriodPicker period={periodState.period} selectPeriod={periodState.selectPeriod} setCustomMonth={periodState.setCustomMonth} compact /><Button variant="outline" size="sm" onClick={refresh} aria-label={t('dashboard:hub.company.refresh', 'Refresh dashboard')}><Icon name="refresh" /><span className="hidden sm:inline">{t('dashboard:hub.company.refresh', 'Refresh')}</span></Button></div>}
            />
            {/* The summary keeps its row in every state: a skeleton while it loads, one line and Retry when it fails. */}
            <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-6 gap-y-2">
              {figures.dashboardPending || needs.approvalsPending ? <div aria-hidden className="flex gap-2"><div className="skel h-7 w-52 rounded-full" /><div className="skel h-7 w-64 rounded-full max-[639px]:hidden" /></div> : null}
              <FindingLine offTrack={figures.dashboardPending || figures.dashboardError ? undefined : { count: offTrackCount, atLeast: offTrackSaturated, total: activeProjectCount, unchecked }} overdue={overdue /* undefined until its own invoices read and the org day resolve */} approvals={needs.approvals?.length}
                failed={!figures.dashboardPending && !needs.approvalsPending && (figures.dashboardError || needs.isError)} onRetry={refresh} />
              <FigureHiddenLine compact />
            </div>
          </div>
          {band}
          {/* Every card ends at its own content in every state: a column may end higher than its neighbour, never a blank band inside a card. */}
          <div data-testid="home-grid" className="grid items-start gap-[var(--space-panel-gap)] max-[899px]:grid-cols-1 min-[900px]:grid-cols-12">
            {firstRow}
            {billingBand}
            {lowerRows}
            <div className={cn('min-w-0 min-[900px]:col-span-12', 'max-[899px]:order-10')}>
              <WorkOrdersTile />
            </div>
          </div>
          {portfolio}
          {finance && <Analysis title={t('home.analysis', 'Analysis')}><FinanceAnalysis /></Analysis>}
        </div>
      </FigureScope>
    );
  }
  return (
    <FigureScope>
      <UncheckedReport count={unchecked} />
        {!finance && <PipelineCurrencyReport mixed={pipelineMixed} margin={marginMismatch} />}
      <div className="space-y-[var(--space-panel-gap)]" data-company-role={role} data-home-layout="focused">
        {header}
        {waitsEl}
        {finance ? <>{overdueCard}{readyCard}</> : offTrackEl}
        {managementViewsEnabled && <ProjectPortfolioTable rows={portfolioRows} pending={portfolioPending} error={portfolioError} retry={retryPortfolio} />}
        {(() => {
          const tiles = tilesRow(finance ? 'grid-cols-2 min-[900px]:auto-cols-fr min-[900px]:grid-flow-col' : 'grid-cols-2 [&>*:last-child:nth-child(odd)]:col-span-2', positionTiles);
          // Executive: the position tiles and the Sales card share one row on desktop (Sales at half width); stacked on a phone.
          return finance ? tiles : <div className="grid items-start gap-[var(--space-panel-gap)] min-[900px]:grid-cols-2">{tiles}{salesCard}</div>;
        })()}
        {finance && <BudgetReviewCard rows={budgetRows} pending={budgetReview.isPending} error={budgetReview.isError} retry={() => void budgetReview.refetch()} />}
        <WorkOrdersTile />
        <Analysis title={t('home.analysis', 'Analysis')}>{analysis}</Analysis>
      </div>
    </FigureScope>
  );
}
