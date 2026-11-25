import type { SupabaseClient } from '@supabase/supabase-js';
import type { Locator, Page } from '@playwright/test';
import { iso, need, ORG_ID, PM_ID } from './jobJourney';

/** A uniquely named project with one open work order, for the crew journeys. */
export async function seedWorkOrder(db: SupabaseClient, who: string, run: string, label: string) {
  const must = need(who);
  const projectId = must('project', await db.from('projects').insert({ org_id: ORG_ID, name: `${run} ${label}`, status: 'Ongoing Project', project_manager_id: PM_ID }).select('id').single()).id;
  const workOrderId = must('work order', await db.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `${run} ${label} work`, status: 'Issued', order_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single()).id;
  return { projectId, workOrderId, title: `${run} ${label} work` };
}

/** Approved attendance is immutable, so cleanup ends the open roster and placements rather than deleting them. */
export async function endCrewRows(db: SupabaseClient, crewIds: string[]) {
  const today = iso(new Date());
  await db.from('work_order_crews').update({ valid_to: today }).in('crew_id', crewIds);
  await db.from('crew_members').update({ valid_to: today }).in('crew_id', crewIds);
}

/** Nobody starts present (OD-R1125-1): the recorder marks each un-recorded person on the screen, as a foreman does. */
export async function markEveryonePresent(scope: Page | Locator) {
  const boxes = scope.getByRole('combobox', { name: /^Status for / });
  for (let i = 0, n = await boxes.count(); i < n; i++) {
    if ((await boxes.nth(i).inputValue()) === 'unmarked') await boxes.nth(i).selectOption('present');
  }
}
