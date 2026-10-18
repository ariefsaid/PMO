import type { HistoryEvent } from '@/src/lib/repositories/recordHistory';
import type { TFunction } from 'i18next';
import { humanizeColumn } from './historyFields';
import { auditActionLabel, kindLabels } from './historyLabels';

export interface HistoryEventGroup {
  key: string;
  events: HistoryEvent[];
}

const isSystemInsert = (event: HistoryEvent): boolean => event.actorId === null && event.op === 'insert';

/** Group only adjacent system inserts whose event payloads prove the same kind and instant. */
export function groupHistoryEvents(events: readonly HistoryEvent[]): HistoryEventGroup[] {
  const groups: HistoryEventGroup[] = [];

  for (const event of events) {
    const previous = groups.at(-1);
    const firstInPrevious = previous?.events[0];
    const lastInPrevious = previous?.events.at(-1);
    const canAppend = isSystemInsert(event)
      && firstInPrevious !== undefined
      && lastInPrevious !== undefined
      && isSystemInsert(lastInPrevious)
      && firstInPrevious.entityType === event.entityType
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
