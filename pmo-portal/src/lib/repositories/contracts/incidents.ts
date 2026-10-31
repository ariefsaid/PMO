/** Incident repository contract. */
import type { IncidentRow, IncidentInput, IncidentStatus } from '@/src/lib/db/incidents';

export interface IncidentRepository {
  /** All incidents in the org (newest first), optionally filtered by workflow status. */
  list(params?: { status?: IncidentStatus }): Promise<IncidentRow[]>;
  /** A single incident by id, or null when not found / not readable. */
  get(id: string): Promise<IncidentRow | null>;
  /** File an incident — any member; org_id/status/reporter server-stamped, never sent. */
  create(input: IncidentInput): Promise<IncidentRow>;
  /** Update an incident's editable detail fields (managers only at the RLS layer). */
  update(id: string, input: IncidentInput): Promise<void>;
  /** Advance the workflow status (Open→Investigating→Closed); managers only (RLS). */
  transition(id: string, status: IncidentStatus): Promise<void>;
  /** Hard-delete an incident (Admin only). */
  delete(id: string): Promise<void>;
}
