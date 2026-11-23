/** #2807: pure helpers for the task form's subtask rows (SubtaskDrafts). */
import type { SubtaskDraft } from '@/src/lib/db/tasks';

let seq = 0;
export const newDraft = (): SubtaskDraft => ({ key: `d${++seq}`, name: '', assigneeId: '', due: '', children: [] });

/** Named rows only, at every depth: an empty row is a row the person did not fill, never a nameless task. */
export function namedDrafts(drafts: SubtaskDraft[]): SubtaskDraft[] {
  return drafts.filter((d) => d.name.trim()).map((d) => ({ ...d, name: d.name.trim(), children: namedDrafts(d.children) }));
}

export function countDrafts(drafts: SubtaskDraft[]): number {
  return drafts.reduce((n, d) => n + 1 + countDrafts(d.children), 0);
}
