import type { CheckpointTemplateItem } from '@/src/lib/repositories/siteCheckpoints';

export interface Draft { name: string; time: string; grace: string; photo: boolean; start: boolean }

export const toDraft = (i: CheckpointTemplateItem): Draft => ({ name: i.name, time: i.due_time, grace: String(i.grace_minutes), photo: i.photo_required, start: i.marks_work_start });

/** The list as typed becomes items, or the first thing wrong with it (the server re-checks every rule). */
export function draftsToItems(drafts: Draft[]): { items: CheckpointTemplateItem[] } | { error: 'name' | 'time' | 'grace' | 'start' } {
  const items: CheckpointTemplateItem[] = [];
  for (const d of drafts) {
    if (d.name.trim() === '' || d.name.trim().length > 120) return { error: 'name' };
    if (!/^\d{2}:\d{2}$/.test(d.time)) return { error: 'time' };
    const grace = d.grace.trim() === '' ? 0 : Number(d.grace);
    if (!Number.isInteger(grace) || grace < 0 || grace > 120) return { error: 'grace' };
    items.push({ name: d.name.trim(), marks_work_start: d.start, due_time: d.time, grace_minutes: grace, photo_required: d.photo });
  }
  if (items.filter((i) => i.marks_work_start).length > 1) return { error: 'start' };
  return { items };
}
