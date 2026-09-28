# Kanban Project Title Readability Implementation Plan

> **For agentic workers:** Execute this signed task inline with `superpowers:executing-plans`; each step uses the red-green-refactor loop.

**Goal:** Make Kanban project titles use the available width beside the icon and place status under the complete title, while preserving the grid card and board activation behavior.

**Architecture:** Keep the `ProjectCardShell` props and board wrappers unchanged. In the shared head, render Kanban status within the title/client column after an unclamped title and before client/code; keep grid status after its existing title/client column and keep its name button and two-line clamp.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 utilities, Vitest, React Testing Library, user-event, Vite, agent-browser.

**Spec:** `docs/specs/kanban-title-readability.spec.md`; design authority: `DESIGN.md` and `docs/design/2026-09-26-enterprise-coherence-brief.md`.

## Global Constraints

- Preserve `ProjectCardShell`'s props, Sales and Projects board data, stage navigation, and `KanbanCard` pointer/keyboard activation.
- Change the `kanban` layout only; keep the grid title button, status placement, and `line-clamp-2` behavior.
- For Kanban, keep the title beside the icon, remove its line clamp, and order the head as title → status → client/code.
- Use the existing 26px Kanban icon, `kanban-card` spacing, typography, semantic text colors, spacing scale, and status component; add no tokens, dependencies, or decorative chrome.
- Verify the affected boards at 390px and desktop in light/dark themes and English/Bahasa; keep the board's horizontal scroll contained.
- Do not include PII, secrets, secret coordinates, or open security weaknesses in tracked artifacts.

## Review Focus

- **Long multiword Kanban title with a long status:** title must retain all words without a clamp and status must follow it in the same text column; pin with AC-KTR-001.
- **Grid card regression:** grid status remains outside the text column and the project name remains its two-line inner button; pin with AC-KTR-002.
- **Card activation:** pointer, Enter, and Space each call the existing open callback once, with no nested interactive control; pin with AC-KTR-003.
- **Bahasa copy and narrow Kanban column:** verify ordinary title words, status, and card bounds at 390px on both boards in the rendered Discover pass; record as AC-KTR-004 evidence.
- **Desktop and dark-theme rendering:** verify the title/status hierarchy and existing semantic token colors at desktop widths in both locales and themes; record as AC-KTR-004 evidence.

---

### Task 1: Repair the shared Kanban card head

**Files:**
- Modify: `pmo-portal/components/ProjectCardShell.test.tsx`
- Modify: `pmo-portal/components/ProjectCardShell.tsx`
- Modify: `DESIGN.md`
- Modify: `docs/qa-portfolio.md`

**Interfaces:**
- Consumes: Existing `ProjectCardShellProps`, `KanbanCard`, status/client/code/body/foot slots, and the current grid and Kanban variants.
- Produces: No API change. Kanban head order is title, status, client/code; grid remains title/client/code plus its sibling status.

- [x] **Step 1: Write the component regression tests first.** Replace the old assertion that both variants clamp to two lines with AC-KTR-001 and AC-KTR-002 checks. Use a multiword title (`Integrated maintenance planning for regional facilities`) and a long status (`Awaiting commercial closeout`) in the Kanban case. Assert that the title has `break-words`, has no `line-clamp-*` or `truncate` class, and precedes status, client, and code in the same text column. Assert the grid title still has `line-clamp-2` and remains a button while status remains outside the text column. Add AC-KTR-003 assertions for click, Enter, and Space, each calling `onOpen` once and with no nested button.

```tsx
it('AC-KTR-001: shows the complete Kanban title before status and client/code', () => {
  const longName = 'Integrated maintenance planning for regional facilities';
  render(
    <ProjectCardShell
      {...baseProps}
      name={longName}
      client="Client Example"
      code="PRJ-685"
      status={<span data-testid="status-slot">Awaiting commercial closeout</span>}
      variant="kanban"
    />,
  );

  const kanbanName = screen.getByText(longName);
  const status = screen.getByTestId('status-slot');
  const textColumn = kanbanName.parentElement!;
  const headText = textColumn.textContent!;
  expect(kanbanName.className).toContain('break-words');
  expect(kanbanName.className).not.toMatch(/line-clamp|truncate/);
  expect(textColumn).toContainElement(status);
  expect(headText.indexOf(longName)).toBeLessThan(headText.indexOf('Awaiting commercial closeout'));
  expect(headText.indexOf('Awaiting commercial closeout')).toBeLessThan(headText.indexOf('Client Example'));
  expect(headText.indexOf('Client Example')).toBeLessThan(headText.indexOf('PRJ-685'));
});

it('AC-KTR-002: preserves the grid title button, clamp, and status placement', () => {
  render(<ProjectCardShell {...baseProps} />);
  const gridName = screen.getByRole('button', { name: /Innovate Corp HQ Fit-Out/i });
  const textColumn = gridName.parentElement!;
  const status = screen.getByTestId('status-slot');
  expect(gridName.className).toContain('line-clamp-2');
  expect(textColumn).not.toContainElement(status);
  expect(textColumn.parentElement).toContainElement(status);
});

it('AC-KTR-003: activates one Kanban card for click, Enter, and Space without nested buttons', async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  render(<ProjectCardShell {...baseProps} variant="kanban" onOpen={onOpen} />);
  const card = screen.getByRole('button', { name: /Innovate Corp HQ Fit-Out/i });
  expect(within(card).queryByRole('button')).toBeNull();

  await user.click(card);
  expect(onOpen).toHaveBeenCalledTimes(1);
  card.focus();
  await user.keyboard('{Enter}');
  expect(onOpen).toHaveBeenCalledTimes(2);
  await user.keyboard(' ');
  expect(onOpen).toHaveBeenCalledTimes(3);
});
```

- [x] **Step 2: Run the focused component test to verify RED.**

Run from `pmo-portal/`: `../scripts/with-test-lock.sh npm run test -- components/ProjectCardShell.test.tsx`.

Observed RED: `AC-KTR-001` failed because the current Kanban title had `line-clamp-2`; the other seven component tests passed. The grid and activation assertions remained characterization coverage.

- [x] **Step 3: Make the minimal Kanban-only layout change.** Keep the existing common icon and text column. Render the status immediately after the Kanban title inside that column, before the existing client/code row; omit the Kanban title clamp. Render status as the existing head sibling for `grid`, whose title button and `line-clamp-2` stay intact. Leave `KanbanCard`, `onActivate`, board files, and body/foot slots unchanged.

```tsx
{isKanban ? (
  <div
    className="block max-w-full break-words text-[13px] font-semibold text-foreground leading-5"
    title={name}
  >
    {name}
  </div>
) : (
  <button
    type="button"
    onClick={onOpen}
    className="block max-w-full break-words text-left text-sm font-semibold text-foreground line-clamp-2 leading-5 hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    title={name}
  >
    {name}
  </button>
)}
{isKanban && <div className="mt-1 flex min-w-0 items-center">{status}</div>}
<div
  className={cn(
    'mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground',
    isKanban && 'mt-1',
  )}
>
  {!isKanban && clientId ? (
    <CompanyNameLink companyId={clientId} name={client ?? null} className="text-[12px]" />
  ) : (
    <span className="truncate">{client ?? '—'}</span>
  )}
  {code && <span className="shrink-0 font-mono text-[11px]">· {code}</span>}
</div>
{!isKanban && status}
```

- [x] **Step 4: Run the focused component test to verify GREEN.**

Run from `pmo-portal/`: `../scripts/with-test-lock.sh npm run test -- components/ProjectCardShell.test.tsx`.

Observed GREEN: 1 file / 8 tests passed in 6.76s after waiting 808s for the shared test lock.

- [x] **Step 5: Record the finding in the design and QA records.** In `DESIGN.md`'s Kanban Card signature, state that project titles wrap without a line clamp and status follows the title before client/code. In `docs/qa-portfolio.md`'s graduation registry, record the component regression, the `mobile@390` and `cross-screen consistency` cells for `/sales` and `/projects`, and the DESIGN.md note. Keep the registry row open until Step 6 confirms the rendered pass.

- [ ] **Step 6: Render the affected boards and capture evidence.** Start the local Vite app and use `agent-browser` on the seeded sample. Capture Sales and Projects cards at 390×844 and 1440×900 for English/Bahasa and light/dark. On each view, inspect a long-name card and a long-status card; confirm the title and status are visible in the specified order, no card exceeds its column, page overflow stays contained by the Kanban scroller, the grid view remains unchanged, and click/Enter/Space still open one project. Save screenshots outside tracked files and list their paths in the review packet.

Current evidence is partial: 12 of 16 screenshots are saved under `/tmp/kanban-title-readability/` (all eight Bahasa cells and all four Sales/English cells). Projects/English/390px/light was checked through the DOM only: 7 Kanban cards, document width 390px, and the board scroller contained horizontal overflow at 349px client width / 1,342px scroll width. The browser stalled during screenshot capture; one retry through direct CDP also timed out. The preview was then closed to release resources. The four Projects/English screenshot cells remain pending, so the QA graduation row stays open; finish those cells before PR.

- [x] **Step 7: Run full verification under the shared test lock.**

Run from `pmo-portal/`: `VITEST_MAX_WORKERS=3 npm run verify:locked`.

Observed GREEN: every configured verify gate passed. Vitest reported 842 files / 7,720 tests passed in 1,050.46s; Vite build completed in 722ms. The run held the shared test lock and released it with `rc=0`; two other locked verify wrappers had queued behind it.

- [x] **Step 8: Review the diff and commit green work only.** Confirm the diff contains only this plan, component/test, design note, and QA graduation; run `git diff --check`, then commit the green changes with a message naming Kanban title readability. Do not push, open a PR, or merge. Committed locally as `bf71be0f`; no push, PR, or merge.

```bash
git diff --check
git add docs/plans/2026-09-28-kanban-title-readability.md \
  pmo-portal/components/ProjectCardShell.test.tsx \
  pmo-portal/components/ProjectCardShell.tsx \
  DESIGN.md docs/qa-portfolio.md
git commit -m "fix: improve kanban project title readability"
```
