# Batch B capture status

Integration head selected: `45b253aa1c077b1b902a7d0f0c376f7051cf9379`.

Captures: **0**. No screen was rendered, no role was signed in, and no sample records were created. There are no captured states.

The local stack could not start: Docker Hub rejected the required image pulls with its anonymous pull-rate limit after cleanup. Consequently the database reset, seed-account journeys and rendered proof could not run. `ux-proof.txt` records the proof command's startup failure; it is not a screen audit.

| Requested screens | Role used | States captured | Reason not reached |
| --- | --- | --- | --- |
| Purchasing: procurement list and record tabs, purchase order, site cash, expense claims list/new/detail, subcontract certificates and rate card | None | None | Local stack unavailable: Docker Hub image pull rate limit. |
| Stock: home, ledger, documents, opening, reorder, at risk, transfers and print, usage standards, setup | None | None | Local stack unavailable: Docker Hub image pull rate limit. |
| Material requests: list, new, detail and delivery note | None | None | Local stack unavailable: Docker Hub image pull rate limit. |
| Equipment: home, availability, machine, expiring, person, plans and monthly plan | None | None | Local stack unavailable: Docker Hub image pull rate limit. |
| Finance: hub, work in hand, billing board, billing plan, receivables, payables, opening balances and reports | None | None | Local stack unavailable: Docker Hub image pull rate limit. |
| Site reports, incidents, safety days and quantity changes | None | None | Local stack unavailable: Docker Hub image pull rate limit. |
| Administration: people, users, scheduled reports and all settings | None | None | Local stack unavailable: Docker Hub image pull rate limit. |
