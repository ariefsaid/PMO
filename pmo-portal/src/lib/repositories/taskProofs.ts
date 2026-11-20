/** Task proof repository (ADR-0017 seam) over the task-proofs DAL. */
import {
  listTaskProofs,
  addTaskProof,
  removeTaskProof,
  getTaskProofUrl,
  type TaskProofRow,
} from '@/src/lib/db/taskProofs';
import { wrap } from './repositoryErrors';

export interface TaskProofRepository {
  list(taskId: string): Promise<TaskProofRow[]>;
  add(taskId: string, file: File, liveCount: number): Promise<TaskProofRow>;
  remove(proofId: string): Promise<void>;
  url(path: string): Promise<string>;
}

export const taskProofRepository: TaskProofRepository = {
  list: (taskId) => wrap(() => listTaskProofs(taskId)),
  add: (taskId, file, liveCount) => wrap(() => addTaskProof(taskId, file, liveCount)),
  remove: (proofId) => wrap(() => removeTaskProof(proofId)),
  url: (path) => wrap(() => getTaskProofUrl(path)),
};
