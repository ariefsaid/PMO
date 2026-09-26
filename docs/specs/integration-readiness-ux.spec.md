# Organization integration readiness UX

Issue: #677. This spec covers the organization Integrations view used by an RIS Admin before opening PMO to other users. It changes presentation and read recovery, not the integration authorization or transport contract. Microsoft 365 organization approval remains its own flow.

## Job story

When I connect an external service for my organization, I want to tell connection, activation, and data progress apart, so I can decide what to configure or verify next without treating a credential handshake as a completed integration.

## Functional requirements

- **FR-IRUX-001** — When the binding read is loading, the view shall show a loading state. When it fails, the view shall label connection state unavailable, offer Retry, and keep permitted connection controls reachable; it shall not describe an unknown binding as disconnected.
- **FR-IRUX-002** — While a binding is connected, the service card shall label that state Connected, identify its configuration state, and show the next permitted action. An ERPNext binding without a Company shall remain visibly awaiting activation. If connector identity is absent, the card shall omit that metadata field instead of showing a blank value.
- **FR-IRUX-003** — While the outstanding outbound-work read is loading or fails for one service, the view shall label that service's status read independently and offer Retry. An available service shall remain legible if another service's read fails.
- **FR-IRUX-004** — When health is available, the view shall not present the watermark row timestamp as a last successful sync or data-transfer time. It shall identify the count of outbound items that are pending or need attention without calling all of them errors, and explain that an actual transferred record must be checked to prove usable data.
- **FR-IRUX-005** — When an Admin opens Company selection, the view shall distinguish loading, unavailable, zero Companies, and available Companies; an unavailable read shall offer Retry. If activation fails, the selected Company shall remain selected and the error shall remain in the modal.
- **FR-IRUX-006** — While the ClickUp binding map reads its inputs, the view shall distinguish unknown from PMO-native status. If a source read fails, it shall explain which map information is unavailable and offer Retry.
- **FR-IRUX-007** — When employed-domain ownership is loading, unavailable, or empty, the view shall show a corresponding state instead of a blank section. The section remains read only.
- **FR-IRUX-008** — When disconnect fails, the confirmation shall stay open, explain the failure, and permit Retry without implying that syncing stopped.
- **FR-IRUX-009** — The service's read identity shall include the organization. After connect, disconnect, or activation, the affected health view shall refresh.
- **FR-IRUX-010** — All new user-facing copy shall be available in English and Bahasa Indonesia. New state controls shall remain keyboard accessible and readable at 390px in light and dark themes.

## Non-functional boundaries

- The page shall not claim that a real RIS Microsoft 365 or ERPNext connection works until an Admin performs a live data-carrying walkthrough. A watermark is recorded progress, not proof of current health.
- The page shall preserve existing role gates and the existing Microsoft 365 organization approval card. An unprivileged viewer shall not gain connection controls.
- Errors shall describe the failed task without revealing credential values or internal transport details.

## Acceptance criteria and owning tests

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-IRUX-001 | Given an unavailable binding read, when the page renders, then the connection state is unknown, Retry is offered, and the permitted Connect action remains accessible. | `IntegrationsView.test.tsx` |
| AC-IRUX-002 | Given a connected binding, when the card renders, then it says Connected and omits an absent connector identity; given ERPNext without a Company, then it explains activation is pending and directs an Admin to Company selection. | `IntegrationsView.test.tsx` |
| AC-IRUX-003 | Given one service's outbound-work status read fails and another service's read succeeds, when the page renders, then each card shows its own truthful state and the failed card offers Retry. | `IntegrationsView.test.tsx` |
| AC-IRUX-004 | Given a health result with or without a watermark, when the card renders, then it makes no last-success claim, labels outstanding outbound work accurately, and names the live record check needed to prove usable data. | `IntegrationsView.test.tsx` |
| AC-IRUX-005 | Given the Company read fails or returns zero Companies, when the picker opens, then it shows the matching recovery or empty state; if activation fails, then the selection survives. | `IntegrationsView.test.tsx` |
| AC-IRUX-006 | Given ClickUp binding or list data is unavailable, when the map renders, then unknown states are not presented as PMO-native and Retry is available. | `IntegrationsView.test.tsx` |
| AC-IRUX-007 | Given domain ownership is loading, unavailable, or empty, when the section renders, then a distinct state and Retry where relevant are visible. | `IntegrationsView.test.tsx` |
| AC-IRUX-008 | Given a disconnect failure, when the Admin confirms, then the dialog remains open with the failure and another attempt is possible. | `IntegrationsView.test.tsx` |
| AC-IRUX-009 | Given an organization change or successful connect, disconnect, or activation, when the query state is inspected, then health results are scoped to the active organization and refreshed by the mutation. | `useIntegrations.test.tsx` or dedicated query test |
| AC-IRUX-010 | Given an Admin or read-only viewer in English or Bahasa on a 390px screen, when they inspect the states, then the proper permitted controls, labels, and responsive layout remain usable. | unit i18n/role and rendered browser review |

## Operational acceptance outside CI

The RIS Admin signs in to the intended RIS organization, connects the services, selects ERPNext Company where required, moves or receives a known test record, and verifies its expected destination and state. Record the result privately. This live proof is required before calling the RIS integration operational.
