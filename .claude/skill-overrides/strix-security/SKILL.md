---
name: strix-security
description: Security review references from Strix (usestrix/strix, Apache-2.0) — vulnerability, Supabase, LLM-agent and evidence-discipline modules. Use when reviewing a diff or a release for security; read-only review, no live exploitation.
---

# Strix security references

Strix's security-testing skills, vendored as **review references** (owner 2026-10-16: use the skills, not the Strix agent or service). Each reviewer reads the modules that match what the diff touches, then reviews the code and the local DB at head.

## Rules

- **Read-only review.** Do not run Strix, exploit, fuzz or send traffic to any non-local host. A proof may use the local stack only (pgTAP, `scripts/with-db-lock.sh`, local PostgREST on 127.0.0.1).
- **Evidence discipline first:** read `references/analysis/counterevidence.md` and `severity_calibration.md` before writing findings. Every candidate ends **confirmed**, **ruled out** (name the control and file:line, and show it runs before the effect on the attacker's path) or **open proof gap**.
- **Deciding artifacts, not claims:** `pg_policies` and `role_table_grants` at head decide reachability, not the migration text (CLAUDE.md).
- **Public repo:** an unfixed weakness never goes into a tracked file, issue or PR. Use a private advisory or `docs/private/`.

## Which module for which change

| The diff touches | Read |
|---|---|
| Any table, RLS policy, RPC, storage, edge function | `references/stack/supabase.md` |
| Per-record access, ids in URLs/RPC args | `references/vulnerabilities/idor.md`, `broken_function_level_authorization.md` |
| Inserts/updates from client payloads | `mass_assignment.md` |
| Money flows, approvals, status transitions, SoD | `business_logic.md`, `race_conditions.md` |
| Login, JWT, sessions, OAuth/connectors (ERP, M365, ClickUp) | `authentication_jwt.md`, `references/stack/oauth.md`, `csrf.md` |
| Integration URLs, webhooks, server-side fetches | `ssrf.md`, `header_injection.md`, `open_redirect.md` |
| Raw SQL, dynamic filters | `sql_injection.md`, `argument_injection.md` |
| Rendering user/ERP text, rich text, markdown | `xss.md`, `prototype_pollution.md` |
| File/document links and uploads | `insecure_file_uploads.md`, `path_traversal_lfi_rfi.md` |
| Errors, logs, exports, counts | `information_disclosure.md` |
| The assistant/agent surface | `llm_prompt_injection.md`, `agentic_system_security.md`, `references/stack/llm_applications.md` |
| Dependencies, lockfile, npx scripts | `references/stack/dependency_cve_scanning.md`, `npx_confusion.md` |
| A whole release diff | `references/stack/diff.md`, `source_aware_whitebox.md`, `source_aware_sast.md`, plus every row above that the diff touches |
| Verifying a fix | `references/analysis/fix_verification.md` |

## Output

Per finding: id, severity (calibrated after reachability), closure state, evidence (traced source → control → sink, or the local proof), fix. Then a coverage table with an explicit "not assessed" row for every module above that applies but was not checked.
