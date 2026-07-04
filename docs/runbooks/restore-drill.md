# Quarterly restore drill procedure

**Purpose:** Verify backup integrity and validate RTO by restoring a client's latest backup into a scratch Supabase project and smoke-checking the application.

**Frequency:** Quarterly (per client). First drill runs **after first client signing** (Pro tier billing activated).

**Prerequisites:**
- Supabase Cloud Pro tier active for `<client-ref>` (billing required for managed backups + scratch project creation)
- Local development environment set up (`supabase CLI`, `node` 22+, `pmo-portal` checked out)
- 1Password access to vault `AS` for secrets
- Estimated time: 30–45 minutes

---

## Step 1 — Confirm backup availability

```bash
# Via Supabase CLI (linked to client project)
supabase login
supabase link --project-ref <client-ref>
# ⚠ SESSION pooler, port 5432 — NEVER 6543 (transaction mode breaks dump/DDL; hard lesson in docs/environments.md).
# Pooler cluster (aws-0/aws-1) varies per project — copy the exact Session-pooler host from the project dashboard.
supabase db dump --db-url "postgresql://postgres.<client-ref>:[password]@<session-pooler-host>:5432/postgres" --schema public --file /dev/null
# If this succeeds, the connection is active; backups exist per Pro tier.

# Alternatively, verify via dashboard:
# Navigate to https://supabase.com/dashboard/project/<client-ref>/database/backups
# Confirm at least one automatic backup exists (daily, 7-day retention)
```

**Binding rule:** Never proceed if no backup exists. Escalate to Supabase support if missing.

---

## Step 2 — Create scratch project

1. Log in to [Supabase dashboard](https://supabase.com/dashboard).
2. Click **New Project** → **Create project**.
3. Name: `<client-ref>-scratch-restore-YYYYMMDD` (e.g., `acme-corp-scratch-restore-20260704`).
4. **Database Password:** Generate a strong password; store in 1Password (vault `AS`, item `pmo-supabase-scratch-<client-ref>`, field `URL`).
5. **Region:** Match client project (e.g., `Southeast Asia (Singapore)`).
6. **Pricing Plan:** Select **Pro** (required for restore-from-backup).
7. Click **Create new project**; wait for provisioning (~2–3 minutes).

**Binding rule:** Scratch project names must follow `<client-ref>-scratch-restore-YYYYMMDD` pattern for traceability.

---

## Step 3 — Restore backup into scratch project

### Via Supabase dashboard (preferred)

1. Navigate to the **client production project** dashboard (`https://supabase.com/dashboard/project/<client-ref>`).
2. Go to **Settings → Database → Backups**.
3. Identify the **most recent automatic backup** (timestamp within last 24 hours).
4. Click **Restore** → **Restore to a new project**.
5. Select the scratch project created in Step 2 (`<client-ref>-scratch-restore-YYYYMMDD`).
6. Confirm typed scratch project ref (safety check).
7. Click **Confirm restore**; wait for completion (5–15 minutes, depending on DB size).
8. Verify: navigate to scratch project **Table Editor**; confirm expected tables exist (e.g., `projects`, `companies`, `profiles`).

### Alternative: Point local FE at restored DB directly

After restore completes, configure local environment:

```bash
# From pmo-portal/
# Create local env override for the scratch project
cat > .env.local.drill << 'EOF'
VITE_SUPABASE_URL=https://<scratch-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<scratch-project-anon-key>
VITE_APP_ENV=restore-drill
EOF

# Activate drill env
cp .env.local.drill .env.local

# Verify connection
npm run dev
# Open browser to http://localhost:5173
# Confirm login page loads; check console for connection errors
```

---

## Step 4 — Smoke-check verification

Perform the following checks against the restored database. Record results in the table below.

### Check 1: Login authentication

| Action | Expected result | Actual result | Pass/Fail |
|---|---|---|---|
| Login with known Admin user (email + password) | Successful login; redirect to dashboard | | ☐ |
| Check `<EnvBadge>` shows `restore-drill` | Badge displays correct environment | | ☐ |

### Check 2: Core pages load

| Page | Expected result | Actual result | Pass/Fail |
|---|---|---|---|
| `/dashboard` | Dashboard loads with metrics | | ☐ |
| `/projects` | Projects list renders without error | | ☐ |
| `/procurement` | Procurement list renders without error | | ☐ |

### Check 3: Write operation validation

| Action | Expected result | Actual result | Pass/Fail |
|---|---|---|---|
| Create a test project (name: `DRILL-TEST-<timestamp>`) | Project created; appears in list | | ☐ |
| Delete test project | Project removed; no error | | ☐ |

**Binding rule:** All checks must pass. If any check fails, investigate and document the failure; escalate if backup integrity is in question.

---

## Step 5 — Record RTO observed

Calculate **Recovery Time Objective (RTO)** from start to successful smoke-check.

| Metric | Value |
|---|---|
| Drill start time | `YYYY-MM-DD HH:MM:SS` |
| Scratch project ready | `YYYY-MM-DD HH:MM:SS` |
| Backup restore completed | `YYYY-MM-DD HH:MM:SS` |
| Smoke-check passed | `YYYY-MM-DD HH:MM:SS` |
| **Total RTO observed** | `<minutes> minutes` |

**SLA baseline:** Target RTO ≤ 60 minutes for P0 incidents. If observed RTO exceeds this, document remediation plan.

---

## Step 6 — Cleanup

After drill completion, remove the scratch project to avoid billing charges.

### Via Supabase dashboard

1. Navigate to scratch project settings (`https://supabase.com/dashboard/project/<scratch-ref>/settings/general`).
2. Scroll to **Danger Zone** → **Pause project** → click **Pause project**.
3. After pause completes (~1 minute), click **Delete project** → **Delete project**.
4. Confirm typed project ref (safety check).
5. Remove the 1Password item (`pmo-supabase-scratch-<client-ref>`).

### Via Supabase CLI

```bash
supabase projects delete <scratch-ref>  # prompts for confirmation
# Remove 1Password entry manually
```

**Binding rule:** Never skip cleanup. Orphaned Pro projects accumulate billing charges.

---

## Checklist table (per drill)

| Step | Status | Notes |
|---|---|---|
| 1. Confirm backup availability | ☐ Pass / ☐ Fail | |
| 2. Create scratch project | ☐ Pass / ☐ Fail | Ref: `<scratch-ref>` |
| 3. Restore backup into scratch | ☐ Pass / ☐ Fail | Backup timestamp: `<timestamp>` |
| 4a. Login smoke-check | ☐ Pass / ☐ Fail | |
| 4b. Core pages load | ☐ Pass / ☐ Fail | |
| 4c. Write operation validates | ☐ Pass / ☐ Fail | |
| 5. RTO recorded | ☐ Pass / ☐ Fail | RTO: `<minutes>` min |
| 6. Scratch project deleted | ☐ Pass / ☐ Fail | |
| **Overall drill result** | ☐ **PASS** / ☐ **FAIL** | |

---

## Sign-off

**Completed by:** `<name>`  
**Date:** `YYYY-MM-DD`  
**Client:** `<client-ref>`  
**Next drill due:** `YYYY-MM-DD` (3 months from today)

**Owner review signature (if drill fails or RTO exceeds SLA):**  
`____________________________________________`  Date: `__________`

---

## Troubleshooting

| Symptom | Possible cause | Resolution |
|---|---|---|
| Restore button disabled in dashboard | Free tier project (no backups) | Upgrade to Pro tier before drill |
| Restore stuck at "In progress" | Large DB; temporary Supabase load | Wait up to 30 minutes; contact support if stuck |
| Login fails with "Invalid login credentials" | Auth.users not restored in backup | Verify backup includes `auth` schema; contact Supabase support |
| FE shows 404 on all routes | SPA routing broken; `_redirects` missing | Confirm `public/_redirects` exists in deployed build |
| Write operation fails with 42501 | RLS policy mismatch after restore | Compare RLS policies between production and scratch; re-run migrations if needed |

**Binding rule:** If restore fails completely, do **not** delete the scratch project. Preserve it for Supabase support investigation. Escalate immediately.