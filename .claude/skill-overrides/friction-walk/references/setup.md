# Standing the app up for a walk

Setup is the one part of a walk that may read the repository. It ends at sign-in.

## The build

Walk the build that is about to reach people: the release branch before a release, `dev` otherwise.
Write the commit you walked at the top of the report.

## The data

- Local database: `scripts/with-db-lock.sh supabase start` (wedged under load:
  `scripts/supabase-start-lean.sh`). Reset only when the branch changes a migration or the seed.
- The seed organisation has no ERP connected. An ERP appears only through
  `pmo-portal/e2e/_connectScenario.ts`, which needs the ERP bed; a no-ERP walk needs nothing extra.
- Seeded logins and their roles: `supabase/seed.sql`; the shared password is `SEED_PASSWORD` in
  `pmo-portal/e2e/helpers.ts`.
- Data a job needs and the seed lacks (a claim ready to invoice, stock on a site) is created through
  the app as the role that would create it. That is part of the walk for that role: record its frictions.
  Use the service role only for what no role in the app can create, and say so in the report.
- Names are fictional. A walk never uses a client's name, people or figures.

## The app

`npm run dev` in `pmo-portal/`. It needs the worktree's local environment file, which
`scripts/e2e-local.sh` writes. A walker without one reports BLOCKED.

## The browser

Drive a real browser from the command line (Playwright or `agent-browser`). Set the viewport to
390 × 844 for the phone pass and 1440 × 900 for desktop. Change language the way the person would, from
the app's own language control.

## In a cloud sandbox

The database start that works there: start the Docker daemon with `sudo dockerd`, keep the Supabase
ports in 54320–54329, set `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`, then
`supabase start -x studio,realtime,vector`, up to four tries 60 seconds apart. Let `supabase start`
fetch its own images. If the fourth try fails, report NOT WALKED with the error; a table written
without a running app is not a walk.

## Where the report goes

Where the brief says. Screenshots sit beside the table, named `<job id>-<step>-<width>.png`.
