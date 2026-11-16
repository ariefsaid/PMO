# Layout baseline

Failure fingerprints of the rendered layout checks (`measureLayout` in `scripts/ux-proof-metrics.mjs` and the reused taste and stageshow checks) per route, width and login.
The counts here are for reading only; `layout-baseline.json` lists the fingerprints, and the gate fails on any fingerprint that is not listed there.
Shrink-only: a touched route may not gain a fingerprint, and a route under redesign must reach none. Regenerate with `scripts/ux-proof-layout-sweep.sh`.

| Route | Login | Width | Fingerprints |
| --- | --- | --- | --- |
| `/` | admin@acme.test | 1440 | 8 |
| `/` | engineer@acme.test | 1440 | 7 |
| `/` | exec@acme.test | 1440 | 7 |
| `/` | exec@acme.test reads-failing | 1440 | 7 |
| `/` | finance@acme.test | 1440 | 11 |
| `/` | pm@acme.test | 1440 | 3 |
| `/` | admin@acme.test | 390 | 11 |
| `/` | engineer@acme.test | 390 | 4 |
| `/` | exec@acme.test | 390 | 11 |
| `/` | exec@acme.test reads-failing | 390 | 10 |
| `/` | finance@acme.test | 390 | 13 |
| `/` | pm@acme.test | 390 | 3 |
| `/administration/accounting` | admin@acme.test | 1440 | 6 |
| `/administration/accounting` | admin@acme.test | 390 | 7 |
| `/administration/cost-attribution` | admin@acme.test | 1440 | 1 |
| `/administration/cost-attribution` | finance@acme.test | 1440 | 1 |
| `/administration/cost-attribution` | admin@acme.test | 390 | 0 |
| `/administration/cost-attribution` | finance@acme.test | 390 | 0 |
| `/administration/credits` | admin@acme.test | 1440 | 0 |
| `/administration/credits` | admin@acme.test | 390 | 0 |
| `/administration/exchange-rates` | admin@acme.test | 1440 | 1 |
| `/administration/exchange-rates` | finance@acme.test | 1440 | 0 |
| `/administration/exchange-rates` | admin@acme.test | 390 | 1 |
| `/administration/exchange-rates` | finance@acme.test | 390 | 0 |
| `/administration/integrations` | admin@acme.test | 1440 | 12 |
| `/administration/integrations` | admin@acme.test | 390 | 11 |
| `/administration/plan` | admin@acme.test | 1440 | 0 |
| `/administration/plan` | exec@acme.test | 1440 | 0 |
| `/administration/plan` | exec@acme.test reads-failing | 1440 | 0 |
| `/administration/plan` | admin@acme.test | 390 | 0 |
| `/administration/plan` | exec@acme.test | 390 | 0 |
| `/administration/plan` | exec@acme.test reads-failing | 390 | 0 |
| `/administration/projects` | admin@acme.test | 1440 | 2 |
| `/administration/projects` | admin@acme.test | 390 | 2 |
| `/administration/users` | admin@acme.test | 1440 | 0 |
| `/administration/users` | exec@acme.test | 1440 | 0 |
| `/administration/users` | exec@acme.test reads-failing | 1440 | 0 |
| `/administration/users` | admin@acme.test | 390 | 0 |
| `/administration/users` | exec@acme.test | 390 | 0 |
| `/administration/users` | exec@acme.test reads-failing | 390 | 0 |
| `/approvals` | exec@acme.test | 1440 | 6 |
| `/approvals` | exec@acme.test reads-failing | 1440 | 3 |
| `/approvals` | finance@acme.test | 1440 | 6 |
| `/approvals` | pm@acme.test | 1440 | 3 |
| `/approvals` | exec@acme.test | 390 | 5 |
| `/approvals` | exec@acme.test reads-failing | 390 | 3 |
| `/approvals` | finance@acme.test | 390 | 5 |
| `/approvals` | pm@acme.test | 390 | 8 |
| `/calendar` | engineer@acme.test | 1440 | 5 |
| `/calendar` | exec@acme.test | 1440 | 5 |
| `/calendar` | exec@acme.test reads-failing | 1440 | 1 |
| `/calendar` | pm@acme.test | 1440 | 5 |
| `/calendar` | engineer@acme.test | 390 | 3 |
| `/calendar` | exec@acme.test | 390 | 3 |
| `/calendar` | exec@acme.test reads-failing | 390 | 1 |
| `/calendar` | pm@acme.test | 390 | 3 |
| `/companies` | exec@acme.test | 1440 | 0 |
| `/companies` | exec@acme.test reads-failing | 1440 | 0 |
| `/companies` | finance@acme.test | 1440 | 0 |
| `/companies` | exec@acme.test | 390 | 0 |
| `/companies` | exec@acme.test reads-failing | 390 | 0 |
| `/companies` | finance@acme.test | 390 | 0 |
| `/companies/c0000000-0000-0000-0000-000000000002` | exec@acme.test | 1440 | 12 |
| `/companies/c0000000-0000-0000-0000-000000000002` | exec@acme.test reads-failing | 1440 | 0 |
| `/companies/c0000000-0000-0000-0000-000000000002` | exec@acme.test | 390 | 11 |
| `/companies/c0000000-0000-0000-0000-000000000002` | exec@acme.test reads-failing | 390 | 0 |
| `/contacts` | exec@acme.test | 1440 | 0 |
| `/contacts` | exec@acme.test reads-failing | 1440 | 0 |
| `/contacts` | exec@acme.test | 390 | 0 |
| `/contacts` | exec@acme.test reads-failing | 390 | 0 |
| `/contacts/ce000000-0000-0000-0000-000000000001` | exec@acme.test | 1440 | 5 |
| `/contacts/ce000000-0000-0000-0000-000000000001` | exec@acme.test reads-failing | 1440 | 0 |
| `/contacts/ce000000-0000-0000-0000-000000000001` | exec@acme.test | 390 | 3 |
| `/contacts/ce000000-0000-0000-0000-000000000001` | exec@acme.test reads-failing | 390 | 0 |
| `/equipment` | engineer@acme.test | 1440 | 0 |
| `/equipment` | exec@acme.test | 1440 | 1 |
| `/equipment` | exec@acme.test reads-failing | 1440 | 1 |
| `/equipment` | pm@acme.test | 1440 | 1 |
| `/equipment` | engineer@acme.test | 390 | 0 |
| `/equipment` | exec@acme.test | 390 | 1 |
| `/equipment` | exec@acme.test reads-failing | 390 | 1 |
| `/equipment` | pm@acme.test | 390 | 1 |
| `/equipment/assets` | pm@acme.test | 1440 | 1 |
| `/equipment/assets` | pm@acme.test | 390 | 0 |
| `/erp-purchases` | finance@acme.test | 1440 | 2 |
| `/erp-purchases` | finance@acme.test | 390 | 2 |
| `/expenses` | engineer@acme.test | 1440 | 1 |
| `/expenses` | exec@acme.test | 1440 | 1 |
| `/expenses` | exec@acme.test reads-failing | 1440 | 0 |
| `/expenses` | finance@acme.test | 1440 | 1 |
| `/expenses` | pm@acme.test | 1440 | 1 |
| `/expenses` | engineer@acme.test | 390 | 0 |
| `/expenses` | exec@acme.test | 390 | 0 |
| `/expenses` | exec@acme.test reads-failing | 390 | 0 |
| `/expenses` | finance@acme.test | 390 | 0 |
| `/expenses` | pm@acme.test | 390 | 0 |
| `/expenses/2b00c401-3303-4aa5-b033-4dc3f33e52f8` | engineer@acme.test | 1440 | 0 |
| `/expenses/2b00c401-3303-4aa5-b033-4dc3f33e52f8` | engineer@acme.test | 390 | 0 |
| `/expenses/b1336ef9-e2df-42cb-9baf-c5d23a125c3f` | engineer@acme.test | 1440 | 0 |
| `/expenses/b1336ef9-e2df-42cb-9baf-c5d23a125c3f` | engineer@acme.test | 390 | 0 |
| `/expenses/new` | engineer@acme.test | 1440 | 1 |
| `/expenses/new` | pm@acme.test | 1440 | 1 |
| `/expenses/new` | engineer@acme.test | 390 | 1 |
| `/expenses/new` | pm@acme.test | 390 | 1 |
| `/finance` | exec@acme.test | 1440 | 9 |
| `/finance` | exec@acme.test reads-failing | 1440 | 4 |
| `/finance` | finance@acme.test | 1440 | 9 |
| `/finance` | exec@acme.test | 390 | 8 |
| `/finance` | exec@acme.test reads-failing | 390 | 2 |
| `/finance` | finance@acme.test | 390 | 8 |
| `/finance/payables` | exec@acme.test | 1440 | 1 |
| `/finance/payables` | exec@acme.test reads-failing | 1440 | 0 |
| `/finance/payables` | finance@acme.test | 1440 | 1 |
| `/finance/payables` | exec@acme.test | 390 | 1 |
| `/finance/payables` | exec@acme.test reads-failing | 390 | 0 |
| `/finance/payables` | finance@acme.test | 390 | 1 |
| `/finance/receivables` | exec@acme.test | 1440 | 1 |
| `/finance/receivables` | exec@acme.test reads-failing | 1440 | 0 |
| `/finance/receivables` | finance@acme.test | 1440 | 1 |
| `/finance/receivables` | exec@acme.test | 390 | 2 |
| `/finance/receivables` | exec@acme.test reads-failing | 390 | 1 |
| `/finance/receivables` | finance@acme.test | 390 | 2 |
| `/finance/receivables?view=payments` | exec@acme.test | 1440 | 1 |
| `/finance/receivables?view=payments` | exec@acme.test reads-failing | 1440 | 0 |
| `/finance/receivables?view=payments` | finance@acme.test | 1440 | 1 |
| `/finance/receivables?view=payments` | exec@acme.test | 390 | 2 |
| `/finance/receivables?view=payments` | exec@acme.test reads-failing | 390 | 1 |
| `/finance/receivables?view=payments` | finance@acme.test | 390 | 2 |
| `/finance/reports` | exec@acme.test | 1440 | 1 |
| `/finance/reports` | exec@acme.test reads-failing | 1440 | 0 |
| `/finance/reports` | finance@acme.test | 1440 | 1 |
| `/finance/reports` | exec@acme.test | 390 | 3 |
| `/finance/reports` | exec@acme.test reads-failing | 390 | 0 |
| `/finance/reports` | finance@acme.test | 390 | 3 |
| `/finance/statements` | exec@acme.test | 1440 | 2 |
| `/finance/statements` | exec@acme.test reads-failing | 1440 | 0 |
| `/finance/statements` | finance@acme.test | 1440 | 2 |
| `/finance/statements` | exec@acme.test | 390 | 1 |
| `/finance/statements` | exec@acme.test reads-failing | 390 | 0 |
| `/finance/statements` | finance@acme.test | 390 | 1 |
| `/imprest` | exec@acme.test | 1440 | 1 |
| `/imprest` | exec@acme.test reads-failing | 1440 | 0 |
| `/imprest` | finance@acme.test | 1440 | 1 |
| `/imprest` | exec@acme.test | 390 | 0 |
| `/imprest` | exec@acme.test reads-failing | 390 | 0 |
| `/imprest` | finance@acme.test | 390 | 0 |
| `/incidents` | engineer@acme.test | 1440 | 0 |
| `/incidents` | exec@acme.test | 1440 | 0 |
| `/incidents` | exec@acme.test reads-failing | 1440 | 0 |
| `/incidents` | engineer@acme.test | 390 | 0 |
| `/incidents` | exec@acme.test | 390 | 0 |
| `/incidents` | exec@acme.test reads-failing | 390 | 0 |
| `/incoming-payments` | exec@acme.test | 1440 | 1 |
| `/incoming-payments` | exec@acme.test reads-failing | 1440 | 0 |
| `/incoming-payments` | finance@acme.test | 1440 | 1 |
| `/incoming-payments` | exec@acme.test | 390 | 2 |
| `/incoming-payments` | exec@acme.test reads-failing | 390 | 1 |
| `/incoming-payments` | finance@acme.test | 390 | 2 |
| `/integrations` | admin@acme.test | 1440 | 1 |
| `/integrations` | engineer@acme.test | 1440 | 1 |
| `/integrations` | exec@acme.test | 1440 | 1 |
| `/integrations` | exec@acme.test reads-failing | 1440 | 1 |
| `/integrations` | finance@acme.test | 1440 | 1 |
| `/integrations` | pm@acme.test | 1440 | 1 |
| `/integrations` | admin@acme.test | 390 | 1 |
| `/integrations` | engineer@acme.test | 390 | 1 |
| `/integrations` | exec@acme.test | 390 | 1 |
| `/integrations` | exec@acme.test reads-failing | 390 | 1 |
| `/integrations` | finance@acme.test | 390 | 1 |
| `/integrations` | pm@acme.test | 390 | 1 |
| `/login` | exec@acme.test | 1440 | 0 |
| `/login` | exec@acme.test reads-failing | 1440 | 0 |
| `/login` | exec@acme.test | 390 | 0 |
| `/login` | exec@acme.test reads-failing | 390 | 0 |
| `/master-data/product` | admin@acme.test | 1440 | 0 |
| `/master-data/product` | admin@acme.test | 390 | 0 |
| `/meetings` | engineer@acme.test | 1440 | 0 |
| `/meetings` | exec@acme.test | 1440 | 0 |
| `/meetings` | exec@acme.test reads-failing | 1440 | 0 |
| `/meetings` | pm@acme.test | 1440 | 0 |
| `/meetings` | engineer@acme.test | 390 | 0 |
| `/meetings` | exec@acme.test | 390 | 0 |
| `/meetings` | exec@acme.test reads-failing | 390 | 0 |
| `/meetings` | pm@acme.test | 390 | 0 |
| `/meetings/ee000000-0000-0000-0000-000000000001` | pm@acme.test | 1440 | 4 |
| `/meetings/ee000000-0000-0000-0000-000000000001` | pm@acme.test | 390 | 2 |
| `/meetings/new` | pm@acme.test | 1440 | 0 |
| `/meetings/new` | pm@acme.test | 390 | 1 |
| `/my-tasks` | engineer@acme.test | 1440 | 4 |
| `/my-tasks` | finance@acme.test | 1440 | 0 |
| `/my-tasks` | pm@acme.test | 1440 | 3 |
| `/my-tasks` | engineer@acme.test | 390 | 4 |
| `/my-tasks` | finance@acme.test | 390 | 0 |
| `/my-tasks` | pm@acme.test | 390 | 3 |
| `/oauth/consent` | exec@acme.test | 1440 | 1 |
| `/oauth/consent` | exec@acme.test reads-failing | 1440 | 1 |
| `/oauth/consent` | exec@acme.test | 390 | 1 |
| `/oauth/consent` | exec@acme.test reads-failing | 390 | 1 |
| `/procurement` | engineer@acme.test | 1440 | 1 |
| `/procurement` | exec@acme.test | 1440 | 2 |
| `/procurement` | exec@acme.test reads-failing | 1440 | 1 |
| `/procurement` | finance@acme.test | 1440 | 2 |
| `/procurement` | pm@acme.test | 1440 | 2 |
| `/procurement` | engineer@acme.test | 390 | 1 |
| `/procurement` | exec@acme.test | 390 | 1 |
| `/procurement` | exec@acme.test reads-failing | 390 | 1 |
| `/procurement` | finance@acme.test | 390 | 1 |
| `/procurement` | pm@acme.test | 390 | 1 |
| `/procurement/00000000-0000-0000-0000-000000000002` | exec@acme.test | 1440 | 0 |
| `/procurement/00000000-0000-0000-0000-000000000002` | exec@acme.test reads-failing | 1440 | 0 |
| `/procurement/00000000-0000-0000-0000-000000000002` | pm@acme.test | 1440 | 0 |
| `/procurement/00000000-0000-0000-0000-000000000002` | exec@acme.test | 390 | 0 |
| `/procurement/00000000-0000-0000-0000-000000000002` | exec@acme.test reads-failing | 390 | 0 |
| `/procurement/00000000-0000-0000-0000-000000000002` | pm@acme.test | 390 | 0 |
| `/procurement/00000000-0000-0000-0000-000000000008` | finance@acme.test | 1440 | 0 |
| `/procurement/00000000-0000-0000-0000-000000000008` | finance@acme.test | 390 | 0 |
| `/procurement/3971b0a9-8043-4615-ab54-cbb35013b477` | pm@acme.test | 1440 | 0 |
| `/procurement/3971b0a9-8043-4615-ab54-cbb35013b477` | pm@acme.test | 390 | 0 |
| `/procurement/60000000-0000-0000-0000-000000000008` | finance@acme.test | 1440 | 3 |
| `/procurement/60000000-0000-0000-0000-000000000008` | finance@acme.test | 390 | 6 |
| `/procurement/61000000-0000-0000-0000-000000000002` | exec@acme.test | 1440 | 3 |
| `/procurement/61000000-0000-0000-0000-000000000002` | exec@acme.test reads-failing | 1440 | 0 |
| `/procurement/61000000-0000-0000-0000-000000000002` | pm@acme.test | 1440 | 3 |
| `/procurement/61000000-0000-0000-0000-000000000002` | exec@acme.test | 390 | 2 |
| `/procurement/61000000-0000-0000-0000-000000000002` | exec@acme.test reads-failing | 390 | 0 |
| `/procurement/61000000-0000-0000-0000-000000000002` | pm@acme.test | 390 | 7 |
| `/procurement/61000000-0000-0000-0000-000000000008` | exec@acme.test | 1440 | 6 |
| `/procurement/61000000-0000-0000-0000-000000000008` | exec@acme.test reads-failing | 1440 | 0 |
| `/procurement/61000000-0000-0000-0000-000000000008` | exec@acme.test | 390 | 5 |
| `/procurement/61000000-0000-0000-0000-000000000008` | exec@acme.test reads-failing | 390 | 0 |
| `/procurement/new` | pm@acme.test | 1440 | 0 |
| `/procurement/new` | pm@acme.test | 390 | 0 |
| `/procurement/new?have=need` | finance@acme.test | 1440 | 2 |
| `/procurement/new?have=need` | pm@acme.test | 1440 | 2 |
| `/procurement/new?have=need` | finance@acme.test | 390 | 2 |
| `/procurement/new?have=need` | pm@acme.test | 390 | 2 |
| `/projects` | admin@acme.test | 1440 | 0 |
| `/projects` | engineer@acme.test | 1440 | 1 |
| `/projects` | exec@acme.test | 1440 | 0 |
| `/projects` | exec@acme.test reads-failing | 1440 | 0 |
| `/projects` | finance@acme.test | 1440 | 0 |
| `/projects` | pm@acme.test | 1440 | 0 |
| `/projects` | admin@acme.test | 390 | 0 |
| `/projects` | engineer@acme.test | 390 | 0 |
| `/projects` | exec@acme.test | 390 | 0 |
| `/projects` | exec@acme.test reads-failing | 390 | 0 |
| `/projects` | finance@acme.test | 390 | 0 |
| `/projects` | pm@acme.test | 390 | 0 |
| `/projects/41000000-0000-0000-0000-000000000002` | admin@acme.test | 1440 | 3 |
| `/projects/41000000-0000-0000-0000-000000000002` | engineer@acme.test | 1440 | 3 |
| `/projects/41000000-0000-0000-0000-000000000002` | exec@acme.test | 1440 | 3 |
| `/projects/41000000-0000-0000-0000-000000000002` | exec@acme.test reads-failing | 1440 | 0 |
| `/projects/41000000-0000-0000-0000-000000000002` | finance@acme.test | 1440 | 3 |
| `/projects/41000000-0000-0000-0000-000000000002` | pm@acme.test | 1440 | 3 |
| `/projects/41000000-0000-0000-0000-000000000002` | admin@acme.test | 390 | 2 |
| `/projects/41000000-0000-0000-0000-000000000002` | engineer@acme.test | 390 | 3 |
| `/projects/41000000-0000-0000-0000-000000000002` | exec@acme.test | 390 | 2 |
| `/projects/41000000-0000-0000-0000-000000000002` | exec@acme.test reads-failing | 390 | 0 |
| `/projects/41000000-0000-0000-0000-000000000002` | finance@acme.test | 390 | 3 |
| `/projects/41000000-0000-0000-0000-000000000002` | pm@acme.test | 390 | 2 |
| `/projects/41000000-0000-0000-0000-000000000002/activity` | pm@acme.test | 1440 | 3 |
| `/projects/41000000-0000-0000-0000-000000000002/activity` | pm@acme.test | 390 | 2 |
| `/projects/41000000-0000-0000-0000-000000000002/budget` | exec@acme.test | 1440 | 5 |
| `/projects/41000000-0000-0000-0000-000000000002/budget` | exec@acme.test reads-failing | 1440 | 0 |
| `/projects/41000000-0000-0000-0000-000000000002/budget` | finance@acme.test | 1440 | 5 |
| `/projects/41000000-0000-0000-0000-000000000002/budget` | pm@acme.test | 1440 | 5 |
| `/projects/41000000-0000-0000-0000-000000000002/budget` | exec@acme.test | 390 | 4 |
| `/projects/41000000-0000-0000-0000-000000000002/budget` | exec@acme.test reads-failing | 390 | 0 |
| `/projects/41000000-0000-0000-0000-000000000002/budget` | finance@acme.test | 390 | 4 |
| `/projects/41000000-0000-0000-0000-000000000002/budget` | pm@acme.test | 390 | 4 |
| `/projects/41000000-0000-0000-0000-000000000002/contract` | finance@acme.test | 1440 | 26 |
| `/projects/41000000-0000-0000-0000-000000000002/contract` | pm@acme.test | 1440 | 7 |
| `/projects/41000000-0000-0000-0000-000000000002/contract` | finance@acme.test | 390 | 24 |
| `/projects/41000000-0000-0000-0000-000000000002/contract` | pm@acme.test | 390 | 5 |
| `/projects/41000000-0000-0000-0000-000000000002/documents` | pm@acme.test | 1440 | 1 |
| `/projects/41000000-0000-0000-0000-000000000002/documents` | pm@acme.test | 390 | 0 |
| `/projects/41000000-0000-0000-0000-000000000002/materials` | pm@acme.test | 1440 | 6 |
| `/projects/41000000-0000-0000-0000-000000000002/materials` | pm@acme.test | 390 | 5 |
| `/projects/41000000-0000-0000-0000-000000000002/procurement` | pm@acme.test | 1440 | 1 |
| `/projects/41000000-0000-0000-0000-000000000002/procurement` | pm@acme.test | 390 | 0 |
| `/projects/41000000-0000-0000-0000-000000000002/tasks` | engineer@acme.test | 1440 | 2 |
| `/projects/41000000-0000-0000-0000-000000000002/tasks` | pm@acme.test | 1440 | 2 |
| `/projects/41000000-0000-0000-0000-000000000002/tasks` | engineer@acme.test | 390 | 2 |
| `/projects/41000000-0000-0000-0000-000000000002/tasks` | pm@acme.test | 390 | 2 |
| `/projects/41000000-0000-0000-0000-000000000002/tasks?view=board&scope=all` | pm@acme.test | 1440 | 3 |
| `/projects/41000000-0000-0000-0000-000000000002/tasks?view=board&scope=all` | pm@acme.test | 390 | 4 |
| `/projects/new` | exec@acme.test | 1440 | 3 |
| `/projects/new` | exec@acme.test reads-failing | 1440 | 3 |
| `/projects/new` | pm@acme.test | 1440 | 3 |
| `/projects/new` | exec@acme.test | 390 | 1 |
| `/projects/new` | exec@acme.test reads-failing | 390 | 1 |
| `/projects/new` | pm@acme.test | 390 | 1 |
| `/receivables?view=payments` | finance@acme.test | 1440 | 0 |
| `/receivables?view=payments` | finance@acme.test | 390 | 0 |
| `/reset-password` | exec@acme.test | 1440 | 1 |
| `/reset-password` | exec@acme.test reads-failing | 1440 | 1 |
| `/reset-password` | exec@acme.test | 390 | 1 |
| `/reset-password` | exec@acme.test reads-failing | 390 | 1 |
| `/sales` | exec@acme.test | 1440 | 2 |
| `/sales` | exec@acme.test reads-failing | 1440 | 0 |
| `/sales` | pm@acme.test | 1440 | 2 |
| `/sales` | exec@acme.test | 390 | 7 |
| `/sales` | exec@acme.test reads-failing | 390 | 0 |
| `/sales` | pm@acme.test | 390 | 7 |
| `/sales-invoices/b5000000-0000-0000-0000-000000000001` | exec@acme.test | 1440 | 2 |
| `/sales-invoices/b5000000-0000-0000-0000-000000000001` | exec@acme.test reads-failing | 1440 | 0 |
| `/sales-invoices/b5000000-0000-0000-0000-000000000001` | finance@acme.test | 1440 | 3 |
| `/sales-invoices/b5000000-0000-0000-0000-000000000001` | exec@acme.test | 390 | 2 |
| `/sales-invoices/b5000000-0000-0000-0000-000000000001` | exec@acme.test reads-failing | 390 | 0 |
| `/sales-invoices/b5000000-0000-0000-0000-000000000001` | finance@acme.test | 390 | 3 |
| `/settings/profile` | admin@acme.test | 1440 | 2 |
| `/settings/profile` | engineer@acme.test | 1440 | 2 |
| `/settings/profile` | finance@acme.test | 1440 | 2 |
| `/settings/profile` | pm@acme.test | 1440 | 2 |
| `/settings/profile` | admin@acme.test | 390 | 0 |
| `/settings/profile` | engineer@acme.test | 390 | 0 |
| `/settings/profile` | finance@acme.test | 390 | 0 |
| `/settings/profile` | pm@acme.test | 390 | 0 |
| `/stock` | engineer@acme.test | 1440 | 0 |
| `/stock` | exec@acme.test | 1440 | 0 |
| `/stock` | exec@acme.test reads-failing | 1440 | 0 |
| `/stock` | pm@acme.test | 1440 | 0 |
| `/stock` | engineer@acme.test | 390 | 0 |
| `/stock` | exec@acme.test | 390 | 0 |
| `/stock` | exec@acme.test reads-failing | 390 | 0 |
| `/stock` | pm@acme.test | 390 | 0 |
| `/stock/documents` | pm@acme.test | 1440 | 0 |
| `/stock/documents` | pm@acme.test | 390 | 0 |
| `/stock/ledger` | pm@acme.test | 1440 | 0 |
| `/stock/ledger` | pm@acme.test | 390 | 0 |
| `/stock/new/receive` | pm@acme.test | 1440 | 0 |
| `/stock/new/receive` | pm@acme.test | 390 | 0 |
| `/stock/reorder` | pm@acme.test | 1440 | 2 |
| `/stock/reorder` | pm@acme.test | 390 | 1 |
| `/stock/setup` | pm@acme.test | 1440 | 1 |
| `/stock/setup` | pm@acme.test | 390 | 2 |
| `/timesheets` | engineer@acme.test | 1440 | 1 |
| `/timesheets` | exec@acme.test | 1440 | 2 |
| `/timesheets` | exec@acme.test reads-failing | 1440 | 0 |
| `/timesheets` | finance@acme.test | 1440 | 0 |
| `/timesheets` | pm@acme.test | 1440 | 1 |
| `/timesheets` | engineer@acme.test | 390 | 6 |
| `/timesheets` | exec@acme.test | 390 | 1 |
| `/timesheets` | exec@acme.test reads-failing | 390 | 0 |
| `/timesheets` | finance@acme.test | 390 | 1 |
| `/timesheets` | pm@acme.test | 390 | 7 |
| `/update-password` | exec@acme.test | 1440 | 2 |
| `/update-password` | exec@acme.test reads-failing | 1440 | 2 |
| `/update-password` | exec@acme.test | 390 | 2 |
| `/update-password` | exec@acme.test reads-failing | 390 | 2 |

Routes measured: 72. Routes with failures: 52. Total fingerprints: 663.
