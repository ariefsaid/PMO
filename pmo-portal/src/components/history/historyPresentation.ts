import type { HistoryEvent } from '@/src/lib/repositories/types';
import type { TFunction } from 'i18next';
import { humanizeColumn } from './historyFields';
import { auditActionLabel, kindLabels } from './historyLabels';

export interface HistoryEventGroup {
  key: string;
  events: HistoryEvent[];
}

const isSystemEvent = (event: HistoryEvent): boolean =>
  event.actorId === null && (event.op === 'insert' || event.op === 'update');

/**
 * Group only adjacent system events whose payloads prove the same kind, op and instant.
 *
 * One system save writes one row per record it touched (a project's tasks updated together, records
 * created together), all at the same instant. Folding that run into one expandable entry answers
 * "what changed recently" without a page of near-identical lines. Display only: the group carries its
 * count and every member keeps its own row, actor, time, record name and details disclosure. An audit
 * trail row (no op) is never folded: it names one action and belongs on its own line.
 */
export function groupHistoryEvents(events: readonly HistoryEvent[]): HistoryEventGroup[] {
  const groups: HistoryEventGroup[] = [];

  for (const event of events) {
    const previous = groups.at(-1);
    const firstInPrevious = previous?.events[0];
    const lastInPrevious = previous?.events.at(-1);
    const canAppend = isSystemEvent(event)
      && firstInPrevious !== undefined
      && lastInPrevious !== undefined
      && isSystemEvent(lastInPrevious)
      && firstInPrevious.entityType === event.entityType
      && firstInPrevious.op === event.op
      && firstInPrevious.createdAt === event.createdAt;

    if (canAppend && previous) {
      previous.events.push(event);
    } else {
      groups.push({ key: `${event.source}-${event.id}`, events: [event] });
    }
  }

  return groups;
}

/** A localized business-first label; exact field evidence stays in the event disclosure. */
export function historyEventSummary(t: TFunction, event: HistoryEvent): string {
  if (event.source === 'audit') return auditActionLabel(t, event.action);

  const kind = kindLabels(t)[event.entityType] ?? humanizeColumn(event.entityType);
  if (event.op === 'insert') {
    return t('uxs23.history.summaryCreated', '{{kind}} created', { kind });
  }
  if (event.op === 'update' && Object.prototype.hasOwnProperty.call(event.changes, 'status')) {
    return t('uxs23.history.summaryStatusChanged', 'Status changed');
  }
  if (event.op === 'update') {
    return t('uxs23.history.summaryUpdated', '{{kind}} updated', { kind });
  }
  return t('uxs23.history.summaryRecorded', 'History event');
}
