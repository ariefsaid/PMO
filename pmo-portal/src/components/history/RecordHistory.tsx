import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery } from '@tanstack/react-query';
import { ListState, Button } from '@/src/components/ui';
import { useRecordHistory } from '@/src/hooks/useRecordHistory';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { HistoryEvent, FieldChange } from '@/src/lib/repositories/recordHistory';
import {
  formatCurrency, formatDate, formatDateOnly, formatNumber, formatRelativeTime,
} from '@/src/lib/format';
import { fieldLabels, filterLabels, kindLabels } from './historyLabels';
import {
  COMPANY_REFS, KIND_FILTERS, PROFILE_REFS, fieldKind, humanizeColumn,
} from './historyFields';

/** The migration that started capture (0260); the empty state says history begins here. */
export const HISTORY_BEGINS = '2026-10-06';

export interface RecordHistoryProps {
  entityType: string;
  entityId: string;
  /** Roll up child-record events (project, procurement). */
  includeChildren?: boolean;
  /** Show the All / Project / Budget / … kind chips (project History, FR-CHG-012). */
  kindFilters?: boolean;
  /** Lazy mount (collapsed sections): no fetch until true. */
  enabled?: boolean;
}

interface RefMaps {
  profiles: Map<string, string>;
  companies: Map<string, string>;
}

/** Org people + companies, from the same cached lists the pickers use; a ref not in them reads "Unavailable". */
function useRefMaps(enabled: boolean): RefMaps {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const profiles = useQuery({
    queryKey: ['org-profiles', orgId],
    queryFn: () => repositories.profile.listOrgProfiles(),
    enabled: Boolean(orgId) && enabled,
    staleTime: 5 * 60_000,
  });
  const companies = useQuery({
    queryKey: ['history-companies', orgId],
    queryFn: () => repositories.company.list(),
    enabled: Boolean(orgId) && enabled,
    staleTime: 5 * 60_000,
  });
  return useMemo(
    () => ({
      profiles: new Map((profiles.data ?? []).map((p) => [p.id, p.full_name ?? ''])),
      companies: new Map((companies.data ?? []).map((c) => [c.id, c.name])),
    }),
    [profiles.data, companies.data],
  );
}

function fieldLabel(labels: Record<string, string>, column: string): string {
  return labels[column] ?? humanizeColumn(column);
}

function formatValue(
  t: TFunction, ev: HistoryEvent, column: string, value: unknown, refs: RefMaps,
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
      return formatDate(String(value));
    case 'bool':
      return value === true ? t('history.yes', 'Yes') : t('history.no', 'No');
    case 'ref': {
      const id = String(value);
      const name = PROFILE_REFS.has(column) ? refs.profiles.get(id) : COMPANY_REFS.has(column) ? refs.companies.get(id) : undefined;
      return name || t('history.unavailable', 'Unavailable');
    }
    default:
      return String(value);
  }
}

function describeChange(
  t: TFunction, labels: Record<string, string>, ev: HistoryEvent, column: string, change: FieldChange, refs: RefMaps,
): React.ReactNode {
  const label = fieldLabel(labels, column);
  if (change.changed) return t('history.fieldChanged', '{{field}} changed', { field: label });
  if (column === 'archived_at') {
    return change.new ? t('history.archived', 'Archived') : t('history.restored', 'Restored');
  }
  return (
    <>
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-muted-foreground">: </span>
      <span>{`${formatValue(t, ev, column, change.old, refs)} → ${formatValue(t, ev, column, change.new, refs)}`}</span>
    </>
  );
}

const EventRow: React.FC<{ ev: HistoryEvent; refs: RefMaps; showKind: boolean }> = ({ ev, refs, showKind }) => {
  const { t } = useTranslation();
  const actor =
    ev.actorId === null
      ? t('history.system', 'System')
      : refs.profiles.get(ev.actorId) || t('history.unknownUser', 'Unknown user');
  const entries = Object.entries(ev.changes);
  const labels = useMemo(() => fieldLabels(t), [t]);
  const kinds = useMemo(() => kindLabels(t), [t]);
  return (
    <li data-testid="history-event" className="border-b border-border py-3 last:border-b-0 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold text-foreground break-words">{actor}</span>
        <time dateTime={ev.createdAt} title={formatDate(ev.createdAt)} className="text-xs text-muted-foreground">
          {formatRelativeTime(ev.createdAt)} · {formatDate(ev.createdAt)}
        </time>
        {showKind && ev.entityType && (
          <span className="text-xs text-muted-foreground">
            {kinds[ev.entityType] ?? humanizeColumn(ev.entityType)}
          </span>
        )}
      </div>
      <ul className="mt-1 space-y-0.5 text-sm text-foreground">
        {ev.source === 'audit' && <li className="break-words">{ev.action}</li>}
        {ev.op === 'insert' && <li>{t('history.created', 'Created')}</li>}
        {entries.map(([column, change]) => (
          <li key={column} className="break-words">{describeChange(t, labels, ev, column, change, refs)}</li>
        ))}
      </ul>
    </li>
  );
};

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
  const refs = useRefMaps(enabled);
  const filters = useMemo(() => filterLabels(t), [t]);
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <div className="min-w-0" data-testid="record-history">
      {kindFilters && (
        <div role="group" aria-label={t('history.filterLabel', 'Filter by record kind')} className="mb-3 flex flex-wrap gap-2">
          {KIND_FILTERS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kind === k.key}
              onClick={() => setKind(k.key)}
              className={
                'h-8 rounded-full border px-3 text-sm ' +
                (kind === k.key
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground')
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
      ) : events.length === 0 ? (
        <ListState
          variant="empty"
          icon="clock"
          title={t('history.empty.title', 'No changes recorded yet')}
          sub={t(
            'history.empty.sub',
            'History begins {{date}}. Edits made before then and deletions are not shown.',
            { date: formatDateOnly(HISTORY_BEGINS) },
          )}
        />
      ) : (
        <>
          <ul>
            {events.map((ev) => (
              <EventRow key={`${ev.source}-${ev.id}`} ev={ev} refs={refs} showKind={includeChildren && ev.entityType !== entityType} />
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-3">
              <Button variant="outline" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
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
