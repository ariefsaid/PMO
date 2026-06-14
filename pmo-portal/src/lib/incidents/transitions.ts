import type { IncidentStatus } from '@/src/lib/db/incidents';

/** A status the workflow can transition TO (Open is only an initial state). */
export type AdvanceStatus = 'Investigating' | 'Closed';

/** The next workflow step for a status (Closed is terminal → null). */
export const NEXT_STATUS: Record<IncidentStatus, AdvanceStatus | null> = {
  Open: 'Investigating',
  Investigating: 'Closed',
  Closed: null,
};

/** Human verb-object label + confirm copy for a status transition. */
export const TRANSITION_COPY: Record<
  AdvanceStatus,
  { menu: string; confirm: string; title: (t: string) => string; body: string }
> = {
  Investigating: {
    menu: 'Start investigating',
    confirm: 'Start investigating',
    title: (t) => `Start investigating ${t}?`,
    body: 'This moves the incident to Investigating so the team can record findings. You can close it once the investigation is complete.',
  },
  Closed: {
    menu: 'Close incident',
    confirm: 'Close incident',
    title: (t) => `Close ${t}?`,
    body: 'This marks the incident Closed. Closed is the final state; reopen by filing a follow-up if new information emerges.',
  },
};
