# Spec: Work in hand under Projects and Management Dashboard with monthly capacity (M8)

**Status:** active. IDs `FR-M8-###`, `AC-M8-###`. Extends `docs/specs/work-in-hand-backlog.spec.md` (#2575). **Money path: read-only** (adds only an Admin-configured monthly capacity parameter on `organizations`; posts nothing, changes no approval/money rule).

## Job story

When deciding staffing and reviewing the order book, an Executive, Admin, Finance user, or Project Manager wants to see the value of work in hand and how many months of work that represents against the organisation's monthly production capacity directly under Projects and on the Management Dashboard.

## Rules

- **Monthly work capacity** is set by an Admin in `Administration › Project setup` (`organizations.work_in_hand_monthly_capacity`, `numeric(18,2) > 0`, `NULL` when unset), denominated in the organisation's currency (`organizations.default_currency`).
- **Months of work in hand** = `value of work in hand in the organisation's currency ÷ monthly capacity`, computed in exact integer cents and rounded half-up to one decimal (`formatBacklogTenths`), not by completed-month historical billing.
- **No monthly capacity set** (`NULL`): the months line displays a clear empty state saying no monthly capacity is set (with a link to settings for Admin).
- **Other currencies**: work in hand in any currency other than the organisation's currency is shown beside the primary value, labelled by currency, and explicitly stated as not included in months (no currency conversion).
- **Access & scoping**: follows `OD-R1124-11` (`get_work_in_hand` 2281): Admin, Executive, and Finance see the organisation-wide position; Project Managers see their assigned projects; Engineers and non-members are refused. Only an active same-org Admin may write monthly capacity.

## Requirements (EARS)

- FR-M8-001 An Admin shall be able to set, update, or clear the organisation's monthly production capacity in the organisation's currency under `Administration › Project setup`; non-Admins and callers from other organisations shall be refused by RLS and column grants.
- FR-M8-002 While no monthly capacity is set, the months-of-work-in-hand display shall state that no monthly capacity is set (and offer Admin a link to the setting) rather than falling back to completed-month billing or showing zero.
- FR-M8-003 When monthly capacity is set, months of work in hand shall equal the organisation-currency work in hand divided by monthly capacity; work in hand in other currencies shall be displayed beside it, labelled, and stated as not included in months with no conversion.
- FR-M8-004 Value of work in hand, other-currency totals, and capacity-based months of work in hand shall be shown under Projects (with a direct doorway to `/projects/work-in-hand`) and on the Management Dashboard (for Executive, Admin, Finance, and Project Manager).
- FR-M8-005 Every change to monthly capacity shall write an `org.setting.change` audit event through the standing audit trigger.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-M8-001 | Given organisation-currency and foreign-currency work in hand and a configured monthly capacity, when months of work in hand is computed, then only the organisation-currency work in hand is divided by capacity (rounded half-up to tenths) and foreign currencies stay separate; when capacity is unset or zero, months is `null`. | Unit (`pmo-portal/src/lib/workInHand.test.ts`) |
| AC-M8-002 | Given an active Admin, when they update `work_in_hand_monthly_capacity` (and when a PM, Finance, Executive, Engineer, offboarded user, or other-org Admin tries), then only the active same-org Admin succeeds, `<= 0` is rejected by check constraint, and an audit event is recorded. | pgTAP (`supabase/tests/2530_work_in_hand_capacity.test.sql`) |
| AC-M8-003 | Given `work_in_hand_monthly_capacity` set or null on the organisation, when `get_work_in_hand` runs for Admin/Executive/Finance/PM, then `monthly_capacity` is returned as scale-two text or null alongside existing fields, with role and org isolation preserved. | pgTAP (`supabase/tests/2530_work_in_hand_capacity.test.sql`) |
| AC-M8-004 | Given an Admin opening `Administration › Project setup`, when they enter, save, or clear monthly capacity, then the setting persists in the organisation's currency and shows the empty state when cleared. | Unit (`pmo-portal/pages/admin/OrgWorkInHandCapacity.test.tsx`) |
| AC-M8-005 | Given Projects and Management Dashboard views for Executive/Admin/Finance/PM, when work in hand renders with configured or unset capacity and multi-currency contracts, then org-currency value, labelled other currencies stated as not included in months, and capacity-based months (or empty state) render accurately, while Engineer sees none. | Unit (`pmo-portal/src/components/workInHand/WorkInHandSummary.test.tsx`) |
| AC-M8-006 | Given an Admin setting monthly capacity and an Executive viewing Management Dashboard and Projects → Work in hand, then the configured months figure and separate non-included currency appear across dashboard, Projects, and `/projects/work-in-hand`. | E2E (`pmo-portal/e2e/serial/JOB-M8-work-in-hand-capacity.spec.ts`) |
