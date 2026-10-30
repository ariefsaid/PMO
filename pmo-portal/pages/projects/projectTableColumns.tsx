import type { TFunction } from 'i18next';
import { CompanyNameLink, ProgressBar, StatusPill, TaxBasisLabel, type Column } from '@/src/components/ui';
import { withCurrencyColumn } from '@/src/components/export';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { formatCurrency, formatInstantDate } from '@/src/lib/format';
import { deriveActualPosition, formatExactMoney, isActualComplete } from '@/src/lib/projectFinances';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { useProjectsDeliverySummary } from '@/src/hooks/useProjectsDelivery';
import type { useProjectsMoneyCollection } from '@/src/hooks/useProjectsMoneyCollection';
import { pillVariantForProjectStatus, projectIconColor } from '../../components/projects';
import { projectManagerLabel } from '@/src/lib/projects/projectManagerLabel';

interface ProjectTableColumnInputs {
  filtered: ProjectWithRefs[];
  deliverySummary: ReturnType<typeof useProjectsDeliverySummary>['data'];
  deliveryPending: boolean;
  deliveryError: boolean;
  projectMoney: ReturnType<typeof useProjectsMoneyCollection>['data'];
  moneyPending: boolean;
  moneyError: boolean;
  canViewMoney: boolean;
  isAtRiskActual: (project: ProjectWithRefs) => boolean;
  onOpen: (project: ProjectWithRefs) => void;
  projectStatusLabel: (status: string) => string;
  t: TFunction;
}

export function projectTableColumns({ filtered, deliverySummary, deliveryPending, deliveryError, projectMoney,
  moneyPending, moneyError, canViewMoney, isAtRiskActual, onOpen, projectStatusLabel, t }: ProjectTableColumnInputs) {
  const hasDeliveryData = deliveryPending || deliveryError || filtered.some((project) => deliverySummary?.[project.id]?.deliveryPct != null);
  const hasBudgetData = moneyPending || moneyError || filtered.some((project) => projectMoney?.[project.id]?.hasActiveBudget);
  // ONE table-level coverage note (AC-RD-TBL-PROJ-001): the count of ERP rows with an unmapped or
  // amount-less category, and the newest ERP update among the visible rows.
  const partialRows = filtered.filter((project) => {
    const money = projectMoney?.[project.id];
    return money?.ledgerBasis === 'erp' && money.actuals.categories.some((category) => !category.mapped || category.amount == null);
  });
  const unknownActualRows = filtered.filter((project) => {
    const money = projectMoney?.[project.id];
    return money?.actuals.total == null || (money.ledgerBasis === 'pmo'
      && (money.actuals.complete === false || money.actuals.currency !== project.currency));
  });
  const coverageAsOf = filtered.reduce<string | null>((latest, project) => {
    const asOf = projectMoney?.[project.id]?.ledgerBasis === 'erp' ? projectMoney?.[project.id]?.actuals.asOf ?? null : null;
    return asOf && (!latest || asOf > latest) ? asOf : latest;
  }, null);
  const coverageReason = moneyPending
    ? undefined
    : moneyError
      ? t('projects:coverage.readError', 'Project spending could not be read.')
      : partialRows.length > 0
      ? coverageAsOf
        ? t('projects:coverage.partialUpdated', 'Actual is partial on {{partial}} of {{total}} projects. Updated {{date}}.', { partial: partialRows.length, total: filtered.length, date: formatInstantDate(coverageAsOf) })
        : t('projects:coverage.partial', 'Actual is partial on {{partial}} of {{total}} projects.', { partial: partialRows.length, total: filtered.length })
      : unknownActualRows.length > 0
        ? t('projects:coverage.unknown', 'Actual is unknown on {{count}} of {{total}} projects.', { count: unknownActualRows.length, total: filtered.length })
        : undefined;
  // The money-view-gated Contract column (see `canViewMoney`). A typed const — not an inline
  // conditional spread — so the surrounding array literal keeps its contextual `Column` typing.
  const contractColumn: Column<ProjectWithRefs> | null = canViewMoney ? {
    key: 'contract',
    header: t('projects.columns.contract', 'Contract'),
    kind: 'money',
    size: 160,
    minSize: 152,
    maxSize: 320,
    align: 'num',
    exportValue: (p) => p.contract_value,
    // FR-L10N-020: each row is one project, so the currency is that project's own (0187's
    // per-record column) — an org default would be wrong the moment two currencies coexist.
    // OD-TAX-1 §2: a contract figure carries its basis wherever it is rendered. A list is the
    // surface where two projects on OPPOSITE bases sit one row apart — a column of bare numbers
    // there reads as comparable when it is not.
    // Keep the visible basis concise; the record's full stored qualifier remains available to AT.
    cell: (p) => {
      const detailsId = `contract-tax-details-${p.id}`;
      return (
        <div className="flex min-w-0 flex-col items-end gap-0.5" aria-describedby={detailsId}>
          <span>{formatCurrency(p.contract_value, p.currency)}</span>
          <TaxBasisLabel
            treatment={p.tax_treatment}
            showDetails={false}
            className="block max-w-full whitespace-normal break-words leading-tight"
          />
          <span id={detailsId} className="sr-only">
            <TaxBasisLabel
              treatment={p.tax_treatment}
              taxRate={p.tax_rate}
              taxBaseNumerator={p.tax_base_numerator}
              taxBaseDenominator={p.tax_base_denominator}
              className="block max-w-full whitespace-normal break-words"
              testId={`contract-tax-label-${p.id}`}
            />
          </span>
        </div>
      );
    },
  } : null;
  const actualProjection = (p: ProjectWithRefs): { text: string; exportText?: string; restricted?: boolean } => {
    const money = projectMoney?.[p.id];
    if (moneyPending || moneyError || !money) return { text: '' };
    const actualPosition = deriveActualPosition({
      ledgerBasis: money.ledgerBasis,
      committedSpend: money.ledgerBasis === 'pmo' && money.actuals.currency === p.currency ? money.actuals.total ?? undefined : undefined,
      commitmentPending: moneyPending,
      commitmentError: moneyError,
      commitmentComplete: money.actuals.complete,
      projectCurrency: p.currency,
      actuals: {
        currency: money.actuals.currency,
        total: money.actuals.total,
        as_of: money.actuals.asOf,
        excludes_restricted_rows: money.actuals.excludesRestrictedRows,
        categories: money.actuals.categories,
      },
    });
    const actual = actualPosition.amount;
    if (actual == null) {
      // Incomplete coverage is explained once in the table caveat. Restricted rows have a
      // distinct row-level cause, so keep that plain-language tag and omit the numeric slot.
      return money.actuals.excludesRestrictedRows
        ? { text: t('projects:actual.restrictedTag', 'Restricted excluded'), restricted: true }
        : { text: '' };
    }
    const formatted = formatExactMoney(actual, actualPosition.currency || p.currency, getNumberLocale(), { wholeUnits: true });
    const currency = actualPosition.currency || p.currency;
    const exact = formatExactMoney(actual, currency, getNumberLocale());
    return { text: formatted || '', exportText: exact ? `${exact} ${currency}` : '' };
  };
  const budgetExport = (p: ProjectWithRefs): string | number => {
    const money = projectMoney?.[p.id];
    const actual = money?.actuals.total == null ? null : Number(money.actuals.total);
    const activeBudget = money?.hasActiveBudget && money.activeBudgetAmount != null ? Number(money.activeBudgetAmount) : null;
    if (moneyPending || moneyError || !money) return '';
    if (!money.hasActiveBudget || activeBudget == null) {
      return t('uxs02.noActiveBudget', 'No active budget');
    }
    if (activeBudget === 0) {
      const reason = t('uxs02.zeroActiveBudget', '{{budget}} Active budget; usage unavailable', { budget: formatCurrency(activeBudget, money.activeBudgetCurrency ?? p.currency) });
      return reason;
    }
    if (actual == null) return '';
    if (money.activeBudgetCurrency !== money.actuals.currency || money.actuals.currency !== p.currency) {
      return t('uxs02.currencyMismatch', 'Budget currency differs from Actual');
    }
    const completeCoverage = isActualComplete({ basis: money.ledgerBasis ?? 'erp', readSucceeded: true, complete: money.actuals.complete,
      categories: money.actuals.categories, excludesRestrictedRows: money.actuals.excludesRestrictedRows });
    if (!completeCoverage) {
      return '';
    }
    return Math.round((actual / activeBudget) * 100);
  };
  const columns: Column<ProjectWithRefs>[] = [
    {
      key: 'project',
      header: t('projects.columns.project', 'Project'),
      kind: 'primary',
      size: 240,
      minSize: 240,
      maxSize: 640,
      exportValue: (p) => p.name,
      primaryTitle: (p) => p.name,
      secondaryCell: (p) => {
        const ids = [p.pmo_project_number, p.code].filter(Boolean).join(' · ');
        return (
          <span className="block min-w-0" onClick={(event) => event.stopPropagation()}>
            <CompanyNameLink companyId={p.client_id} name={p.client ? companyDisplayName(p.client) : null} className="inline max-w-[180px] align-baseline text-[12px]" />
            {ids && <> · {p.pmo_project_number && <span className="sr-only">{t('projects.identifiers.pmo', 'PMO Project Number')}: </span>}<span className="font-mono" title={ids}>{ids}</span></>}
            {p.end_client && <span className="block truncate text-[11px] text-muted-foreground">{companyDisplayName(p.end_client)}</span>}
          </span>
        );
      },
      cell: (p) => {
        const atRisk = isAtRiskActual(p);
        return (
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white"
              style={{ background: projectIconColor() }}
            >
              {(projectDisplayName(p).trim().charAt(0) || '•').toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-col items-start gap-1">
                <button
                  type="button"
                  data-list-return-focus={`projects:${p.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(p);
                  }}
                  className="block w-full whitespace-normal break-words text-left font-semibold hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:line-clamp-2"
                  title={p.name}
                  aria-describedby={projectDisplayName(p) !== p.name ? `project-legal-${p.id}` : undefined}
                >
                  {projectDisplayName(p)}
                </button>
                {projectDisplayName(p) !== p.name && <span id={`project-legal-${p.id}`} className="sr-only">{p.name}</span>}
                {/* AC-IXD-DASH-W5-C2C N18/I3: text+dot pill (not color-only). */}
                {atRisk && (
                  <StatusPill variant="warn">{t('projects.atRiskPill', 'At risk')}</StatusPill>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'pm',
      header: t('projects.columns.pm', 'PM'),
      kind: 'meta',
      size: 112,
      minSize: 112,
      maxSize: 320,
      // FR-PRJUX-004/005: an assigned blank-name profile exports its readable fallback,
      // and is never exported as "unassigned".
      exportValue: (p) =>
        projectManagerLabel({
          managerId: p.project_manager_id,
          fullName: p.pm?.full_name,
          unassignedLabel: t('projects.unassigned', 'Unassigned'),
          unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
        }),
      // The compact initials avatar preserves the full PM name for assistive technology and hover.
      cell: (p) => {
        if (p.project_manager_id == null) {
          return <span className="text-[12px] text-muted-foreground">{t('projects.unassigned', 'Unassigned')}</span>;
        }
        const label = projectManagerLabel({
          managerId: p.project_manager_id,
          fullName: p.pm?.full_name,
          unassignedLabel: t('projects.unassigned', 'Unassigned'),
          unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
        });
        const initials = label.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || '?';
        return (
          <span className="flex items-center justify-center">
            <span
              role="img"
              aria-label={label}
              title={label}
              className="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
              style={{ background: 'hsl(var(--avatar-2))' }}
            >
              {initials}
            </span>
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('projects.columns.status', 'Status'),
      kind: 'status',
      size: 140,
      minSize: 112,
      maxSize: 220,
      exportValue: (p) => String(p.status),
      cell: (p) => <StatusPill variant={pillVariantForProjectStatus(p.status as string)}>{projectStatusLabel(p.status as string)}</StatusPill>,
    },
    // Contract figure is money-view-gated (see `canViewMoney`): roles without the shared
    // money-view permission get no Contract column — and, since `withCurrencyColumn` only
    // inserts next to this key, neither the export's Contract column nor its per-row Currency
    // column. Gating the column covers the desktop table AND the phone card reflow (the
    // DataTable renders both branches from this one array).
    ...(contractColumn ? [contractColumn] : []),
    {
      key: 'actual',
      header: t('projects.columns.actual', 'Actual'),
      kind: 'money',
      size: 160,
      minSize: 152,
      maxSize: 320,
      align: 'num',
      colClassName: 'xl:pr-6',
      caveat: coverageReason ? { reason: coverageReason } : undefined,
      exportValue: (p) => {
        const { text, exportText } = actualProjection(p);
        return exportText ?? text;
      },
      // RF-008 / S-02: canonical ERP-mapped Actual, never the legacy stored project.spent value.
      cell: (p) => {
        if (moneyPending) return <span className="text-[12px] text-muted-foreground">…</span>;
        const actual = actualProjection(p);
        return actual.text ? <span className={actual.restricted ? 'text-muted-foreground text-[11px]' : 'text-muted-foreground'}>{actual.text}</span> : null;
      },
    },
    {
      key: 'progress',
      header: t('projects.columns.progress', 'Progress'),
      kind: 'percent',
      size: 120,
      minSize: 96,
      maxSize: 160,
      colClassName: 'xl:pl-6',
      exportValue: (p) => deliveryError || deliveryPending || deliverySummary?.[p.id]?.deliveryPct == null ? '' : Math.round(deliverySummary[p.id].deliveryPct!),
      cell: (p) => {
        // I7: defer while delivery summary is loading to prevent flash of false empty state.
        if (deliveryError) return <span className="text-[12px] text-muted-foreground">—</span>;
        if (deliveryPending) {
          return <span className="text-[12px] text-muted-foreground">…</span>;
        }
        const summary = deliverySummary?.[p.id];
        if (summary?.deliveryPct == null) {
          const noPhases = t('projects.noPhasesYet', 'No phases yet');
          return <span role="img" aria-label={noPhases} title={noPhases} className="text-[12px] text-muted-foreground">—</span>;
        }
        const roundedDelivery = Math.round(summary.deliveryPct);
        return (
          <div className="flex flex-col gap-0.5">
            <ProgressBar value={roundedDelivery} showValue compact tone={roundedDelivery >= 100 ? 'success' : 'primary'} aria-label={t('projects.card.deliveryPercent', 'Delivery {{percent}}%', { percent: roundedDelivery })} />
          </div>
        );
      },
    },
    {
      key: 'budget-used',
      exportValue: budgetExport,
      header: t('projects.columns.budgetUsed', 'Budget used'),
      kind: 'money',
      size: 160,
      minSize: 152,
      maxSize: 320,
      cell: (p) => {
        if (moneyPending) return <span className="text-[12px] text-muted-foreground">…</span>;
        const percent = budgetExport(p);
        if (typeof percent === 'string') return percent ? <span className="text-muted-foreground">{percent}</span> : null;
        const money = projectMoney![p.id]!;
        const atRisk = isAtRiskActual(p);
        return (
          <div title={t('uxs02.budgetSummary', '{{actual}} of {{budget}} Active budget', { actual: formatExactMoney(money.actuals.total, money.actuals.currency || p.currency, getNumberLocale(), { wholeUnits: true }), budget: formatExactMoney(money.activeBudgetAmount, money.activeBudgetCurrency ?? p.currency, getNumberLocale(), { wholeUnits: true }) })}>
            <ProgressBar value={percent} showValue compact tone={atRisk ? 'destructive' : percent >= 70 ? 'warning' : undefined} aria-label={t('uxs02.budgetUsed', '{{percent}}% of Active budget', { percent })} />
          </div>
        );
      },
    },
  ];
  // Columns with no data in the visible set (no phases anywhere, no Active budget anywhere) are omitted.
  const visibleColumns = columns.filter((column) => {
    if (column.key === 'progress') return hasDeliveryData;
    if (column.key === 'budget-used') return hasBudgetData;
    return true;
  });

  // AC-L10N-052: the download carries each row's own ISO code beside contract (export-only).
  // Money-view-gated roles have no `contract` column at all, so this inserts no Currency column
  // either — their export carries neither the contract figure nor its currency qualifier.
  const exportColumns = withCurrencyColumn(visibleColumns, 'contract', (r) => r.currency);
  return { visibleColumns, exportColumns };

}
