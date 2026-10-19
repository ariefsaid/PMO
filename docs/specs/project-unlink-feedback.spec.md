# Project integrations: visible feedback after a failed unlink (#1156)

**Status:** shipped with the fix for #1156 (v0.24.0).

## Requirement

- **FR-001** (event-driven): When a user's request to unlink a project from ClickUp fails, the project integrations card shall show a persistent alert on the card stating that the unlink failed and the project is still linked, with the classified failure detail, until the user retries.

## Acceptance

**AC-V24P-013:** Given a project linked to ClickUp, When the user confirms Unlink and the request fails, Then the card shows a persistent alert ("Could not unlink from ClickUp. The project is still linked.") with the failure detail, the link remains shown, and a deliberate retry calls unlink again.
Owning layer: unit — `pmo-portal/src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx`.

## Known limit

A request that times out after the server already unlinked shows the "still linked" headline until the next refresh corrects the card (#1223).
