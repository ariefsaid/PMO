import type { TFunction } from 'i18next';
import { CompanyNameLink, ProgressBar, StatusPill, TaxBasisLabel, type Column } from '@/src/components/ui';
import { withCurrencyColumn } from '@/src/components/export';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { formatCurrency } from '@/src/lib/format';
import { deriveBudgetConsumption, deriveCollectionActual, formatExactMoney, projectBudgetUsedPercent } from '@/src/lib/projectFinances';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { useProjectsDeliverySummary } from '@/src/hooks/useProjectsDelivery';
import type { useProjectsMoneyCollection } from '@/src/hooks/useProjectsMoneyCollection';
import { projectIconColor } from '../../components/projects';
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
  /** The signed-in user; a PM column that is only ever the viewer carries nothing and is dropped. */
  viewerId?: string | null;
  isAtRiskActual: (project: ProjectWithRefs) => boolean;
  onOpen: (project: ProjectWithRefs) => void;
  onPrefetch?: (id: string) => void;
  t: TFunction;
}

export function projectTableColumns({ filtered, deliverySummary, deliveryPending, deliveryError, projectMoney,
  moneyPending, moneyError, canViewMoney, viewerId, isAtRiskActual, onOpen, onPrefetch, t }: ProjectTableColumnInputs) {
  const hasDeliveryData = deliveryPending || deliveryError || filtered.some((project) => deliverySummary?.[project.id]?.deliveryPct != null);
  const hasBudgetData = moneyPending || moneyError || filtered.some((project) => projectMoney?.[project.id]?.hasActiveBudget);
  // #2060: the table renders the SAME Actual the Cards view does, from the same collection read.
  const actualPosition = (project: ProjectWithRefs) => deriveCollectionActual({
    projectCurrency: project.currency,
    money: projectMoney?.[project.id],
    moneyPending,
    moneyError,
  });
  // The Actual column drops itself when no row has a figure. Say why once, on the page's hidden-figures
  // line, instead of a sentence about a column that is not there. A role whose money read never runs
  // (no data, no error) has nothing to set up, so it gets no line.
  const actualHidden = !moneyPending && (moneyError || projectMoney !== undefined) && filtered.length > 0
    && filtered.every((project) => {
      const position = actualPosition(project);
      return !position.text && !position.restricted;
    });
  const actualHiddenReason = !actualHidden ? null : moneyError
    ? t('projects:coverage.hiddenReadError', 'spending could not be read')
    : t('projects:coverage.hiddenNotLinked', 'spending is not linked');
  // One tax basis across the visible contracts is said once, in the header; a mix keeps it on each figure.
  const bases = [...new Set(filtered.map((p) => p.tax_treatment).filter((x): x is NonNullable<typeof x> => x === 'inclusive' || x === 'exclusive'))];
  const sharedBasis = bases.length === 1
    ? bases[0] === 'inclusive' ? t('tax.basis.inclusive', 'incl. PPN') : t('tax.basis.exclusive', 'excl. PPN')
    : null;
  // The money-view-gated Contract column (see `canViewMoney`). A typed const — not an inline
  // conditional spread — so the surrounding array literal keeps its contextual `Column` typing.
  const contractColumn: Column<ProjectWithRefs> | null = canViewMoney ? {
    key: 'contract',
    header: sharedBasis
      ? t('projects:columns.contractWithBasis', 'Contract ({{basis}})', { basis: sharedBasis })
      : t('projects.columns.contract', 'Contract'),
    kind: 'money',
    size: 140,
    minSize: 132,
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
          {!sharedBasis && (
            <TaxBasisLabel
              treatment={p.tax_treatment}
              showDetails={false}
              className="block max-w-full whitespace-normal break-words leading-tight"
            />
          )}
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
  const actualProjection = (p: ProjectWithRefs) => {
    const position = actualPosition(p);
    // Restricted rows have a distinct row-level cause, so the export keeps the plain-language tag.
    if (position.amount === null) return position.restricted ? { text: t('projects:actual.restrictedTag', 'Restricted excluded') } : { text: '', exportText: '' };
    const exact = formatExactMoney(position.amount, position.currency, getNumberLocale());
    return { text: position.text ?? '', exportText: exact ? `${exact} ${position.currency}` : '' };
  };
  /**
   * S03 owns the project consumption and completeness rule; this is a display/export projection only.
   */
  const consumptionOf = (p: ProjectWithRefs): { amount: string | null; complete: boolean } => {
    const money = projectMoney?.[p.id];
    return deriveBudgetConsumption(money?.budgetPosition);
  };
  const budgetExport = (p: ProjectWithRefs): string | number => {
    const money = projectMoney?.[p.id];
    const activeBudget = money?.hasActiveBudget && money.activeBudgetAmount != null ? Number(money.activeBudgetAmount) : null;
    if (moneyPending || moneyError || !money) return '';
    if (!money.hasActiveBudget || activeBudget == null) {
      return t('uxs02.noActiveBudget', 'No active budget');
    }
    if (activeBudget === 0) {
      const reason = t('uxs02.zeroActiveBudget', '{{budget}} Active budget before tax; usage unavailable', { budget: formatCurrency(activeBudget, money.activeBudgetCurrency ?? p.currency) });
      return reason;
    }
    if (money.budgetPosition?.budgetCurrency !== p.currency || money.budgetPosition?.currency !== p.currency) {
      return t('uxs02.currencyMismatch', 'Budget currency differs from project currency');
    }
    const percent = projectBudgetUsedPercent(money.budgetPosition, p.currency);
    return percent ?? '';
  };
  const columns: Column<ProjectWithRefs>[] = [
    {
      key: 'project',
      header: t('projects.columns.project', 'Project'),
      kind: 'primary',
      size: 340,
      minSize: 240,
      maxSize: 640,
      exportValue: (p) => p.name,
      primaryTitle: (p) => p.name,
      secondaryCell: (p) => {
        const ids = [p.pmo_project_number, p.code].filter(Boolean).join(' · ');
        const clientName = p.client ? companyDisplayName(p.client) : null;
        const endClientName = p.end_client ? companyDisplayName(p.end_client) : null;
        const metadata = [clientName, ids, endClientName].filter(Boolean).join(' · ');
        return (
          <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap" title={metadata} onClick={(event) => event.stopPropagation()}>
            {clientName && <span className="min-w-0 max-w-[44%] overflow-hidden text-ellipsis whitespace-nowrap"><CompanyNameLink companyId={p.client_id} name={clientName} className="inline" /></span>}
            {clientName && ids && <span aria-hidden className="shrink-0">·</span>}
            {ids && <>
              {p.pmo_project_number && <span className="sr-only">{t('projects.identifiers.pmo', 'PMO Project Number')}: </span>}
              <span className="shrink-0 whitespace-nowrap font-mono" title={ids}>{ids}</span>
            </>}
            {ids && endClientName && <span aria-hidden className="shrink-0">·</span>}
            {endClientName && <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground">{endClientName}</span>}
          </span>
        );
      },
      cell: (p) => {
        const atRisk = isAtRiskActual(p);
        return (
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-md text-sm font-bold text-white"
              style={{ background: projectIconColor() }}
            >
              {(projectDisplayName(p).trim().charAt(0) || '•').toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                data-list-return-focus={`projects:${p.id}`}
                onPointerEnter={() => onPrefetch?.(p.id)}
                onFocus={() => onPrefetch?.(p.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(p);
                }}
                className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left font-semibold hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                title={p.name}
                aria-describedby={projectDisplayName(p) !== p.name ? `project-legal-${p.id}` : undefined}
              >
                {projectDisplayName(p)}
              </button>
              {projectDisplayName(p) !== p.name && <span id={`project-legal-${p.id}`} className="sr-only">{p.name}</span>}
              {/* AC-IXD-DASH-W5-C2C N18/I3: text+dot pill (not color-only). */}
              {atRisk && (
                <span className="shrink-0"><StatusPill variant="warn" className="py-1">{t('projects.atRiskPill', 'At risk')}</StatusPill></span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'pm',
      header: t('projects.columns.pm', 'PM'),
      kind: 'meta',
      size: 120,
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
      cell: (p) => {
        const label = p.project_manager_id == null
          ? t('projects.unassigned', 'Unassigned')
          : projectManagerLabel({
            managerId: p.project_manager_id,
            fullName: p.pm?.full_name,
            unassignedLabel: t('projects.unassigned', 'Unassigned'),
            unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
          });
        return <span className={p.project_manager_id == null ? 'text-muted-foreground' : undefined}>{label}</span>;
      },
    },
    {
      key: 'status',
      header: t('projects.columns.status', 'Status'),
      kind: 'status',
      size: 136,
      minSize: 112,
      maxSize: 240,
      exportValue: (p) => String(p.status),
      cell: (p) => <StatusPill record="project" state={p.status as string} className="py-1" />,
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
      size: 136,
      minSize: 128,
      maxSize: 320,
      align: 'num',
      exportValue: (p) => {
        const { text, exportText } = actualProjection(p);
        return exportText ?? text;
      },
      // RF-008 / S-02: canonical ERP-mapped Actual, never the legacy stored project.spent value.
      // #2060: the figure is the collection read's own verdict (deriveCollectionActual), the same
      // one the Cards view renders; where it is withheld the cell says so — the em dash — instead
      // of a blank that reads as broken data. The table caveat carries the reason, once.
      cell: (p) => {
        if (moneyPending) return <span className="text-sm text-muted-foreground">…</span>;
        const position = actualPosition(p);
        if (position.text) return <span className="text-muted-foreground">{position.text}</span>;
        // Restricted rows have a distinct row-level cause, so the tag names it and the numeric slot is omitted.
        if (position.restricted) return <span className="text-muted-foreground text-sm">{t('projects:actual.restrictedTag', 'Restricted excluded')}</span>;
        return '—';
      },
    },
    {
      key: 'progress',
      header: t('projects.columns.progress', 'Progress'),
      kind: 'percent',
      size: 104,
      minSize: 88,
      maxSize: 160,
      exportValue: (p) => deliveryError || deliveryPending || deliverySummary?.[p.id]?.deliveryPct == null ? '' : Math.round(deliverySummary[p.id].deliveryPct!),
      cell: (p) => {
        // I7: defer while delivery summary is loading to prevent flash of false empty state.
        if (deliveryError) return <span className="text-sm text-muted-foreground">—</span>;
        if (deliveryPending) {
          return <span className="text-sm text-muted-foreground">…</span>;
        }
        const summary = deliverySummary?.[p.id];
        if (summary?.deliveryPct == null) {
          const noPhases = t('projects.noPhasesYet', 'No phases yet');
          return <span role="img" aria-label={noPhases} title={noPhases} className="text-sm text-muted-foreground">—</span>;
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
      header: t('projects.columns.budgetUsed', 'Budget used before tax'),
      kind: 'percent',
      size: 136,
      minSize: 128,
      maxSize: 320,
      cell: (p) => {
        if (moneyPending) return <span className="text-sm text-muted-foreground">…</span>;
        const percent = budgetExport(p);
        if (typeof percent === 'string') return percent ? <span className="text-muted-foreground">{percent}</span> : null;
        const money = projectMoney![p.id]!;
        const atRisk = isAtRiskActual(p);
        const consumption = consumptionOf(p);
        return (
          <div title={t('projects:budgetConsumption', '{{used}} of {{budget}} Active budget before tax', { used: formatExactMoney(consumption.amount, money.actuals.currency || p.currency, getNumberLocale(), { wholeUnits: true }), budget: formatExactMoney(money.activeBudgetAmount, money.activeBudgetCurrency ?? p.currency, getNumberLocale(), { wholeUnits: true }) })}>
            <ProgressBar value={percent} showValue compact tone={atRisk ? 'destructive' : percent >= 70 ? 'warning' : undefined} aria-label={t('uxs02.budgetUsed', '{{percent}}% of Active budget before tax', { percent })} />
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
  // On screen, a PM column that only ever names the viewer says nothing. The download keeps it.
  // One manager across every visible project is said once, above the list, and the column goes.
  const pmIsViewer = viewerId != null && filtered.length > 0 && filtered.every((p) => p.project_manager_id === viewerId);
  const pmOf = (p: ProjectWithRefs) => projectManagerLabel({
    managerId: p.project_manager_id,
    fullName: p.pm?.full_name,
    unassignedLabel: t('projects.unassigned', 'Unassigned'),
    unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
  });
  const onlyManagerId = filtered.length > 1 && filtered[0].project_manager_id != null && filtered.every((p) => p.project_manager_id === filtered[0].project_manager_id)
    ? filtered[0].project_manager_id : null;
  const sharedManager = !pmIsViewer && onlyManagerId != null ? pmOf(filtered[0]) : null;
  const tableColumns = pmIsViewer || sharedManager ? visibleColumns.filter((column) => column.key !== 'pm') : visibleColumns;

  // Phone cards: name; client · reference; status and progress; money. No repeated field labels.
  const cellOf = (key: string, p: ProjectWithRefs) => visibleColumns.find((column) => column.key === key)?.cell(p);
  const mobileCardTitle = (p: ProjectWithRefs) => {
    const ids = [p.pmo_project_number, p.code].filter(Boolean).join(' · ');
    return (
      <div className="min-w-0">
        {cellOf('project', p)}
        {(p.client || ids || p.end_client) && (
          <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 break-words text-sm font-normal text-muted-foreground" onClick={(event) => event.stopPropagation()}>
            {p.client && <CompanyNameLink companyId={p.client_id} name={companyDisplayName(p.client)} className="inline" />}
            {ids && <span className="whitespace-nowrap font-mono" title={ids}>{ids}</span>}
            {p.end_client && <span>{companyDisplayName(p.end_client)}</span>}
          </div>
        )}
      </div>
    );
  };
  const mobileCardDetails = (p: ProjectWithRefs) => {
    const progress = visibleColumns.some((column) => column.key === 'progress') && deliverySummary?.[p.id]?.deliveryPct != null ? cellOf('progress', p) : null;
    const actual = visibleColumns.some((column) => column.key === 'actual') ? actualPosition(p).text : null;
    const budgetUsed = visibleColumns.some((column) => column.key === 'budget-used') ? cellOf('budget-used', p) : null;
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {!pmIsViewer && !sharedManager && (
          <div>{t('projects.columns.pm', 'PM')}: {pmOf(p)}</div>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          {cellOf('status', p)}
          {progress && <span className="min-w-[7rem] max-w-[10rem] flex-1">{progress}</span>}
        </div>
        {canViewMoney && (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="tabular tabular-nums">{formatCurrency(p.contract_value, p.currency)}</span>
            {!sharedBasis && <TaxBasisLabel treatment={p.tax_treatment} showDetails={false} className="leading-tight" />}
            {actual && <span className="tabular tabular-nums text-muted-foreground">{t('projects:card.actualInline', '{{amount}} actual', { amount: actual })}</span>}
            {budgetUsed && <span className="min-w-[7rem] max-w-[10rem] flex-1">{budgetUsed}</span>}
          </div>
        )}
      </div>
    );
  };
  return { visibleColumns, tableColumns, exportColumns, actualHiddenReason, sharedBasis, sharedManager, mobileCardTitle, mobileCardDetails };

}
