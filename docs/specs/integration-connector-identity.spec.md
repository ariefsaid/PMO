# Readable organization connector identity — spec (#680)

**Status:** proposed for the enterprise UX program, 2026-09-27. **Authority:** `docs/design/2026-09-26-enterprise-coherence-brief.md`, the existing organization integration card, and the org-scoped profile repository seam.

## Job story and observed failure

When an organization Admin reviews a connected service, they need to recognize who established the connection so they can ask the right person about setup or recovery. The card currently presents the connection's technical actor value, which does not answer that question. The stored stamp and date remain useful audit data.

## Design

Resolve the connector against the existing org-scoped profile source and show its readable display name. Keep the display on the organization integration card beside the connection date. If the identity cannot be resolved, was removed, or has no usable display name, show a neutral translated fallback such as “Former or unavailable user”; never render the raw actor value in the card. A pending profile lookup must not make the connection appear disconnected or block the service's own readiness state. This display does not grant a role new management actions and does not redefine operational readiness.

## Requirements (EARS)

- **FR-ICI-001:** When a binding contains a connector identity and a readable same-organization profile is available, the application shall display that profile's name beside the existing connection date.
- **FR-ICI-002:** When the connector identity cannot be resolved or has no readable name, the application shall display a neutral fallback without exposing the raw actor value.
- **FR-ICI-003:** While the profile lookup is pending or unavailable, the application shall preserve the card's separately derived binding and service-readiness states.
- **FR-ICI-004:** While a viewer has read-only access, the application shall show only actions already permitted by the current authorization model.
- **FR-ICI-005:** While the card is rendered in English or Bahasa Indonesia and at desktop or 390px, the connector label and fallback shall remain readable and accessible.

## Acceptance criteria and owning proof

| ID | Given / When / Then | Owning layer |
|---|---|---|
| **AC-ICI-001** | Given a binding whose connector resolves to a same-organization profile with a display name, when the card renders, then it names that person and retains the connection date. | Component |
| **AC-ICI-002** | Given a binding whose connector is unavailable or whose profile has no readable name, when the card renders, then it shows the translated neutral fallback and never the raw actor value. | Component |
| **AC-ICI-003** | Given a delayed or failed profile read, when the binding and service health resolve independently, then their readiness labels and permitted actions remain truthful and the identity display has a safe fallback. | Component |
| **AC-ICI-004** | Given a read-only viewer in either language and a 390px viewport, when the card renders, then the identity line is readable and management controls remain unavailable. | Component plus rendered review |

## Boundaries

No audit-stamp migration, connection lifecycle change, new permission, service handshake, or claim of live data transfer. Resolve only the existing person display; do not introduce a new identity management surface.
