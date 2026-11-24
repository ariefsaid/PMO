/** Incident repository contract. */
import type { IncidentDetailRow, IncidentRow, IncidentInput, IncidentStatus, IncidentFileRow, IncidentFileKind } from '@/src/lib/db/incidents';

export interface IncidentRepository {
  /** All incidents in the org (newest first), optionally filtered by workflow status. */
  list(params?: { status?: IncidentStatus; search?: string; overdue?: boolean; projectId?: string; workOrderId?: string }): Promise<IncidentRow[]>;
  /** One server page (status filter + type/location search applied before the range) with the filtered total. */
  listPage(params: { page: number; pageSize: number; status?: IncidentStatus; search?: string; overdue?: boolean; projectId?: string }): Promise<{ rows: IncidentRow[]; total: number }>;
  /** Exact count of every readable incident (head request). */
  count(): Promise<number>;
  /** A single incident by id, or null when not found / not readable. */
  get(id: string): Promise<IncidentDetailRow | null>;
  /** File an incident — any member; org_id/status/reporter server-stamped, never sent. */
  create(input: IncidentInput): Promise<IncidentRow>;
  /** Update an incident's editable detail fields (managers only at the RLS layer). */
  update(id: string, input: IncidentInput): Promise<void>;
  /** Advance the workflow status (Open→Investigating→Closed); managers only (RLS). */
  transition(id: string, status: IncidentStatus, closeNote?: string): Promise<void>;
  /** Live attachments of an issue, oldest first. */
  listFiles(incidentId: string): Promise<IncidentFileRow[]>;
  /** Upload one photo/PDF (object, then its row). */
  uploadFile(input: { incident: Pick<IncidentRow, 'id' | 'org_id'>; kind: IncidentFileKind; file: File }): Promise<IncidentFileRow>;
  /** A short-lived signed URL for one attachment. */
  fileUrl(filePath: string): Promise<string>;
  /** Create a task from an issue (managers; one per issue). Returns the task id. */
  createTask(incidentId: string): Promise<string>;
  /** Add a further task to an issue (managers). Returns the task id. */
  addTask(incidentId: string, input: { name: string; assigneeId?: string | null; dueDate?: string | null }): Promise<string>;
  /** The database gate itself (actor_may_task_issue, 2041): whether the signed-in person may add a task to an issue on this work order. */
  mayTaskOnWorkOrder(workOrderId: string): Promise<boolean>;
  /** Record the root cause (manager or the person in charge). */
  setRootCause(id: string, rootCause: string): Promise<void>;
  /** Hard-delete an incident (Admin only). */
  delete(id: string): Promise<void>;
}
