import type {
  RosterWorker, SafetyChecklistAnswer, SafetyDay, SafetyDayDetail, SafetyDetailKind, SafetyDetailRow, SafetyFitnessCheck,
  SafetyListItem, SafetyListKind, SafetyWorkOrderDay,
} from '@/src/lib/db/safetyDays';
import type { SafetySummary } from '@/src/lib/safetyDay';

/** #2596 daily safety records seam (ADR-0017). org_id never leaves the server; the database refuses what the UI hides. */
export interface SafetyDayRepository {
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  listItems(kind: SafetyListKind, includeArchived?: boolean): Promise<SafetyListItem[]>;
  addItem(kind: SafetyListKind, label: string): Promise<void>;
  renameItem(id: string, label: string): Promise<void>;
  setItemArchived(id: string, archived: boolean): Promise<void>;
  workOrderDays(workOrderId: string, from: string, to: string): Promise<SafetyWorkOrderDay[]>;
  createDay(workOrderId: string, workDate: string): Promise<string>;
  getDay(id: string): Promise<SafetyDayDetail | null>;
  rosterWorkers(workOrderId: string, workDate: string): Promise<RosterWorker[]>;
  saveFitness(dayId: string, row: { workerId?: string | null; visitorName?: string | null; checkTypeId?: string | null; result: SafetyFitnessCheck['result']; note?: string | null }): Promise<void>;
  updateFitness(id: string, patch: { result: SafetyFitnessCheck['result']; note?: string | null }): Promise<void>;
  deleteFitness(id: string): Promise<void>;
  answerChecklist(id: string, answer: SafetyChecklistAnswer['answer'], note: string | null): Promise<void>;
  saveTalk(dayId: string, v: { topic: string; presenter: string; heldAt: string; attendees: { workerId?: string; visitorName?: string }[] }): Promise<string>;
  deleteTalk(id: string): Promise<void>;
  savePermit(dayId: string, v: { permitNumber: string; typeId?: string | null; validFrom: string; validTo: string; issuedBy?: string | null }): Promise<void>;
  setPermitState(id: string, state: 'open' | 'closed'): Promise<void>;
  deletePermit(id: string): Promise<void>;
  addOfficerEntry(dayId: string, v: { body: string; nearMisses: number; observations: number; incidentId?: string | null }): Promise<void>;
  submitDay(id: string): Promise<void>;
  correctDay(id: string, reason: string): Promise<string>;
  uploadTalkPhoto(day: Pick<SafetyDay, 'id' | 'org_id'>, talkId: string, file: File): Promise<void>;
  deletePhoto(id: string): Promise<void>;
  photoUrl(path: string): Promise<string>;
  getSummary(projectId: string | null, month: string | null): Promise<SafetySummary>;
  getSummaryDetail(kind: SafetyDetailKind, projectId: string | null, month: string | null): Promise<SafetyDetailRow[]>;
}
