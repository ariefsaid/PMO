# 06 project health: friction rows that moved (fix round)

| # | Friction | After | Where |
|---|---|---|---|
| 1 | Late amber on the record, plain grey in the list | Amber pill in both; over budget (red) wins, late then reads plain | pages/projects/ProjectStatusCell.tsx |
| 2 | Phone card: a bare figure beside the spent figure | "contract" / "spent" words on both | projects.json card.contractInline, projectTableColumns.tsx |
| 3 | Money in two formats on the record | One format (formatCurrency) in Needs attention | src/hooks/useProjectPosition.ts |
| 4 | Two lateness figures read as a contradiction | "3 phases late, the latest by 288 days", one sentence | useProjectPosition.ts, project.json attention.phasesWhat |
| 5 | Phone record: title twice, status and late on two rows | One visible title (app bar), status + late + menu on one row; first block 522px to 430px. Back stays its own row: the app has no app-bar back pattern | ProjectDetailHeader.tsx, RecordHeader.tsx |
| 6 | Names cut with an ellipsis | Project and client names wrap | projectTableColumns.tsx |
| 7 | Padlock with no words | Tooltip + accessible name "Contract value is locked for your role"; on phone its words sit inside Project details | ProjectDetailHeader.tsx, project.json header.contractLocked |

Not moved: taste `text-over-text` on the phone list (cards drawn under the fixed bottom bar while scrolling) and `panel-void` on the record overview (56px before, 58px after) are the same before and after this round.
