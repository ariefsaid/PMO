# Administration and settings · round two

1. **Admin** → find the setting by the job it serves, see its state and consequence, then use its existing control.
2. **Users / People** → find an account or person, then manage access or staffing from that row. The People register precedes time-record configuration.
3. **Document types / Clearance / Document categories** → define the document, see who needs it and set who can see it.
4. **Modules / All settings** → see which capabilities are on, then open the setting that controls each capability.
5. **Accounting** → Tax and fiscal year / Approvals and checks / Purchase orders / Costs and account mapping.
6. **Project setup** → Numbering and project lists (including stage names) / Daily site reports / Work orders / Issues.
7. **Terminology** → check existing terms and role names, then edit the English and Bahasa wording in its row.
8. **Exchange rates / Cost attribution** → find the rate by date or see the rule that assigns costs to a project.
9. **Connections / Scheduled reports / Your plan / Credits** → set delivery and integrations or check the current plan and balance.
10. **Usage / Features** → an Operator checks usage figures or reads where a feature's effective setting comes from.

```text
Administration
  People and access → Users | People | Document types | Clearance
  Setup             → Modules | Accounting | Project setup | Terminology
                       Project setup → Numbering and project lists → Stage | English | Bahasa Indonesia
  Connections       → Integrations | Scheduled reports
  Plan              → Your plan | Credits
```

## Integration and changes

- Merged the batch branch, then dev. The Project setup conflict kept the round-one groups and the incoming stage editor. The work-order modal conflict kept the batch's form structure and dev's organisation-local date.
- Stage names live beside project numbering and classification. The editor keeps the two language drafts, stage grouping, defaults, validations and existing Save behavior. It measures the pane before putting both languages and the stage name on one line.
- The shared desktop table wraps complete labels and keeps its sort and resize affordances. Budget account mapping uses its existing card presentation below 760 px of pane width. Cost attribution uses compact columns in the wide pane and the same card presentation below 794 px. Exchange rates, People, Document types, Usage and the Operator feature switches also use their existing card presentations when the pane is too narrow.
- Users distinguishes an unassigned manager from an unavailable manager name. Features identifies a feature without a plan default. Usage and Integrations explain unavailable dates, pricing and list links. Usage figures that need more input appear in the shared hidden-figures line.
- A single permission note heads the Tax and fiscal year panel. The People register's empty state sits close to its actions. The issue closing-time report uses the same inset as the other project settings.
- Existing bookmarks and per-setting save behavior still work. The stage journey locates Save through the named stage region and the tax permission check now tests the panel that owns the note.

## Browser evidence

The before captures use the merged tree at `03fa7de56` so the comparison starts with both upstream branches present. Captures use system Chromium and seed Admin, Executive, Finance and Operator accounts. Account identifiers and sample names from the seed are masked where they appear. The last stage and populated-register crops were refreshed after their responsive changes.

164 paired viewport measurements. The after probe also included 13 supplemental views. It found 0 clipped desktop header labels across 70 rendered header observations at 1440 and 1024 px. Across all 177 measured after states it found 0 bare dash placeholders, 0 horizontally scrolling tables and 0 viewport overflows.

| View | Pane left x before → after | Pane height px before → after | Scrolling tables before → after | Bare dashes before → after |
|---|---:|---:|---:|---:|
| Users · Bahasa · 1024 | 464 → 464 | 911 → 919 | 0 → 0 | 5 → 0 |
| People · English · 1440 | 496 → 496 | 855 → 723 | 0 → 0 | 0 → 0 |
| Accounting · English · 1440 | 496 → 496 | 5872 → 5870 | 0 → 0 | 0 → 0 |
| Accounting · English · 1024 | 464 → 464 | 6171 → 6613 | 1 → 0 | 0 → 0 |
| Project setup · Bahasa · 1024 | 464 → 464 | 6892 → 7300 | 0 → 0 | 0 → 0 |
| Project setup · Bahasa · 390 | 16 → 16 | 9587 → 9472 | 0 → 0 | 0 → 0 |
| Cost attribution · English · 1440 | 496 → 496 | 526 → 526 | 1 → 0 | 0 → 0 |
| Features · Bahasa · 1024 | 464 → 464 | 3033 → 5652 | 1 → 0 | 0 → 0 |
| Exchange rates, one record · Bahasa · 1024 | 464 → 464 | 243 → 300 | 1 → 0 | 0 → 0 |

The stage heading in Bahasa starts at x=521 at 1440 px, x=489 at 1024 px and x=33 at 390 px. The 1024 layout adds vertical space where the fields stack. Companies and Contacts were also inspected as shared table callers and their rendered headings read whole.

- `before/` and `after/` contain the first viewport at 1440×900, 1024×768 and 390×844 in English and Bahasa Indonesia. The Admin sweep also includes 1920×1080 and dark captures for the core settings screens.
- `after/stage-names-{en,id}-{1440,1024,390}.png` shows the two-language editor. `after/budget-account-map-{en,id}-{1440,1024,390}.png` includes the account-chart error and the mapped categories.
- The route screenshots for each role are supplemented by the People role chooser, document-category actions, role names and populated People, Document types and Exchange rates states.
- The Admin used Add person, Add document type and New rate to create a long sample person row, a sample medical document type and one historical rate for the populated views. The records are local. The related forms and persisted results were checked in the app.
- `after/accounting-idr-limit-id-admin-390.png` shows `Rp 125.000.000.000`. The seed organisation uses USD, so the browser context supplied IDR through the same currency read. The Admin saved the test amount through the site cash form, then restored the original site cash limit and language and number preferences.

## Skills applied

- **Restructure** · “A calm screen is information-rich: reduce reading and competing marks while preserving useful facts and actions.” The tax settings share one permissions note and the issue report keeps the same controls in a flat layout.
- **Taste** · “Tables are rules and alignment.” Wide tables keep their columns and narrow panes reflow to labelled rows. “Surfaces are flat.” The issue report's inner cards and budget account map's extra frame are gone.
- **Impeccable** · “Refinement keeps the incumbent identity, behavior, copy, and everything outside scope.” Stage names use the established fields and panel styling with their original labels and save semantics.
- **UI UX Pro Max** · “Visible labels, Error near field, Helper text, Progressive disclosure.” Each narrow stage row shows the two language labels and keeps its validation message with that row.
- **Screen rules** · “A column that is blank on every row is not rendered.” Usage keeps its all-null margin note and uses the shared missing-figure treatment for figures that need token or run data. Shared table headers retain the app's typographic tokens where the skill's surface guidance differs.

## Owner to confirm

- Stage names sit in Numbering and project lists. The two fields stack beside the stage label in the middle-width pane and underneath it on a phone.
- Budget account mapping and cost attribution reflow to cards when the content pane cannot fit the full table.
- The read-only notice for the tax panel now appears above the settings. Missing values use visible, translated reasons.

## Needs a data change

No app data contract change was needed for the changes above. The branch carries the existing migrations from the upstream merges.

## Round-one items still open

The long setup routes keep their existing anchor structure. Moving each group into its own route would change the navigation and when settings fetch. Applying a single save model across mixed panels would change when the current writes happen. Permission copy still appears at controls where write access is distinct. Existing list-first bodies kept their current jobs and controls unless a rendered check called for a change.

## Journeys and gates

- Lean Supabase start and local database reset passed. The stage rename journey passed with Admin and Project Manager.
- The selected 40 journey specs ran in two lanes. The Chromium lane had 48 passed and 2 failed. The serial lane had 34 passed, 1 skipped and 5 failed. The failures were retried against a production build after updating the exchange-rate journey to find persisted values in either responsive layout. All 9 retry cases passed.
- Guards, typecheck and ESLint passed. Focused People, stage, fiscal-year, usage, table, exchange-rate and integration checks passed, including the corrected Bahasa manager assertion and fiscal-year integration guidance.
- The broad related Vitest run was stopped after more than 90 minutes. It had reported failures in budget proposals, fiscal-year integration translation and the manager assertion. Focused reruns of those cases passed after corrections. A completed full related-test result is still outstanding.
- UX proof exited 1 on spacing and missing shrink-only baselines. The completed layout pass covered seven administration routes at three widths. The earlier full proof reported zero serious or critical axe findings for Accounting, Projects and People before the server stopped.
- The local journey specs generated tracked evidence images in other folders. Those generated changes were restored.

## What remains

- Some settings still repeat permission guidance. The long setup routes remain grouped on one scrolling page, and mixed settings retain their existing save models.
- The seeded empty-state and populated-state screenshots cover the states listed above. They do not cover every possible menu, error and loading state.
