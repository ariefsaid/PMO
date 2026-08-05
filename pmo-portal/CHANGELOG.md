# Changelog

All notable changes to PMO Portal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
**ADR-0042** (SemVer, pre-1.0 while single-tenant MVP). A version is minted on **`main`** (the
release-please flow — amended 2026-07-08, was `main → production`) and git-tagged `vX.Y.Z` on the
`main` commit; `main → production` then deploys an already-tagged commit.

Each released section pins the full deploy manifest (app sha · DB migration high-water ·
edge-function state) so "what's in production" is unambiguous. The DB schema version (migration
high-water mark) moves independently of the product tag.

## [0.10.0](https://github.com/ariefsaid/PMO/compare/v0.9.0...v0.10.0) (2026-08-05)


### Features

* **m365:** three-step connection model — operator entitles, client admin approves, each user connects ([#428](https://github.com/ariefsaid/PMO/issues/428)) ([47bfab7](https://github.com/ariefsaid/PMO/commit/47bfab78b800d5f74b66c956884db78908e5bc46))

## [0.9.0](https://github.com/ariefsaid/PMO/compare/v0.8.0...v0.9.0) (2026-07-31)


### Features

* **analytics:** friction instrumentation, demo funnel, quota alarm, tile gate ([#399](https://github.com/ariefsaid/PMO/issues/399)) ([fee361a](https://github.com/ariefsaid/PMO/commit/fee361a6617bca8ee0b85be3007ce86a82e65a08))
* **analytics:** PostHog signal config + consent (opt-out, DNT, disclosure) ([#398](https://github.com/ariefsaid/PMO/issues/398)) ([b1c8f1a](https://github.com/ariefsaid/PMO/commit/b1c8f1a3d17654fd6cc2fd0afd80f8cae5f62547))
* **obs:** pipeline self-report + error_events retention ([#403](https://github.com/ariefsaid/PMO/issues/403)) ([a844d99](https://github.com/ariefsaid/PMO/commit/a844d9916fd5d4fc01c82d371a652ca7d3d11e48))


### Bug Fixes

* **agent:** stop the compaction re-query loop that hit the step limit with no answer ([#410](https://github.com/ariefsaid/PMO/issues/410)) ([5cb134c](https://github.com/ariefsaid/PMO/commit/5cb134cbb1a70bbc0767de3e6e0fbba7b7b02c99))
* **alerting:** write-ahead alert log — bound the re-alert loop without dropping alerts ([#400](https://github.com/ariefsaid/PMO/issues/400)) ([8c9f637](https://github.com/ariefsaid/PMO/commit/8c9f63702a683ec55ab3dcb961b81aa7d674ad21))
* **ci:** NUL bytes make three source files invisible to grep ([#394](https://github.com/ariefsaid/PMO/issues/394)) ([5f9fb7e](https://github.com/ariefsaid/PMO/commit/5f9fb7e8e03b15fda76b75dcc5c3f697f9db8a2a))
* **docs:** resolve ADR-0037 mis-cite — land monochrome-calm design ADR as 0068 ([#395](https://github.com/ariefsaid/PMO/issues/395)) ([782caa2](https://github.com/ariefsaid/PMO/commit/782caa20fe19b3825302431cbd7c7beab7f56489))
* **e2e:** un-quarantine AC-IXD-TS-W5-3 — drive the stacked fallback (small viewport) ([#405](https://github.com/ariefsaid/PMO/issues/405)) ([cb79f6e](https://github.com/ariefsaid/PMO/commit/cb79f6e04ee7679ae7644e2ea75a655dd5ab0141))
* **posthog:** quota alarm parsed a payload shape the API never returns ([#404](https://github.com/ariefsaid/PMO/issues/404)) ([d6c1164](https://github.com/ariefsaid/PMO/commit/d6c1164bfb4a29a90b1d1b36d9261305f1a5ba6f))
* **posthog:** quota alarm still reported all-clear having checked nothing ([#408](https://github.com/ariefsaid/PMO/issues/408)) ([9ed8411](https://github.com/ariefsaid/PMO/commit/9ed84118240cc8e331426760d1d7701e4fbe6cdd))
* **security:** close the create-path SoD class — INSERT and UPDATE, six tables ([#411](https://github.com/ariefsaid/PMO/issues/411)) ([eb39fc0](https://github.com/ariefsaid/PMO/commit/eb39fc0cb352d70ca76691b5758c85408e92289b))
* the ambiguous PostgREST embed that took 19 e2e specs down, + the ADR collision ([#413](https://github.com/ariefsaid/PMO/issues/413)) ([b978c04](https://github.com/ariefsaid/PMO/commit/b978c040d946c61e63666dac9faa4b8c6eb891c6))
* the workflow steps that were skipped, and the ten defects they found ([#409](https://github.com/ariefsaid/PMO/issues/409)) ([311caba](https://github.com/ariefsaid/PMO/commit/311caba50679ef4b684fb1d54407407ee3f4dd99))

## [0.8.0](https://github.com/ariefsaid/PMO/compare/v0.7.2...v0.8.0) (2026-07-25)


### ⚠ BREAKING CHANGES

* **deps:** react-router 7 → 8.3.0 + postcss — 0 advisories, waiver removed ([#384](https://github.com/ariefsaid/PMO/issues/384))

### Features

* **admin-connect:** external-system admin self-serve — P1 Vault credentials · P2 Connect/Disconnect · P3 project Link/Unlink · P4 health (flag-off) ([#332](https://github.com/ariefsaid/PMO/issues/332)) ([dea013c](https://github.com/ariefsaid/PMO/commit/dea013cdbb3667af6cfe34ca0bfccc14e6a537ec))
* **auth:** brand the Microsoft SSO button + restructure the login for a professional hierarchy ([#366](https://github.com/ariefsaid/PMO/issues/366)) ([fa8aa81](https://github.com/ariefsaid/PMO/commit/fa8aa810515128ff0558083ec0b8dc8ede748f76))
* **clickup:** parent ↔ parent_task_id bidirectional sync + OD-INT-14 single-org scoping ([#345](https://github.com/ariefsaid/PMO/issues/345)) ([7134577](https://github.com/ariefsaid/PMO/commit/7134577a90270fca93ddc3f5e66574023ab1b1f3))
* **erpnext:** P3 — Sales/AR money write-through (P3a, 9-round audited) + P3b/P3c slice-0 scaffolding ([c7b4ad1](https://github.com/ariefsaid/PMO/commit/c7b4ad16e72c60be33b53b72bbeb8b56251f4a1e))
* **integrations:** Admin ClickUp binding map — both directions ([#356](https://github.com/ariefsaid/PMO/issues/356)) ([c28d58b](https://github.com/ariefsaid/PMO/commit/c28d58b270e06524548f6c29d678c7f77b0d275e))
* **integrations:** atomic connect + operator-only trap-state recovery (final IEM slice) ([#357](https://github.com/ariefsaid/PMO/issues/357)) ([81a157f](https://github.com/ariefsaid/PMO/commit/81a157fad99b05f510979bb7c58f07646f6154b7))
* **lib:** withTimeout — generic mutation-hang safety net + adoption plan ([#383](https://github.com/ariefsaid/PMO/issues/383)) ([3860a34](https://github.com/ariefsaid/PMO/commit/3860a3490d62d493a2c433d1e8f35e54a6616ae7))
* **m365:** Microsoft 365 integration — Phase 0 (SSO + entitlement) + Phase 1 (Graph token custody, 4-round security-hardened) ([#333](https://github.com/ariefsaid/PMO/issues/333)) ([7261632](https://github.com/ariefsaid/PMO/commit/72616323fc15371e04f60e88e30d08d02beda8c2))
* **m365:** wire the Connect flow + add a read-only connection_status action ([#337](https://github.com/ariefsaid/PMO/issues/337)) ([e670fbf](https://github.com/ariefsaid/PMO/commit/e670fbf7992efd5ac7f9bdf584c6c42d804eab4e))
* **p3b/p3c:** timesheet + budget adapter cores, approved-only push gate, activated_at witness ([357f24f](https://github.com/ariefsaid/PMO/commit/357f24fef6a92060c7d2e400bce7257a57a82a53))
* **p3b:** timesheet sweep backstop (6.4) + AC-TSP-042 (6.5) + both audit-r4 escalations ([790065d](https://github.com/ariefsaid/PMO/commit/790065d993824bf8b4501bf09d8310a604c10b2c))
* **p3c:** budget sweep backstop + never-adopt, and close both audit HIGHs ([9c49a3e](https://github.com/ariefsaid/PMO/commit/9c49a3e17d1103bcaa2689f85280e599bc5ebaa5))
* **p3:** ERPNext width — Timesheets (P3b) + Budget (P3c), 11 audit rounds ([3ef8cbe](https://github.com/ariefsaid/PMO/commit/3ef8cbed1799dd9c9adb5626d57ed555a7a0ad2a))
* **tasks:** PMO archive affordance + exclude archived tasks from delivery rollups ([#352](https://github.com/ariefsaid/PMO/issues/352)) ([0f555e5](https://github.com/ariefsaid/PMO/commit/0f555e562bd4e24d0dfb22982bc66e1820d0cc93))
* **tasks:** subtask model — rollup exclusion + nested task register (OD-INT-9) ([#340](https://github.com/ariefsaid/PMO/issues/340)) ([05c242d](https://github.com/ariefsaid/PMO/commit/05c242d7ab49ed2727022eeb71ad95af77f80549))
* **tasks:** task model — description, priority, subtasks, archive (OD-INT-9) ([#339](https://github.com/ariefsaid/PMO/issues/339)) ([80f0ba2](https://github.com/ariefsaid/PMO/commit/80f0ba21dce9d2bfbf74cd53e11f09fa32403de9))
* **tasks:** wire description + priority end-to-end (they were dead columns) ([#350](https://github.com/ariefsaid/PMO/issues/350)) ([b0c38de](https://github.com/ariefsaid/PMO/commit/b0c38de535cb6e3ef8be5bb7f4fc0fe0f608a63a))


### Bug Fixes

* **ci,e2e:** unblock the promote — 2 self-inflicted regressions + 1 ambiguous locator ([#390](https://github.com/ariefsaid/PMO/issues/390)) ([d218f67](https://github.com/ariefsaid/PMO/commit/d218f670e5c9d11ae219ff35cb4814ba21e1a612))
* **ci:** deterministic PR→main integration gate + the local promotion-simulation convention ([#377](https://github.com/ariefsaid/PMO/issues/377)) ([c374432](https://github.com/ariefsaid/PMO/commit/c374432ebf9c9dfc88e557ea319469367f23c752))
* **clickup:** an unbound List never leaks tasks into PMO; sweep active bindings only ([#354](https://github.com/ariefsaid/PMO/issues/354)) ([c28e8ed](https://github.com/ariefsaid/PMO/commit/c28e8ed01d1e67116aa5086fb6f00f00dcd5d9b9))
* **clickup:** per-status resolution with pmo-only outcomes (OD-INT-13) ([#342](https://github.com/ariefsaid/PMO/issues/342)) ([83fed34](https://github.com/ariefsaid/PMO/commit/83fed34dced988ac44af14cb0fa73d1df7b10861))
* **clickup:** read filters, per-List watermarks, backoff clamp, atomic config merge ([#343](https://github.com/ariefsaid/PMO/issues/343)) ([237009b](https://github.com/ariefsaid/PMO/commit/237009bdc1d243e15a33640a4e3d59c5dfe6a1c7))
* **clickup:** webhook ingress rewrite — real envelope, per-org credentials, replay guard (OD-INT-11) ([#344](https://github.com/ariefsaid/PMO/issues/344)) ([c6d6196](https://github.com/ariefsaid/PMO/commit/c6d6196d218c289017d3250f4cde53419b923c5d))
* **docs,e2e:** resolve the ADR id collisions; correct a MISDIAGNOSED e2e quarantine ([#387](https://github.com/ariefsaid/PMO/issues/387)) ([eb9d006](https://github.com/ariefsaid/PMO/commit/eb9d0068f9e0df87f60f0b9303b964b15df02db5))
* **e2e:** 3 stale selectors/logins for intended merged UI changes ([#373](https://github.com/ariefsaid/PMO/issues/373)) ([47a4b4e](https://github.com/ariefsaid/PMO/commit/47a4b4ef7212f8ead7c7a9773d82c347086e6b15))
* **e2e:** AC-INV-001 guard polarity — gate on the served lane, not on CI ([#386](https://github.com/ariefsaid/PMO/issues/386)) ([5f58e76](https://github.com/ariefsaid/PMO/commit/5f58e76bd78a7d818f30a82951df64f1b19dd6f5))
* **e2e:** bench serial guards skip in CI, not throw — unblock dev→main promote ([#371](https://github.com/ariefsaid/PMO/issues/371)) ([b3527f4](https://github.com/ariefsaid/PMO/commit/b3527f469ceb0f06b73bbeb06e3b3b7fb06cb2e2))
* **e2e:** seed the ERPNext webhook secret into Vault — dev removed the env fallback ([e4eacbf](https://github.com/ariefsaid/PMO/commit/e4eacbf5a797b45fdc45bce0514e894112b884ad))
* **e2e:** the 2 root served-smoke specs also skip in CI (completes bench-guard fix) ([#372](https://github.com/ariefsaid/PMO/issues/372)) ([d9b9e7b](https://github.com/ariefsaid/PMO/commit/d9b9e7bc7e93e77aff1f337e371a0e0273e79256))
* **e2e:** widen the timesheet week allocator — an 8-minute wrap made the fix/verify loop self-poisoning ([2c7f586](https://github.com/ariefsaid/PMO/commit/2c7f5867cd080c5b1b89b4a7f8866210cb271e2f))
* **erpnext-p3a:** close round-4 audit — approver-side SoD, double-POST window, status/rollup integrity ([39a1c88](https://github.com/ariefsaid/PMO/commit/39a1c885e63d8afbd273d3bb6cf89e0cc65b7fd0))
* **erpnext-p3a:** close round-5/6 — retry duplication, SoD author set, amend convergence, usable UI ([2ee0acd](https://github.com/ariefsaid/PMO/commit/2ee0acd208207e58009d1b10f078b2778a437b05))
* **erpnext-p3a:** close round-7 cross-family audit — 10 blockers incl. our own fix regressions ([4a2b123](https://github.com/ariefsaid/PMO/commit/4a2b123e9a19f65d7dd2c97a0a2f2610b6616903))
* **erpnext-p3a:** close round-9 cross-family SHOULD-FIXes before the dev PR ([0a74cce](https://github.com/ariefsaid/PMO/commit/0a74cce9576543d1847f95dea41b8c2529ca5a2b))
* **erpnext-p3a:** close the re-audit hardening round — SoD, tenancy, and money-mirror integrity ([cd4f597](https://github.com/ariefsaid/PMO/commit/cd4f597222c9fb2e83674222450e49a65d2d504f))
* **erpnext-p3a:** close the round-3 audit — recovery, adoption, targeting, RLS ([a3b4db1](https://github.com/ariefsaid/PMO/commit/a3b4db14065f29c32e1535d431fd710e535d3f02))
* **integrations:** client write-routing must be project-aware — split-brain vs the DB gate ([#358](https://github.com/ariefsaid/PMO/issues/358)) ([7e135d4](https://github.com/ariefsaid/PMO/commit/7e135d47f0280be082d642dfed81a6fa2d1b0b04))
* **m365:** Operator-gate the connect surface + release the StrictMode status guard ([#365](https://github.com/ariefsaid/PMO/issues/365)) ([f69dc97](https://github.com/ariefsaid/PMO/commit/f69dc975bfb45376877a78403384fba5a5042ebf))
* **money:** Luna BLOCK 1 — anchor collision cross-domain guard ([9ebc071](https://github.com/ariefsaid/PMO/commit/9ebc071323a279744abfaddd9bb3a0cb64cd1578))
* **money:** Luna BLOCK 5 — map PE-receive camelCase repo input to the snake_case command + populate references ([a86417a](https://github.com/ariefsaid/PMO/commit/a86417abcf2d8c7e9a3f52bb3a6de1191b150bcd))
* **money:** revenue SI create leaves a DRAFT (submitOnCreate:false) — SoD is real (OD-SAR-DRAFT-SUBMIT) ([08cc3a3](https://github.com/ariefsaid/PMO/commit/08cc3a35e7b6642c1156c923d6e3a4b4fb19729f))
* **p3:** audit-r3 H-1/H-2 + the owner's graceful-escalation ruling for NaN and company ([305a6f7](https://github.com/ariefsaid/PMO/commit/305a6f72432f9fe86ff5da41346253a66032deb3))
* **p3b/p3c:** close all 7 round-2 audit findings + a HIGH the audit missed ([692a6e7](https://github.com/ariefsaid/PMO/commit/692a6e7c76e47d54e5c9d803b1991f831f7e322a))
* **p3b/p3c:** repair two cross-file breakages from the parallel lanes ([a1a486e](https://github.com/ariefsaid/PMO/commit/a1a486e1d09f1351ff406356ace79a620716238f))
* **p3c:** atomic snapshot-replace — the budget RPC was summing ACROSS generations ([2cd3639](https://github.com/ariefsaid/PMO/commit/2cd36398df9a31d8d63052e1b26e8179d3ac7722))
* **p3:** close all 5 e2e reds — budget UPSERT, retry storm, 422, backstop mint ([855e22d](https://github.com/ariefsaid/PMO/commit/855e22d87b6b7b47dbfc1196afcf8b252ebdf30b))
* **p3:** close all round-5 findings + HIGH-1b, a defect that defeated HIGH-1's own recovery ([18dd2ac](https://github.com/ariefsaid/PMO/commit/18dd2accfdbe6d6e1a70afff652479c7ad53c3bc))
* **p3:** close the last 5 round-3 findings + RUN the edge-fn tests in CI ([c3cd09d](https://github.com/ariefsaid/PMO/commit/c3cd09deccae6ef14be12b558998502e07927982))
* **p3:** close the max_rows class — the sweep round 8 asked for, in erpSnapshots ([444ed8b](https://github.com/ariefsaid/PMO/commit/444ed8be4a693e9c39b1685e024e3b6d696c6cc9))
* **p3c:** make the one-generation guarantee TRUE (advisory lock) + full-grain row key ([fabde7c](https://github.com/ariefsaid/PMO/commit/fabde7c5b2d8f34129114a10b57ea6432e7e0606))
* **p3c:** NEW-1 CRITICAL — "Actuals to date" was structurally 0.00 for every project ([f9b4850](https://github.com/ariefsaid/PMO/commit/f9b485003e905bac5cf65358e13b7ea39b1677c2))
* **p3c:** refuse overlapping fiscal years instead of silently picking one ([cefaaa3](https://github.com/ariefsaid/PMO/commit/cefaaa31f9a0e552bf9240f2fddcdca178003258))
* **p3c:** resolve the fiscal year from ERPNext's calendar + stop the seam dropping error codes ([9feb2ea](https://github.com/ariefsaid/PMO/commit/9feb2ea434893da29093d71fe58598902c90ca20))
* **p3:** delete the unreachable adoption branch + close round 7 ([431efe0](https://github.com/ariefsaid/PMO/commit/431efe05abe6f4e2b354a4ab487e1df3cae9ea09))
* **p3:** one money-honesty INVARIANT + round-6 HIGH + the 2 rework regressions ([d290837](https://github.com/ariefsaid/PMO/commit/d290837bf8caf99f596e16df1b76e1d6bf75a5b1))
* **p3:** page every unbounded PostgREST read — the invariant was certifying a truncated sum ([727bba2](https://github.com/ariefsaid/PMO/commit/727bba2f0e14df392a973540ea450d98f4235a6d))
* **p3:** round 9 — my own paging fix was the defect wearing the fix's clothes ([4606c27](https://github.com/ariefsaid/PMO/commit/4606c27304eb7b640360f10e09bebb9047e60ae2))
* **security:** brace-expansion bump — surgical, preserving the cross-platform tree ([91a7c9d](https://github.com/ariefsaid/PMO/commit/91a7c9d44ec84d50e2fe8bcd71f5c14c86f13023))
* **security:** bump brace-expansion 1.1.15→1.1.16 / 2.1.1→2.1.2 (GHSA-3jxr-9vmj-r5cp) ([37f75e9](https://github.com/ariefsaid/PMO/commit/37f75e95612733ed3e33351cc3a26aacefcb560f))
* **test:** de-flake the M365 ciphertext guard (asserted a random IV byte) ([#385](https://github.com/ariefsaid/PMO/issues/385)) ([06f740e](https://github.com/ariefsaid/PMO/commit/06f740eb0f2a5f6e7edc741375cb7be92741f060))
* **ui:** rework the P3b/P3c surfaces — the money-honesty class at category scope ([9382700](https://github.com/ariefsaid/PMO/commit/93827008e4ed50259fba302c40d57666f5e42f3d))


### Chores

* **deps:** react-router 7 → 8.3.0 + postcss — 0 advisories, waiver removed ([#384](https://github.com/ariefsaid/PMO/issues/384)) ([f8ecfd2](https://github.com/ariefsaid/PMO/commit/f8ecfd2e4c20549c4910bad7e88f0d79549d8047))

## [0.7.2](https://github.com/ariefsaid/PMO/compare/v0.7.1...v0.7.2) (2026-07-14)


### Bug Fixes

* **shell:** /views breadcrumb 'My Views' (+ prod hard-stop docs) — 0.7.2 ([#334](https://github.com/ariefsaid/PMO/issues/334)) ([b81c9de](https://github.com/ariefsaid/PMO/commit/b81c9de8f2a2819f0a073fe63b36d5b259045322))

## [0.7.1](https://github.com/ariefsaid/PMO/compare/v0.7.0...v0.7.1) (2026-07-14)


### Features

* **views:** enable My Views + AI composer by default; stop assistant claiming a false save ([#328](https://github.com/ariefsaid/PMO/issues/328)) ([49222a8](https://github.com/ariefsaid/PMO/commit/49222a801d24d4721697d85f159565e7a95b6e80))

## [0.7.0](https://github.com/ariefsaid/PMO/compare/v0.6.0...v0.7.0) (2026-07-13)


### Features

* **analytics:** wire 10 engagement/friction events + PostHog query helper + 3 hardening fixes ([#324](https://github.com/ariefsaid/PMO/issues/324)) ([3a22bcf](https://github.com/ariefsaid/PMO/commit/3a22bcf86927767b0ce7ec341d374c5fc4ca51ed))
* **auth:** local JWKS caller-JWT verification — pilot on compose-view (ADR-0057 Tasks 1–2) ([#314](https://github.com/ariefsaid/PMO/issues/314)) ([dd86076](https://github.com/ariefsaid/PMO/commit/dd860769bc7559832f53cff80d79d4f2566af31b))


### Bug Fixes

* **e2e:** AC-JWT-005 skips when compose-view isn't served (CI edge_runtime off) ([#316](https://github.com/ariefsaid/PMO/issues/316)) ([b1742ae](https://github.com/ariefsaid/PMO/commit/b1742ae0ad40b5822123a72721c4ad11ebfa25ca))
* **e2e:** green the 3 promote-integration failures (AC-CUA-090 hard + AC-AAN-036/AC-AW-012 flaky) ([#326](https://github.com/ariefsaid/PMO/issues/326)) ([2eecc37](https://github.com/ariefsaid/PMO/commit/2eecc37c638a1a734ff840d1c49268ec90e4adfe))
* **e2e:** make AC-DEL-022 retry-idempotent + AC-AUTHF-005 redirect timeout (promote-integration greens) ([#318](https://github.com/ariefsaid/PMO/issues/318)) ([d0fad99](https://github.com/ariefsaid/PMO/commit/d0fad99f08ea94cc89a8e6ba20661738683eeff9))


### Performance

* **e2e:** reuse captured session storageState + retire per-spec bcrypt ([#306](https://github.com/ariefsaid/PMO/issues/306)) ([082f8fa](https://github.com/ariefsaid/PMO/commit/082f8faf23b9e7b3c2c942e2de36c1e24a15207e))

## [0.6.0](https://github.com/ariefsaid/PMO/compare/v0.5.0...v0.6.0) (2026-07-11)


### Features

* **adapter-seam:** external-system adapter seam P0 (ADR-0055) ([#299](https://github.com/ariefsaid/PMO/issues/299)) ([2cbacd5](https://github.com/ariefsaid/PMO/commit/2cbacd51ab7ccbd0ac7c6ccc0100a43a30aa387d))
* **admin:** agent cost dashboard in the operator layer ([#297](https://github.com/ariefsaid/PMO/issues/297)) ([16d07cb](https://github.com/ariefsaid/PMO/commit/16d07cbc1cafabb22d88b3c4e65edb1bf4ad36bd))
* **agent:** no-train fallback tier with only-restricted routing ([#292](https://github.com/ariefsaid/PMO/issues/292)) ([4111fbd](https://github.com/ariefsaid/PMO/commit/4111fbdcc532e4d72efe20644c7831d8f7a19797))
* **agent:** parallel reads / serial writes in the tool loop ([#5](https://github.com/ariefsaid/PMO/issues/5)) ([#294](https://github.com/ariefsaid/PMO/issues/294)) ([311cc71](https://github.com/ariefsaid/PMO/commit/311cc71f9bc28b16efbb9af240a557a3f7eea7a5))
* **agent:** privacy-first provider pinning for prompt-cache locality ([#291](https://github.com/ariefsaid/PMO/issues/291)) ([98e2974](https://github.com/ariefsaid/PMO/commit/98e2974de1eccd28ddfd560f9e005c669155e6dc))
* **agent:** token-budget transcript compaction (shrink the replayed miss) ([#293](https://github.com/ariefsaid/PMO/issues/293)) ([d34fb7b](https://github.com/ariefsaid/PMO/commit/d34fb7bd8d5764a03eb9665b9a0f20f31a98e652))
* **clickup-adapter:** ClickUp adapter P1 — tasks domain flip + change-feed + onboarding (ADR-0055/0056) ([#307](https://github.com/ariefsaid/PMO/issues/307)) ([a109c21](https://github.com/ariefsaid/PMO/commit/a109c21d91a7272be35936eda33ea1c0da8bd79d))
* **edge:** forward edge-fn errors into PostHog Error Tracking (IG-audit P2) ([#305](https://github.com/ariefsaid/PMO/issues/305)) ([c36b72c](https://github.com/ariefsaid/PMO/commit/c36b72c3dd367089b71f66c3b47b0f8836d205bc))
* **edge:** request-rate throttle on agent-chat (IG-audit P1) ([#302](https://github.com/ariefsaid/PMO/issues/302)) ([348f955](https://github.com/ariefsaid/PMO/commit/348f955f91acc3a1e9196a1cf299411d8a441cbd))
* **telemetry:** capture cached_tokens + reasoning_tokens in agent_usage ([#290](https://github.com/ariefsaid/PMO/issues/290)) ([4f53ead](https://github.com/ariefsaid/PMO/commit/4f53eaddbb24b4f5314de37bc63945b319f4e5ad))
* **ts:** enable strict mode (fix 94 latent errors, incl. 2 real null bugs) ([#300](https://github.com/ariefsaid/PMO/issues/300)) ([dbf902d](https://github.com/ariefsaid/PMO/commit/dbf902df713d9ffca05fc39bdf7f14ebee10356d))


### Bug Fixes

* **e2e:** AC-ACD-010 locator — scope to stat-tiles + exact match ([a43dcc7](https://github.com/ariefsaid/PMO/commit/a43dcc77c0b9001b136bd299ac060e8d4ed647ef))


### Performance

* **test:** split Vitest into node + jsdom projects ([#309](https://github.com/ariefsaid/PMO/issues/309)) ([2708b66](https://github.com/ariefsaid/PMO/commit/2708b66ba81d4845247776e8ec6fef83bb138e86))

## [0.5.0](https://github.com/ariefsaid/PMO/compare/v0.4.0...v0.5.0) (2026-07-09)


### Features

* **agent:** enable automations — fix owner-JWT mint + Vault/dispatch-secret + daily/weekly/dom schedules ([#285](https://github.com/ariefsaid/PMO/issues/285)) ([7bde543](https://github.com/ariefsaid/PMO/commit/7bde543641e934e1b14f8f26d4adb875630bec4c))


### Bug Fixes

* **ui:** remove client-facing repo links + edge-version label ([#282](https://github.com/ariefsaid/PMO/issues/282)) ([0dbf2f5](https://github.com/ariefsaid/PMO/commit/0dbf2f576fcd68278320653117c82209bc745089))

## [0.4.0](https://github.com/ariefsaid/PMO/compare/v0.3.0...v0.4.0) (2026-07-08)


### Features

* **agent:** follow-up multi-turn fix + live interactivity + latency + edge versioning ([#277](https://github.com/ariefsaid/PMO/issues/277)) ([d2148bf](https://github.com/ariefsaid/PMO/commit/d2148bfdfb743ecb4c903e2d8589ef1a57ddb8b3))


### Bug Fixes

* **agent:** follow-up on a History-loaded conversation (adoptRun) ([d73bfde](https://github.com/ariefsaid/PMO/commit/d73bfdee99607ca3a7a30100e7a5b654c61960df))

## [0.3.0](https://github.com/ariefsaid/PMO/compare/v0.2.0...v0.3.0) (2026-07-08)


### Features

* **agent:** persistent activity trail + reassuring long-run copy ([f0f3766](https://github.com/ariefsaid/PMO/commit/f0f3766ccd1197cf4b9b78b32be929301b31ddc5))
* **agent:** persistent activity trail + reassuring long-run copy ([c31b40e](https://github.com/ariefsaid/PMO/commit/c31b40e880e138f84c76a33eae6f158e230567c6))
* automatic versioning — release-please on main + in-app version/sha (ADR-0042 adoption) ([6896e9a](https://github.com/ariefsaid/PMO/commit/6896e9a405b083c5450c7d7d8d1fa0d22ae5fdfc))
* **version:** show app version + sha in-app (ADR-0042 §2) ([60985fd](https://github.com/ariefsaid/PMO/commit/60985fd2253fe83f4ad824e9b05212b8f1393e4a))


### Bug Fixes

* **agent:** align stuck-banner fallback copy with the Stop/Retry buttons ([8a869f1](https://github.com/ariefsaid/PMO/commit/8a869f19c4068000e64372502f2576111218287c))
* **agent:** create the run when it doesn't exist, not when runId is absent — fixes browser-run 42501/errors ([fd62df5](https://github.com/ariefsaid/PMO/commit/fd62df5798ddc65abd9154e7e94d1145bceb2c7a))
* **agent:** persist the run when it doesn't exist (not when runId absent) — fixes multi-round errors + empty usage ([f730b72](https://github.com/ariefsaid/PMO/commit/f730b728b729e53c0333f0774f7e82942161590e))
* **release:** co-locate CHANGELOG under pmo-portal (release-please rejected ../ path) ([a2f94c3](https://github.com/ariefsaid/PMO/commit/a2f94c31c6f811525f270659cfef9ac06cb15572))
* **release:** move CHANGELOG under pmo-portal + drop illegal ../ changelog-path ([b911c34](https://github.com/ariefsaid/PMO/commit/b911c3447932dad4798fd16f372381a6157f4d1f))

## [Unreleased]

_release-please accrues entries here from Conventional Commits landing on `main`._

## [0.2.0] — 2026-07-08 (current production baseline)

The first **three-tier** release: adds the app's first server-side tier (Deno edge functions) on
top of the SPA→Supabase base. **MINOR** per ADR-0042 (new user-facing modules **and** a new
architectural tier).

> Deploy manifest: app `1f68058` · DB migrations `→0081` · edge functions `agent-chat`,
> `compose-view`, `agent-dispatch`, `admin-invite-user`, `health`, `telegram-notify` deployed to
> the prod Cloud project (`prwccpsiumjzvnwjlkwq`).
> **Known gap (the ADR-0042 blocker, now realised):** the promote deployed DB + frontend but a
> stale `agent-chat` (the 2026-07-08 promote did not actually redeploy it — caught 2026-07-08 via
> `supabase functions list`). An edge-function deploy + a post-deploy version check are being added
> so this cannot recur silently.

### Added
- **Agent-native in-app assistant (ADR-0040/0041)** — the ⌘J `AssistantPanel`; a streaming
  `agent-chat` **edge-function deputy** (read-only `query_entity`; write actions `create_activity`
  /`update_task_status` with approve-deny SoD; compose-a-view); the `AgentRuntime` port +
  `PmoNativeRuntime` client adapter. Feature-flagged (`VITE_FEATURES_AGENT_ASSISTANT`).
- **Broadened agent read scope** — the deputy now reads the full business surface (procure-to-pay
  lifecycle, CRM activities, budget line items, docs, team, notifications), each RLS-scoped with a
  curated column allowlist (the `org_id` seam is never surfaced).
- **Live step trail** — the assistant panel shows the current action present-tense while the agent works.
- **User-composed views (ADR-0036 I3–I5)** — `/views` renderer, "Compose with AI" via the
  `compose-view` edge function, Save-to-My-Views (`user_views`, migration 0045).
- **DB hardening** — FK hot-path indexes (0042), incident→project FK (0043), dashboard status
  helpers (0044), auth-floor + org-seam + feature-flag server-enforcement (migs through 0081).

### Notes
- The agent tier adds **no new business tables** — the deputy acts over existing RLS-protected tables
  under the caller's JWT (RLS is the enforcement ceiling).
- The CRUD/RBAC foundation (ADR-0016–0019) and the procurement case-folder records (migs 0035–0041)
  are **already in 0.1.0** (shipped to prod 2026-06-21) — they are not part of this release.

## [0.1.0] — 2026-06-21 (production baseline)

The versioning baseline: the two-tier SPA→Supabase app as it stood live in production when this
convention was adopted (ADR-0042). Not retroactively decomposed into earlier tags. Encompasses the
full pre-agent product — backend foundation, write MVP, CRUD/RBAC foundation, UI/UX programs,
deployment, analytics, and the procurement case-folder record model.

> Deploy manifest: app `fc312eb` · DB migrations `→0041` · no edge functions.

[Unreleased]: https://github.com/ariefsaid/PMO/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ariefsaid/PMO/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ariefsaid/PMO/releases/tag/v0.1.0
