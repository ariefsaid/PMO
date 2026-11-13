import React, { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ListState, Button } from '@/src/components/ui';
import { useRecordHistory } from '@/src/hooks/useRecordHistory';
import type { HistoryEvent, FieldChange, HistoryNameKind } from '@/src/lib/repositories/types';
import { formatCurrency, formatDay, formatDateTime, formatMonthYear, formatNumber, formatRelativeTime } from '@/src/lib/format';
import { fieldLabels, filterLabels, filteredEmptyLabels, kindLabels, projectCodeLabel } from './historyLabels';
import {
  KIND_FILTERS, RECORD_NAME_SOURCE, REF_SOURCE, fieldKind, humanizeColumn,
} from './historyFields';
import { groupHistoryEvents, historyEventSummary } from './historyPresentation';
import { useHistoryRefs, type RefMaps } from './useHistoryRefs';
import { useHistoryEnumLabel } from './useHistoryEnumLabel';

/**
 * Capture started with migration 0260, deployed in October 2026. The empty state names the month, not
 * a day: each environment starts on its own deploy day, so a hard-coded day would be wrong somewhere.
 */
const HISTORY_BEGINS = new Date(2026, 9, 1);

interface RecordHistoryProps {
  entityType: string;
  entityId: string;
  /** Roll up child-record events (project only: children are filed under the project). */
  includeChildren?: boolean;
  /** Show the All / Project / Budget / … kind chips (project History, FR-CHG-012). */
  kindFilters?: boolean;
  /**
   * Controlled kind filter. The project Activity drawer owns ONE filter row whose chips include the
   * comment view, so it names the kind here and this component draws no chips of its own. Omit it and
   * the chips below stay the filter, exactly as before.
   */
  kind?: string;
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
      return formatDay(String(value));
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
    <span className="min-w-0 break-words text-sm text-muted-foreground">
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const detailsRef = useRef<HTMLUListElement>(null);
  const actor =
    ev.actorId === null
      ? t('history.system', 'System')
      : refs.profiles.get(ev.actorId) || t('history.unknownUser', 'Unknown user');
  const entries = Object.entries(ev.changes);
  const hasDetails = ev.op === 'insert' || entries.length > 0;
  const labels = useMemo(() => fieldLabels(t), [t]);
  const kinds = useMemo(() => kindLabels(t), [t]);
  const absolute = formatInstant(ev.createdAt);
  const summary = historyEventSummary(t, ev);
  const toggle = () => setDetailsOpen((open) => !open);
  // The entry row is its own target: a pointer anywhere on it opens the evidence, except on a nested
  // control (the procurement link, View details) or on the open evidence itself (so its text can be
  // read and selected). The title is a real button, so the row keeps a keyboard path and one
  // accessible name — View details stays the explicit control for the same region.
  const onRowClick = (event: React.MouseEvent<HTMLLIElement>) => {
    const target = event.target as Element;
    if (target.closest('button, a')) return;
    if (detailsRef.current?.contains(target)) return;
    toggle();
  };
  return (
    <li
      data-testid="history-event"
      onClick={hasDetails ? onRowClick : undefined}
      className={`border-b border-border py-3 last:border-b-0 min-w-0${hasDetails ? ' cursor-pointer' : ''}`}
    >
      {hasDetails ? (
        <button
          type="button"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={toggle}
          className="block w-full min-w-0 rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span data-testid="history-summary" className="block break-words text-sm font-semibold text-foreground">
            {summary}
          </span>
        </button>
      ) : (
        <p data-testid="history-summary" className="break-words text-sm font-semibold text-foreground">
          {summary}
        </p>
      )}
      <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
        <span className="break-words text-muted-foreground">{actor}</span>
        <time dateTime={ev.createdAt} title={absolute} className="text-sm text-muted-foreground">
          {formatRelativeTime(ev.createdAt)}
        </time>
        {showRecord && <RecordName ev={ev} refs={refs} kinds={kinds} />}
      </div>
      {hasDetails && (
        <>
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={toggle}
            className="mt-1 inline-flex h-8 items-center rounded-sm px-1 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t('uxs23.history.viewDetails', 'View details')}
          </button>
          <ul ref={detailsRef} id={detailsId} hidden={!detailsOpen} className="mt-1 space-y-0.5 break-words text-sm text-foreground">
            {ev.op === 'insert' && <li>{t('history.created', 'Created')}</li>}
            {entries.map(([column, change]) => (
              <li key={column}>{describeChange(t, enumLabel, labels, ev, column, change, refs)}</li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
};

const HistoryEventGroup: React.FC<{
  events: HistoryEvent[];
  refs: RefMaps;
  enumLabel: EnumLabel;
  entityType: string;
  includeChildren: boolean;
}> = ({ events, refs, enumLabel, entityType, includeChildren }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const eventsId = useId();

  return (
    <li data-testid="history-group" className="border-b border-border py-3 last:border-b-0 min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={eventsId}
        onClick={() => setExpanded((open) => !open)}
        className="inline-flex h-8 w-fit items-center rounded-sm text-sm font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {/* A group is one system save of one record kind: name what was created, not just "system events". */}
        {t('uxs23.history.groupSummary', '{{what}} · {{count}} records', { what: historyEventSummary(t, events[0]!), count: events.length })}
      </button>
      <ul id={eventsId} hidden={!expanded} className="mt-1 pl-3">
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
  entityType, entityId, includeChildren = false, kindFilters = false, kind: controlledKind,
}) => {
  const { t } = useTranslation();
  const [ownKind, setOwnKind] = useState('all');
  const kindKey = controlledKind ?? ownKind;
  const entityTypes = KIND_FILTERS.find((k) => k.key === kindKey)?.types ?? null;
  const q = useRecordHistory({ entityType, entityId, includeChildren, entityTypes });
  const filters = useMemo(() => filterLabels(t), [t]);
  const events = useMemo(() => q.data?.pages.flatMap((p) => p.events) ?? [], [q.data]);
  const groups = useMemo(
    () => q.data?.pages.flatMap((page) => groupHistoryEvents(page.events)) ?? [],
    [q.data],
  );
  const companyIdsKey = companyIdsOf(events).join(',');
  const companyIds = useMemo(() => (companyIdsKey ? companyIdsKey.split(',') : []), [companyIdsKey]);
  const recordIdsByType = useMemo(() => {
    const ids: Partial<Record<HistoryNameKind, string[]>> = {};
    for (const event of events) {
      if (event.entityType === 'sales_invoice') {
        const projectChange = event.changes.project_id;
        for (const id of [projectChange?.old, projectChange?.new]) {
          if (typeof id === 'string' && id) (ids.project ??= []).push(id);
        }
      }
      if (['purchase_request', 'rfq', 'purchase_order', 'payment', 'sales_invoice', 'procurement_invoice', 'vendor_withholding_slip_bill'].includes(event.entityType)) {
        const kind = event.entityType as HistoryNameKind;
        (ids[kind] ??= []).push(event.entityId);
      }
    }
    return ids;
  }, [events]);
  // SUB-G: kind chips only earn their place when the loaded events span two kinds, or a filter is on
  // (a filtered list is one kind by construction, and the chips are the way back to "All"). A caller
  // that owns the one filter row (the Activity drawer) gets no chips here.
  const kindsPresent = useMemo(() => {
    const present = new Set<string>();
    for (const event of events) {
      present.add(KIND_FILTERS.find((k) => k.types?.includes(event.entityType))?.key ?? event.entityType);
    }
    return present.size;
  }, [events]);
  const showKindChips = controlledKind === undefined && kindFilters && (kindKey !== 'all' || kindsPresent >= 2);
  const { refs, nameLookupFailed } = useHistoryRefs({ entityType, entityId, enabled: true, companyIds, recordIdsByType });
  const enumLabel = useHistoryEnumLabel();
  const loadingOlder = q.isFetchingNextPage;

  return (
    <div className="min-w-0" data-testid="record-history">
      {showKindChips && (
        <div role="group" aria-label={t('history.filterLabel', 'Filter by record kind')} className="mb-3 flex flex-wrap gap-1.5">
          {KIND_FILTERS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kindKey === k.key}
              onClick={() => setOwnKind(k.key)}
              className={
                'inline-flex h-7 items-center rounded-full border px-2.5 text-sm font-medium transition-colors ' +
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
                (kindKey === k.key
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
      ) : events.length === 0 && kindKey !== 'all' ? (
        <ListState variant="empty" icon="clock" title={filteredEmptyLabels(t)[kindKey]} />
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
          {nameLookupFailed && (
            <p role="alert" className="mb-2 text-sm text-muted-foreground">
              {t('project:history.referenceNamesError', 'Some record names could not be loaded.')}
            </p>
          )}
          <ul>
            {groups.map((group) => group.events.length > 1 ? (
              <HistoryEventGroup
                key={group.key}
                events={group.events}
                refs={refs}
                enumLabel={enumLabel}
                entityType={entityType}
                includeChildren={includeChildren}
              />
            ) : (
              <EventRow
                key={group.key}
                ev={group.events[0]}
                refs={refs}
                enumLabel={enumLabel}
                showRecord={includeChildren && group.events[0].entityType !== entityType}
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
