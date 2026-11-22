# Plan: price visibility for field roles (acceptance tests)

Spec: `docs/specs/price-visibility-roles.spec.md`. Verified: the base answers the ask for Foreman and Field user, so the item is acceptance tests. No migrations, no rollbacks, no settings, no frontend change.

## Build
1. `supabase/tests/1850_price_visibility_field_roles.test.sql` (pgTAP, owning layer for AC-PVF-001..007): fixtures reuse the purchase and stock rows the hide-prices tests use; a helper runs every channel as the Admin, the Finance person, a Foreman and a Field user with hiding on and off, and records the priced count or the 42501 refusal; one assertion per channel; controls prove the channels hold prices. Mutation instructions in the header.
2. No other file changes. Existing tests keep their steps.

## Gates (pmo-portal/)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0` on changed TS (none). The pgTAP file is run by the orchestrator (`supabase test db supabase/tests/1850_price_visibility_field_roles.test.sql`), then the mutation checks in its header.

## Follow-up (needs the customer's answer, spec section 7)
If other roles should keep prices: `built_in_role_capabilities` rows (data) for them, plus restating `actor_may_see_prices_now()` without the legacy-Engineer clause, with matching test and `ROLE_CAPABILITIES` edits. Not built.
