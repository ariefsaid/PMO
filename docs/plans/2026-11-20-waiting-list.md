# Plan: the waiting list (fix-waiting)

Spec `docs/specs/waiting-list.spec.md`. Test-first at each layer's owning test.

1. `supabase/migrations/1560_waiting_decisions.sql` (+ rollback): `my_waiting_decisions()`, `my_decision_standing()`. Test `supabase/tests/1560_waiting_decisions.test.sql` (mutation-checked: drop the author and the priced-it-myself clauses, the test goes red).
2. `1561_requester_notified.sql` (+ rollback): AFTER triggers write the requester's notification. Test `1561_requester_notified.test.sql` (mutation-checked: wrong recipient, five tests go red).
3. `src/lib/approvals/waitingKinds.ts` (registry), `src/lib/db/waitingDecisions.ts`, `src/hooks/useWaitingDecisions.ts`, `src/hooks/useWaitingForYou.ts` (one list, `Record<WaitingKind, …>` so a missing kind is a compile error).
4. Readers: `ApprovalsNavCount` (badge), `useNeedsYou` (home), `EngineerDashboard`, `FinanceHub`, `pages/Approvals.tsx` + `WaitingDecisionSection`, Rail and phone bar entry (`useApprovalsEntryOffered`).
5. `src/lib/approvals/waitingFor.ts` wired into the purchase record and the material request; expense claims already name approvers.
6. Notification titles by `NOTIFICATION_TITLE_KEYS` (`src/lib/i18n/notificationCopy.ts`); label line in the bell; new routes in the bell.
7. `MaterialRequestNew`: returned-reason banner; a typed over-plan reason stays visible.
8. Catalogue: new namespace `waitingList` (en, id).
