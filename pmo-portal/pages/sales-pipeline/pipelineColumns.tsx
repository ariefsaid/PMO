import React from 'react';
import type { TFunction } from 'i18next';
import {
  Badge,
  StatusPill,
  ProgressBar,
  type Column,
  TaxBasisLabel,
} from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import {
  pillVariantForStatus,
  weightedValue,
  daysSince,
  isStaleBid,
  ATTENTION_THRESHOLD_DAYS,
} from '../../components/salesPipeline';

export interface BuildPipelineColumnsOptions {
  t: TFunction | ((key: string, fallback?: string, options?: Record<string, unknown>) => string);
  stageName: (status: PipelineProject['status']) => string;
}

export interface PipelineColumnsResult {
  tableColumns: Column<PipelineProject>[];
  exportColumns: Column<PipelineProject>[];
}

/**
 * Builds table and export columns for sales pipeline (THEME-CROSS-76).
 * Maintains per-row currencies and inserts the export-only Currency column
 * immediately after Value per AC-L10N-052.
 */
export function buildPipelineColumns({
  t,
  stageName,
}: BuildPipelineColumnsOptions): PipelineColumnsResult {
  const identifiers = (r: PipelineProject) =>
    [r.pmo_project_number, r.code].filter((v): v is string => Boolean(v));

  const identifierLabels = (r: PipelineProject) =>
    [
      r.pmo_project_number && `${t('projects.identifiers.pmo', 'PMO Project Number')}: ${r.pmo_project_number}`,
      r.code && `${t('projects.identifiers.client', 'Client Project Code')}: ${r.code}`,
    ]
      .filter(Boolean)
      .join(' · ');

  const tableColumns: Column<PipelineProject>[] = [
    {
      key: 'opp',
      header: t('sales.column.project', 'Project'),
      kind: 'primary',
      size: 280,
      cell: (r) => <span title={r.name}>{projectDisplayName(r)}</span>,
      primaryTitle: (r) => r.name,
      secondaryCell: (r) =>
        identifiers(r).length > 0 ? (
          <span className="font-mono" title={identifierLabels(r)}>
            {identifiers(r).join(' · ')}
          </span>
        ) : undefined,
      exportValue: (r) => r.name,
    },
    {
      key: 'customer',
      header: t('sales.column.customer', 'Customer'),
      kind: 'text',
      size: 160,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate" title={r.client_name ?? undefined}>
            {r.client_name ?? '—'}
          </span>
          {r.end_client_name && (
            <span className="block truncate text-[12px] text-muted-foreground" title={r.end_client_name}>
              {t('sales:pipeline.endCustomerLine', 'for {{name}}', { name: r.end_client_name })}
            </span>
          )}
        </span>
      ),
      exportValue: (r) => r.client_name ?? '',
    },
    {
      key: 'stage',
      header: t('sales.column.stage', 'Stage'),
      kind: 'status',
      size: 132,
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <StatusPill variant={pillVariantForStatus(r.status)}>{stageName(r.status)}</StatusPill>
          {isStaleBid(r) && (
            <Badge role="status" data-testid={`stale-bid-${r.id}`}>
              {t('sales:pipeline.staleBid', 'Stale bid · stage unchanged for 90+ days')}
            </Badge>
          )}
        </span>
      ),
      exportValue: (r) => r.status,
    },
    {
      key: 'value',
      header: t('sales.column.value', 'Value'),
      kind: 'money',
      size: 184,
      align: 'num',
      cell: (r) => (
        <span className="inline-flex items-baseline gap-1.5">
          {formatCurrency(r.contract_value, r.currency)}
          <TaxBasisLabel
            treatment={r.tax_treatment}
            taxRate={r.tax_rate}
            taxBaseNumerator={r.tax_base_numerator}
            taxBaseDenominator={r.tax_base_denominator}
            showDetails={false}
          />
        </span>
      ),
      exportValue: (r) => r.contract_value,
    },
    {
      key: 'weighted',
      header: t('sales.column.weighted', 'Weighted'),
      kind: 'money',
      size: 152,
      align: 'num',
      cell: (r) => (
        <span className="text-muted-foreground">{formatCurrency(weightedValue(r), r.currency)}</span>
      ),
      exportValue: (r) => weightedValue(r),
    },
    {
      key: 'win',
      header: t('sales.column.winPct', 'Win %'),
      kind: 'percent',
      size: 96,
      align: 'num',
      cell: (r) => {
        const pct = Math.round(r.win_probability * 100);
        return (
          <ProgressBar
            value={pct}
            tone="primary"
            showValue
            aria-label={`${t('sales.winProbability', 'Win probability')} ${pct}%`}
            className="ml-auto"
          />
        );
      },
      exportValue: (r) => Math.round(r.win_probability * 100),
    },
    {
      key: 'owner',
      header: t('sales.column.owner', 'Owner'),
      kind: 'meta',
      size: 128,
      cell: (r) => {
        if (!r.pm_name) {
          return (
            <span className="text-muted-foreground" aria-label={t('sales.ownerUnavailable', 'Owner not available')}>
              —
            </span>
          );
        }
        return (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-muted-foreground"
            >
              {r.pm_name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="whitespace-normal leading-tight">{r.pm_name}</span>
          </span>
        );
      },
      exportValue: (r) => r.pm_name ?? '',
    },
    {
      key: 'last_touch',
      header: t('sales.column.lastTouch', 'Last touch'),
      size: 104,
      align: 'num',
      cell: (r) => {
        const days = daysSince(r.last_update);
        if (days === null) {
          return (
            <span
              className="text-muted-foreground"
              aria-label={t('sales.lastTouchUnavailable', 'Last touch not available')}
            >
              —
            </span>
          );
        }
        const stale = days >= ATTENTION_THRESHOLD_DAYS;
        const label =
          days === 0
            ? t('sales.lastTouch.today', 'today')
            : days === 1
              ? t('sales.lastTouch.oneDayAgo', '1 day ago')
              : `${days} ${t('sales.lastTouch.daysAgo', 'days ago')}`;
        return (
          <span
            className={`tabular text-[12.5px] ${stale ? 'font-semibold text-warning-foreground' : 'text-muted-foreground'}`}
            title={
              stale
                ? t('sales.lastTouch.stale', 'Untouched for {{days}} days: needs attention', {
                    days: String(days),
                  })
                : undefined
            }
          >
            {label}
          </span>
        );
      },
      exportValue: (r) => {
        const days = daysSince(r.last_update);
        if (days === null) return '';
        return days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
      },
    },
  ];

  const exportColumns: Column<PipelineProject>[] = [];
  for (const col of tableColumns) {
    exportColumns.push(col);
    if (col.key === 'customer') {
      exportColumns.push({
        key: 'end-customer',
        // #758 — the end customer is a second line on screen but stays its own column in the download.
        header: t('sales.column.endCustomer', 'End customer'),
        cell: (r) => r.end_client_name ?? '—',
        exportValue: (r) => r.end_client_name ?? '',
      });
    }
    if (col.key === 'value') {
      exportColumns.push({
        key: 'currency',
        header: 'Currency',
        cell: (r) => r.currency,
        exportValue: (r) => r.currency,
      });
    }
  }

  return { tableColumns, exportColumns };
}
