import type { ProcurementStatus } from './db/procurementLifecycle';

export type ProcurementProjectStage = 'Request' | 'Approved' | 'Ordered' | 'Received' | 'Paid';

export interface ProcurementStageDefinition {
  key: ProcurementProjectStage;
  statuses: ProcurementStatus[];
}

export const PROJECT_PROCUREMENT_STAGES: ProcurementStageDefinition[] = [
  { key: 'Request', statuses: ['Draft', 'Requested'] },
  { key: 'Approved', statuses: ['Approved', 'Vendor Quoted', 'Quote Selected'] },
  { key: 'Ordered', statuses: ['Ordered'] },
  { key: 'Received', statuses: ['Received', 'Vendor Invoiced'] },
  { key: 'Paid', statuses: ['Paid'] },
];

export interface ProcurementStageEvent {
  to_status: ProcurementStatus;
  created_at: string;
}

export interface ProcurementTimelineStep {
  key: ProcurementProjectStage;
  date: string | null;
}

/** Compact the procurement status history into the five milestones used on project detail. */
export function projectProcurementStage(status: ProcurementStatus): ProcurementProjectStage | null {
  return PROJECT_PROCUREMENT_STAGES.find((stage) => stage.statuses.includes(status))?.key ?? null;
}

/**
 * Return milestone dates from the append-only status log. The request date comes from the
 * procurement record's created_at because legacy requests predate the transition log.
 */
export function procurementTimeline(
  events: ProcurementStageEvent[] | null | undefined,
  createdAt: string,
): ProcurementTimelineStep[] {
  const orderedEvents = [...(events ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return PROJECT_PROCUREMENT_STAGES.map(({ key }) => {
    if (key === 'Request') {
      const requested = orderedEvents.filter((event) => event.to_status === 'Requested').at(-1);
      return { key, date: requested?.created_at ?? createdAt };
    }

    const milestoneStatus: Partial<Record<ProcurementProjectStage, ProcurementStatus>> = {
      Approved: 'Approved',
      Ordered: 'Ordered',
      Received: 'Received',
      Paid: 'Paid',
    };
    const status = milestoneStatus[key];
    const recordedEvent = status
      ? orderedEvents.filter((event) => event.to_status === status).at(-1)
      : undefined;
    return { key, date: recordedEvent?.created_at ?? null };
  });
}
