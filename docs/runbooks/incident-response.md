# Incident response runbook

## Detection

| Signal | Source | Owner action |
|---|---|---|
| System down / error spike | Telegram alert webhook (item 3 — BetterStack-pushed) | Acknowledge in channel; begin triage |
| Client reports outage | WhatsApp group | Corroborate with monitoring; open incident |
| Automated check failure | BetterStack status page check | Investigate immediately; mark incident |

**Binding rule:** Acknowledge within 15 minutes of any alert. Post a public incident message to the BetterStack status page within 30 minutes with initial severity estimate.

## Severity classification

| Severity | Definition | Example | Target resolution |
|---|---|---|---|
| **P0 - Critical** | Total outage; data loss risk; security breach | FE completely down; DB unreachable; auth broken | 1 hour |
| **P1 - High** | Major feature broken; significant UX degradation | Cannot create projects; write operations fail | 4 hours |
| **P2 - Medium** | Single feature down; workaround available | Reports page broken; export fails | 24 hours |
| **P3 - Low** | Cosmetic or non-blocking issue | Minor UI glitch; slow page load | Next release |

## Frontend rollback (Cloudflare Pages)

**Prerequisite:** a CF API token (not yet created — see `docs/environments.md` open follow-ups; interim: wrangler OAuth token from `~/Library/Preferences/.wrangler/config/default.toml`, it carries `pages:write`). Store as vault `AS` item `pmo-cloudflare-token` field `TOKEN` when created.

### Redeploy previous deployment (preferred)

```bash
# List recent deployments for client-ref
curl -X GET "https://api.cloudflare.com/client/v4/accounts/2484fdb1bc6a04e54853a2ff2ef91bbf/pages/projects/pmo/deployments" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result[:5] | .[] | {id: .id, created_on: .created_on, latest_stage: .latest_stage.stage}'

# Redeploy specific deployment hash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/2484fdb1bc6a04e54853a2ff2ef91bbf/pages/projects/pmo/deployments/<deployment-hash>/rollback" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### Revert production branch (fallback)

⚠ **Owner gate:** any push to `production` — including a rollback — requires a direct owner instruction (binding branch rule, CLAUDE.md). In a P0 with the owner unreachable, use the CF-API rollback above (it re-serves a prior build without touching git).

```bash
# From the repo (owner-instructed)
git fetch origin
git push origin <previous-production-sha>:production --force
# Cloudflare auto-builds within ~2 minutes
```

**Verification:** Access the public URL; confirm `<EnvBadge>` shows expected version; run login smoke check.

## Database restore (Supabase Cloud Pro)

**Prerequisite:** Pro tier client project (`<client-ref>`). Managed daily backups (7-day retention).

### Restore into scratch project (for recovery, NOT production)

1. Create scratch project in Supabase dashboard (`<client-ref>-scratch-restore-YYYYMMDDHHMM`).
2. Navigate: **Settings → Database → Backups**.
3. Select backup timestamp → **Restore** → **Restore to a new project**.
4. Wait for restore completion (typically 5–15 minutes depending on DB size).
5. Verify: run `select 1` via SQL Editor; check table counts match expected baseline.

### Point local FE at restored DB

```bash
# From pmo-portal/
# Create a local env override for the scratch project
cat >> .env.local << 'EOF'
VITE_SUPABASE_URL=https://<scratch-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<scratch-project-anon-key>
VITE_APP_ENV=restore-drill
EOF

npm run dev
# Confirm login works; verify core pages load
```

### Production restore (last resort — data loss event)

⚠ **Consult owner before restoring production.** This is destructive.

1. Dashboard: **Settings → Database → Backups**.
2. Select backup → **Restore** → **Restore to current project**.
3. Confirm typed project ref (safety check).
4. Production becomes read-only during restore (typically 1–5 minutes).
5. Post-restore: verify FE connectivity; run health checks.

**Binding rule:** Never restore production without explicit owner instruction. Prefer scratch-project restore for verification first.

## Edge function rollback

Supabase keeps no server-side function version history you can roll back to — rollback = redeploy the function source from a known-good git commit.

```bash
# From repo root
supabase login
supabase link --project-ref <client-ref>
supabase functions list --project-ref <client-ref>  # confirm what is deployed

# Redeploy from the known-good commit
git checkout <known-good-commit>
supabase functions deploy agent-chat compose-view agent-dispatch --project-ref <client-ref>
git checkout -  # return to current branch
```

**Verification:** Call `https://<client-ref>.supabase.co/functions/v1/agent-chat` with auth header; expect 2xx response. Check logs in Supabase dashboard (**Edge Functions → <name> → Logs**).

## Communications

### Client notification line

| Channel | Trigger | Template |
|---|---|---|
| WhatsApp group (per client) | P0/P1 incidents acknowledged | *"🚨 Incident declared: [brief description]. We're investigating. Status updates at <BetterStack URL>."* |
| WhatsApp group | Incident resolved | *"✅ Incident resolved: [summary]. Root cause: [one line]. Preventive actions: [one line]."* |

### Status page updates (BetterStack)

| State | When to set | Message pattern |
|---|---|---|
| **Degraded Performance** | P2 incident acknowledged | *"We're investigating reports of [feature] issues."* |
| **Partial Outage** | P1 incident acknowledged | *"Some features are unavailable. We're working on a fix."* |
| **Major Outage** | P0 incident acknowledged | *"We're experiencing a service interruption. Engineers are responding."* |
| **Operational** | Incident resolved | *"The issue has been resolved. Service is operating normally."* |

**Binding rule:** Update status page within 30 minutes of incident acknowledgment; within 15 minutes of resolution. Never post root cause details publicly until post-incident review is complete.

## Post-incident note template

Create file `docs/runbooks/incidents/YYYY-MM-DD-<client-ref>-<brief-slug>.md`:

```markdown
# Incident: YYYY-MM-DD <client-ref> — <brief description>

- **Severity:** P0 / P1 / P2 / P3
- **Duration:** <start time> → <end time> (<total minutes>)
- **Owner on-call:** <name>
- **Declared by:** <name>
- **Resolved by:** <name>

## Detection

<How was it detected? Monitoring, client report, internal check?>

## Impact

<What was broken? Which users affected? Data loss?>

## Root cause

<Technical root cause (one paragraph). Link to related issues/PRs if any.>

## Resolution steps

<Chronological steps taken. Include exact commands where applicable.>

## Preventive actions

<What will prevent recurrence? PRs, monitoring improvements, runbook updates?>

## RTO observed

<Time from detection to full restoration. Compare against SLA.>
```

**Binding rule:** Complete post-incident note within 24 hours of resolution. Review in next weekly ops sync.