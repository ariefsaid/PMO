// @e2e-isolation: self-isolated — unique meeting title (Date.now() suffix, generated per attempt) + afterEach service-role cleanup of the created task + meeting rows; signs in as the shared engineer seed user but mutates no shared seed row.
/**
 * AC-MTG-060 — Meeting module curated cross-stack journey (#526, ADR-0010: ONE e2e for the
 * module's cross-stack story; everything else lives at unit/pgTAP).
 *
 * The journey, as the user would walk it (BDD authoring rule — the app conforms to the test):
 * an ENGINEER (the whole point of OD-MTG-1 — the role locked out of every master-data surface
 * may minute a meeting) creates a meeting from /meetings, types a minute line, and turns that
 * line into an action item **through the task-create modal (DD-MTG-8: an informed authoring
 * act, never a silent copy — the task name is org-visible, so publishing it is the author's
 * explicit choice)**. GOAL ORACLE: the task exists in the meeting's "Action items" list — which
 * renders ONLY tasks carrying `tasks.meeting_id = <this meeting>` (migration 0206), read back
 * from the server — and survives a full page reload (server truth, not client cache).
 *
 * Then the DD-MTG-5 find story (the spec's designated journey, I5): back on the list, a search
 * for a term that exists ONLY in the minute's notes finds the meeting through the DB-side
 * `notes_search` projection, and the term-less list still shows it, newest-first.
 *
 * Cross-stack surface proven in one pass: meetings insert RLS with NO role list (0205/OD-MTG-1) →
 * author-stamped created_by_id → Engineer task create (0204/DD-TASK-8) with meeting_id + a NULL
 * project (0199/DD-TASK-1 — a project-less action item under a project-less meeting is legal,
 * and the 0206 same-org/same-project trigger admits it) → the /meetings/:id read-back through
 * the attendance∪author select policy → websearch over the trigger-maintained tsvector.
 *
 * ISOLATION NOTE (conventions §2): every row this spec touches is created inside the test with a
 * per-attempt unique suffix — no shared seed row (P001/P002/SP-2401/shared users) is written, so
 * the spec is ordering-independent under workers:4 and safe under retries (a retry generates a
 * fresh suffix and finds no leftover state with its own name). afterEach deletes the task first,
 * then the meeting — the 0206 FK is NO ACTION on purpose (FR-MTG-016), so the meeting cannot be
 * deleted while its action item exists. Cleanup no-ops locally without the service key (the
 * rows are unique-named and the next `db reset` clears them); in CI the helper throws instead of
 * silently skipping (M14 — helpers.requireServiceRoleKey, never a hand-rolled env read).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from './helpers';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

test.setTimeout(120_000);

test.describe('AC-MTG-060: meeting → minute → /action → task linkage → found by notes search', () => {
  let meetingId: string | undefined;

  test.afterEach(async () => {
    if (!meetingId) return;
    const key = requireServiceRoleKey();
    if (!key) return;
    const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
    // Task first: the meeting FK-blocks (23503) while its action items exist (FR-MTG-016).
    await admin.from('tasks').delete().eq('meeting_id', meetingId);
    await admin.from('meetings').delete().eq('id', meetingId);
    meetingId = undefined;
  });

  test('AC-MTG-060: an Engineer minutes a meeting, publishes an /action task via the modal, and finds the meeting by its notes', async ({
    page,
  }) => {
    // Unique per ATTEMPT (inside the test body), so a retry never collides with attempt 1.
    const suffix = Date.now();
    const meetingTitle = `E2E Minute Journey ${suffix}`;
    // "flange" deliberately appears ONLY in the minute body, never in the title — so the search
    // step below proves the NOTES projection, not an accidental title match.
    const minuteLine = `Order flange samples ${suffix}`;
    const taskName = `Chase flange samples ${suffix}`;

    // ── 1. The Engineer signs in and opens Meetings from the rail (OD-MTG-1: the nav exists
    //       for every role, Engineer included). ─────────────────────────────────────────────
    await signIn(page, 'engineer@acme.test');
    await page.getByRole('link', { name: 'Meetings', exact: true }).click();
    await page.waitForURL('**/meetings');

    // ── 2. Create the meeting (no project — the project-less path is the strictest one:
    //       DD-TASK-1 makes the downstream action item project-less too). The list may show
    //       seeded rows or an empty state — use the header CTA explicitly. ─────────────────
    await page
      .getByTestId('list-page-header')
      .getByRole('button', { name: 'New meeting' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The visible label carries the required marker ("Title*"); the textbox's ACCESSIBLE name
    // is "Title" — locate by role+name, not label text.
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(meetingTitle);
    await dialog.getByRole('button', { name: 'Create meeting' }).click();

    // Creation lands on the detail route — capture the id for cleanup.
    await page.waitForURL(/\/meetings\/[0-9a-f-]{36}/);
    meetingId = page.url().match(/\/meetings\/([0-9a-f-]{36})/)?.[1];
    await expect(page.getByRole('heading', { name: meetingTitle })).toBeVisible();

    // ── 3. Minute a line. The author sees the editor (attendance-keyed read, author-keyed
    //       write — 0205); a fresh meeting starts with no lines. ──────────────────────────
    await page.getByTestId('minutes-add-line').click();
    await page.getByPlaceholder('Type a minute…').fill(minuteLine);
    const save = page.getByTestId('minutes-save');
    await save.click();
    // The save round-trips: the button re-disables only when the saved copy equals the editor.
    await expect(save).toBeDisabled();

    // ── 4. /action — DD-MTG-8: the STANDARD task-create modal opens, prefilled from the line
    //       and fully editable. The author edits the name before publishing (the informed act:
    //       what they submit — and only that — reaches the org-visible tasks system). ───────
    await page.getByTestId('minute-action-0').click();
    const actionModal = page.getByRole('dialog');
    await expect(actionModal).toBeVisible();
    const nameBox = actionModal.getByRole('textbox', { name: 'Task name' });
    await expect(nameBox).toHaveValue(minuteLine); // prefilled from the minute line
    await nameBox.fill(taskName); // …and consciously edited before publishing
    await actionModal.getByRole('button', { name: 'Create task' }).click();

    // ── 5. GOAL: the task exists in the meeting's Action items list. This list renders only
    //       tasks whose meeting_id is THIS meeting (0206) read back from the server — the
    //       linkage oracle, not a DOM detail. It carries the EDITED name, never the raw line.
    const actionItems = page.getByTestId('action-items-list');
    await expect(actionItems.getByText(taskName)).toBeVisible({ timeout: 15_000 });

    // ── 6. And it is server truth, not optimistic client cache: a full reload re-reads the
    //       meeting, the minute line, and the linked task through RLS from a cold cache. ────
    await page.reload();
    await expect(page.getByRole('heading', { name: meetingTitle })).toBeVisible();
    await expect(page.getByPlaceholder('Type a minute…')).toHaveValue(minuteLine); // the persisted minute
    await expect(page.getByTestId('action-items-list').getByText(taskName)).toBeVisible({
      timeout: 15_000,
    });

    // ── 7. The DD-MTG-5 find story (I5): back on the list, search a term that lives ONLY in
    //       the minute's NOTES ("flange" — the title never contains it), so the hit can only
    //       come from the DB-side notes_search projection. ─────────────────────────────────
    await page.getByRole('link', { name: 'Meetings', exact: true }).click();
    await page.waitForURL('**/meetings');
    await page.getByLabel('Search meetings').fill(`flange ${suffix}`);
    await expect(page.getByRole('table').getByText(meetingTitle)).toBeVisible({
      timeout: 15_000,
    });

    // ── 8. …and the term-less list still shows it, newest-first (FR-MTG-028/035): this
    //       meeting was created moments ago, so it outranks every seeded row. ──────────────
    await page.getByLabel('Search meetings').fill('');
    const firstRow = page.getByRole('table').locator('tbody tr').first();
    await expect(firstRow.getByText(meetingTitle)).toBeVisible({ timeout: 15_000 });
  });
});
