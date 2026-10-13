import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ListState, Button } from '@/src/components/ui';
import { useRecordHistory } from '@/src/hooks/useRecordHistory';
import type { HistoryEvent, FieldChange, HistoryNameKind } from '@/src/lib/repositories/recordHistory';
import {
  formatCurrency, formatDateOnly, formatDateTime, formatMonthYear, formatNumber, formatRelativeTime,
} from '@/src/lib/format';
import { fieldLabels, filterLabels, filteredEmptyLabels, kindLabels, projectCodeLabel, auditActionLabel } from './historyLabels';
import {
  KIND_FILTERS, RECORD_NAME_SOURCE, REF_SOURCE, fieldKind, humanizeColumn,
} from './historyFields';
import { useHistoryRefs, type RefMaps } from './useHistoryRefs';
import { useHistoryEnumLabel } from './useHistoryEnumLabel';

/**
 * Capture started with migration 0260, deployed in October 2026. The empty state names the month, not
 * a day: each environment starts on its own deploy day, so a hard-coded day would be wrong somewhere.
 */
const HISTORY_BEGINS = new Date(2026, 9, 1);

export interface RecordHistoryProps {
  entityType: string;
  entityId: string;
  /** Roll up child-record events (project only: children are filed under the project). */
  includeChildren?: boolean;
  /** Show the All / Project / Budget / … kind chips (project History, FR-CHG-012). */
  kindFilters?: boolean;
  /** Lazy mount (collapsed sections): no fetch until true. */
  enabled?: boolean;
}

type EnumLabel = ReturnType<typeof useHistoryEnumLabel>;

/** Instant → "Oct 6, 2026, 09:41 AM" in the viewer's locale and timezone; never a raw string. */
function formatInstant(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : formatDateTime(d);
}

function fieldLabel(t: TFunction, labels: Record<string, string>, entityType: string, column: string): string {
  if (column === 'code' && entityType === 'project') return projectCodeLabel(t);
  return labels[column] ?? humanizeColumn(column);
}

function formatValue(
  t: TFunction, enumLabel: EnumLabel, ev: HistoryEvent, column: string, value: unknown, refs: RefMaps,
): string {
  if (value === null || value === undefined || value === '') return t('history.emptyValue', 'empty');
  switch (fieldKind(ev.entityType, column)) {
    case 'money': {
      const n = Number(value);
      return Number.isFinite(n) && ev.currency ? formatCurrency(n, ev.currency) : String(value);
    }
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? formatNumber(n) : String(value);
    }
    case 'date':
      return formatDateOnly(String(value));
    case 'timestamp':
      return formatInstant(String(value));
    case 'bool':
      return value === true ? t('history.yes', 'Yes') : t('history.no', 'No');
    case 'ref': {
      const source = REF_SOURCE[column];
      return (source && refs[source].get(String(value))) || t('history.unavailable', 'Unavailable');
    }
    default:
      return enumLabel(ev.entityType, column, String(value));
  }
}

function describeChange(
  t: TFunction, enumLabel: EnumLabel, labels: Record<string, string>, ev: HistoryEvent, column: string,
  change: FieldChange, refs: RefMaps,
): React.ReactNode {
  const label = fieldLabel(t, labels, ev.entityType, column);
  // Flagged columns carry no values by contract; a ref with no name source would read "Unavailable → Unavailable".
  const unnamedRef = fieldKind(ev.entityType, column) === 'ref' && !REF_SOURCE[column];
  if (change.changed || unnamedRef) return t('history.fieldChanged', '{{field}} changed', { field: label });
  if (column === 'archived_at') {
    return change.new ? t('history.archived', 'Archived') : t('history.restored', 'Restored');
  }
  return (
    <>
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-muted-foreground">: </span>
      <span>{`${formatValue(t, enumLabel, ev, column, change.old, refs)} → ${formatValue(t, enumLabel, ev, column, change.new, refs)}`}</span>
    </>
  );
}

/** "Task · Install pump" — which child record a project-History event belongs to; a procurement links to its page. */
const RecordName: React.FC<{ ev: HistoryEvent; refs: RefMaps; kinds: Record<string, string> }> = ({ ev, refs, kinds }) => {
  const { t } = useTranslation();
  const source = RECORD_NAME_SOURCE[ev.entityType];
  const name = source ? refs[source].get(ev.entityId) : undefined;
  const kind = kinds[ev.entityType] ?? humanizeColumn(ev.entityType);
  return (
    <span className="min-w-0 break-words text-xs text-muted-foreground">
      {kind} ·{' '}
      {name && ev.entityType === 'procurement' ? (
        <Link to={`/procurement/${ev.entityId}`} className="text-foreground underline-offset-2 hover:underline">
          {name}
        </Link>
      ) : (
        name || t('history.unavailable', 'Unavailable')
      )}
    </span>
  );
};

const EventRow: React.FC<{ ev: HistoryEvent; refs: RefMaps; showRecord: boolean; enumLabel: EnumLabel }> = ({
  ev, refs, showRecord, enumLabel,
}) => {
  const { t } = useTranslation();
  const actor =
    ev.actorId === null
      ? t('history.system', 'System')
      : refs.profiles.get(ev.actorId) || t('history.unknownUser', 'Unknown user');
  const entries = Object.entries(ev.changes);
  const labels = useMemo(() => fieldLabels(t), [t]);
  const kinds = useMemo(() => kindLabels(t), [t]);
  const absolute = formatInstant(ev.createdAt);
  return (
    <li data-testid="history-event" className="border-b border-border py-3 last:border-b-0 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold text-foreground break-words">{actor}</span>
        <time dateTime={ev.createdAt} title={absolute} className="text-xs text-muted-foreground">
          {formatRelativeTime(ev.createdAt)} · {absolute}
        </time>
        {showRecord && <RecordName ev={ev} refs={refs} kinds={kinds} />}
      </div>
      <ul className="mt-1 space-y-0.5 text-sm text-foreground">
        {/* #880: a merged audit line reads as a translated "did X" label (humanised when the code is
            unknown) — never the internal action code. */}
        {ev.source === 'audit' && <li className="break-words">{auditActionLabel(t, ev.action)}</li>}
        {ev.op === 'insert' && <li>{t('history.created', 'Created')}</li>}
        {entries.map(([column, change]) => (
          <li key={column} className="break-words">{describeChange(t, enumLabel, labels, ev, column, change, refs)}</li>
        ))}
      </ul>
    </li>
  );
};

/** Company ids referenced by the loaded events, so archived ones can be named by id. */
function companyIdsOf(events: HistoryEvent[]): string[] {
  const ids = new Set<string>();
  for (const ev of events) {
    for (const [column, change] of Object.entries(ev.changes)) {
      if (REF_SOURCE[column] !== 'companies') continue;
      for (const v of [change.old, change.new]) if (typeof v === 'string' && v) ids.add(v);
    }
  }
  return [...ids].sort();
}

/**
 * Read-only change history of one record (spec D5 / FR-CHG-010..012): newest first, one group per save
 * (`Actor · time`, then `Label: old → new` per field), 50 per page with "Load older". Visibility is the
 * record's own RLS (the RPC); the FE filters nothing on its behalf and sends no org_id.
 */
export const RecordHistory: React.FC<RecordHistoryProps> = ({
  entityType, entityId, includeChildren = false, kindFilters = false, enabled = true,
}) => {
  const { t } = useTranslation();
  const [kind, setKind] = useState('all');
  const entityTypes = KIND_FILTERS.find((k) => k.key === kind)?.types ?? null;
  const q = useRecordHistory({ entityType, entityId, includeChildren, entityTypes, enabled });
  const filters = useMemo(() => filterLabels(t), [t]);
  const events = useMemo(() => q.data?.pages.flatMap((p) => p.events) ?? [], [q.data]);
  const companyIdsKey = companyIdsOf(events).join(',');
  const companyIds = useMemo(() => (companyIdsKey ? companyIdsKey.split(',') : []), [companyIdsKey]);
  const recordIdsByType = useMemo(() => {
    const ids: Partial<Record<HistoryNameKind, string[]>> = {};
    for (const event of events) {
      if (['purchase_request', 'rfq', 'purchase_order', 'payment', 'sales_invoice', 'procurement_invoice', 'vendor_withholding_slip_bill'].includes(event.entityType)) {
        const kind = event.entityType as HistoryNameKind;
        (ids[kind] ??= []).push(event.entityId);
      }
    }
    return ids;
  }, [events]);
  const refs = useHistoryRefs({ entityType, entityId, enabled, companyIds, recordIdsByType });
  const enumLabel = useHistoryEnumLabel();
  const loadingOlder = q.isFetchingNextPage;

  return (
    <div className="min-w-0" data-testid="record-history">
      {kindFilters && (
        <div role="group" aria-label={t('history.filterLabel', 'Filter by record kind')} className="mb-3 flex flex-wrap gap-1.5">
          {KIND_FILTERS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kind === k.key}
              onClick={() => setKind(k.key)}
              className={
                'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors ' +
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
                (kind === k.key
                  ? 'border-primary/30 bg-primary/10 text-nav-active-text'
                  : 'border-input bg-background text-muted-foreground hover:text-foreground')
              }
            >
              {filters[k.key] ?? k.label}
            </button>
          ))}
        </div>
      )}
      {q.isPending ? (
        <ListState variant="loading" rows={4} />
      ) : q.isError ? (
        <ListState
          variant="error"
          title={t('history.error', "Couldn't load history")}
          onRetry={() => void q.refetch()}
          retryLabel={t('history.retry', 'Retry')}
        />
      ) : events.length === 0 && kind !== 'all' ? (
        <ListState variant="empty" icon="clock" title={filteredEmptyLabels(t)[kind]} />
      ) : events.length === 0 ? (
        <ListState
          variant="empty"
          icon="clock"
          title={t('history.empty.title', 'No changes recorded yet')}
          sub={t(
            'history.empty.sub',
            'History begins {{date}}. Edits made before then and deletions are not shown.',
            { date: formatMonthYear(HISTORY_BEGINS) },
          )}
        />
      ) : (
        <>
          <ul>
            {events.map((ev) => (
              <EventRow
                key={`${ev.source}-${ev.id}`}
                ev={ev}
                refs={refs}
                enumLabel={enumLabel}
                showRecord={includeChildren && ev.entityType !== entityType}
              />
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-3">
              {/* aria-disabled, not disabled: a disabled button drops keyboard focus mid-fetch. */}
              <Button
                variant="outline"
                aria-disabled={loadingOlder || undefined}
                aria-busy={loadingOlder || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                onClick={() => {
                  if (!loadingOlder) void q.fetchNextPage();
                }}
              >
                {t('history.loadOlder', 'Load older')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RecordHistory;
