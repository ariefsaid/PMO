# Notification inbox — server-side keyset paging (#843, first slice)

Scope: the notification inbox only (`src/lib/db/notifications.ts` + `NotificationBell`). Other list
screens stay out; #843 stays open. No migration: `notifications_owner_created_idx (owner_id,
created_at desc)` (0057) already serves the order; `id` is only a tiebreak inside one timestamp.

## Design
- New DAL `listNotificationsPage({ pageSize?, cursor?, unreadOnly? })` → `{ rows, nextCursor }`.
  Order `created_at desc, id desc`; cursor = last row's `(created_at, id)`; filter via
  `.or('created_at.lt.X,and(created_at.eq.X,id.lt.Y)')`; fetches `pageSize + 1` to know if more exist.
- Explicit column list (`NOTIFICATION_LIST_COLUMNS`) instead of `select('*')`.
- `unreadOnly` filters server-side (`read_at is null`). Unread badge keeps its separate head-count query.
- Bell: first page on open (20), "Load more" button appends the next page; the open-inbox reload,
  60s badge poll and mark-read behaviour are unchanged (no realtime channel exists today).

## ACs
| AC | Behaviour | Owning test |
|---|---|---|
| AC-843-001 | Page query orders `created_at desc, id desc`, uses an explicit column list, no `select('*')`, no org/owner sent | `src/lib/db/notifications.test.ts` |
| AC-843-002 | First page fetches `pageSize+1` rows via `.limit`; returns `pageSize` rows and a `nextCursor` when more exist, `null` otherwise | same |
| AC-843-003 | A cursor adds the keyset `or` filter on `(created_at, id)` | same |
| AC-843-004 | `unreadOnly` filters `read_at is null` server-side | same |
| AC-843-005 | Bell requests one page on open and shows "Load more" only when a next cursor exists; clicking appends the next page using the cursor | `src/components/shell/__tests__/NotificationBell.test.tsx` |
| AC-843-006 | Unread badge still comes from `listUnreadCount` (not the loaded page) and is refreshed after loading | same |

## Tasks
1. Plan (this file). 2. DAL tests red → impl. 3. Bell tests red → impl + en/id i18n key `loadMore`.
4. Verify (typecheck, eslint, vitest, i18n, build).
