# Spike: ERPNext `Timesheet` + `Employee` field maps, anchor, and validation ladder (P3b OQ-TSP-1)

> **Resolves:** `docs/specs/erpnext-adapter-p3b-timesheets.spec.md` §3 **OQ-TSP-1** (BLOCKING hard gate on
> Slice 1+ of `docs/plans/2026-07-16-erpnext-adapter-p3b-timesheets.md`). Method = R9/R9-P3a verbatim
> (`docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md`, `docs/spikes/2026-07-14-erpnext-si-pe-receive-fields.md`):
> POST a minimal body → read `exc_type`/`_server_messages` → add exactly the named field → repeat to `200` →
> `PUT {docstatus:1}` → **re-fetch and diff**. Every rung below is a real request/response captured against
> the live bench. **No body field names are guessed.** No repo files other than this one were touched.

## §0 Bed

Same stock bed as P2/R9/P3a: `frappe/erpnext:v15.94.3` (frappe 15.96.0), site `frontend` @
`http://localhost:8080`, Company `PMO Smoke Co` (currency IDR, Standard COA), token auth
(`Authorization: token <api_key>:<api_secret>`, Administrator), stock `/api/resource` v1 REST only, no
custom apps, no desk. Bench was verified UP with a real authed `GET /api/resource/Company/PMO Smoke Co` →
`200` before any probe ran.

**Additional bed facts pulled live for this spike:**
- `GET /api/resource/Projects Settings/Projects Settings` → `ignore_user_time_overlap: 0`,
  `ignore_employee_time_overlap: 0` — overlap validation is **ON** by default on this bench (not disabled).
- `GET /api/method/frappe.client.get_single_value?doctype=System Settings&field=time_zone` →
  `"Asia/Jakarta"` — the **site** timezone (OQ-TSP-5's reference point).
- Pre-existing fixtures reused from earlier spikes: `PROJ-0001` (`SPIKE-PROJ-1`, from the P3a spike),
  Activity Types `Planning`/`Research`/`Proposal Writing`/`Execution`/`Communication` (stock ERPNext
  fixtures), and one pre-existing `Employee` **`HR-EMP-00001`** ("Spike Employee", `user_id: Administrator`)
  left over from an earlier (aborted, bench-down) spike attempt at this same file — reused as the primary
  employee fixture rather than re-minting, since HR module setup was already proven working.
- **Source cross-reference (not a substitute for the live probes below, but explains *why* each rung
  behaves as observed):** `apps/erpnext/erpnext/projects/doctype/timesheet/timesheet.py` and
  `apps/frappe/frappe/model/base_document.py` were read inside the running container
  (`docker exec pmo-erpnext-backend-1 ...`) to confirm mechanism after each empirical result, never to
  predict one ahead of a probe.

---

## §1 `Timesheet` minimal body ladder (save vs. submit vs. server-derived)

**Rung 1 — `{}`:**
```
POST /api/resource/Timesheet  {}
→ 417  MandatoryError: [Timesheet, TS-2026-00009]: time_logs
  _server_messages: "Error: Data missing in table: Time Sheets"
```
Only `time_logs` (the child table itself) is schema-mandatory (`reqd:1` on the `Table` field). **`employee`
is `reqd:0`** at the doctype-field level — confirmed live, not assumed.

**Rung 2 — `{"time_logs":[{}]}`:**
```
→ 200  TS-2026-00009 (Draft). company auto-derived "PMO Smoke Co" (single-company bench, like SI/PI).
  time_logs[0] created with hours:0.0, no from_time/to_time/activity_type/project — ALL accepted empty.
```
**A Timesheet saves as a Draft with zero real content and no employee.** Save-time has essentially no
mandatory content beyond the table existing.

**Rung 3 — submit that same doc (`PUT {"docstatus":1}`) with no employee, hours:0, no times:**
```
→ 417  ValidationError: Row 1: From Time and To Time is mandatory.
  (raised from Timesheet.on_submit → validate_mandatory_fields — NOT validate(), i.e. NOT enforced at
  every save, only at the submit transition)
```

**Rung 4 — full minimal body that succeeds end-to-end:**
```json
POST /api/resource/Timesheet
{"employee":"HR-EMP-00001",
 "time_logs":[{"from_time":"2026-07-20 09:00:00","hours":8,"activity_type":"Planning","project":"PROJ-0001"}]}
→ 200  TS-2026-00010 (Draft). title auto-set "Spike Employee" (= employee_name, title_field default).
  to_time SERVER-DERIVED "2026-07-20 17:00:00" (from_time + hours). total_hours: 8.0.
PUT {"docstatus":1} → 200  status: Submitted, docstatus:1. No further fields demanded.
```

**The complete mandatory set to reach a clean submit is:** `time_logs[].from_time` **and**
`time_logs[].to_time` (**either** suffices — see §1a) + `time_logs[].hours > 0`, **and**
`time_logs[].activity_type` **only if the header `employee` is set** (see rung 5). `employee` itself, `company`,
`title`, `currency`, `exchange_rate`, `start_date`/`end_date` are **all server-derived** — never required in
the body.

### §1a `hours` — DERIVED, not trusted (tested both directions, live)

Source (`timesheet.py::calculate_hours`, runs in `validate()` on every save):
```python
def calculate_hours(self):
    for row in self.time_logs:
        if row.to_time and row.from_time:
            row.hours = time_diff_in_hours(row.to_time, row.from_time)
```
And `set_to_time` (`validate_time_logs`, also every save): if `from_time` + `hours` are given but no
`to_time` (or a `to_time` inconsistent with `from_time+hours`), `to_time` is **derived from
`from_time + hours`**.

**Live proof — hours DERIVED (both times given, contradicting hours ignored):** sending
`{"from_time":"...09:00:00","to_time":"...09:00:00","hours":??}` (zero-length window, rung in §7) always
produces `hours:0.0` in the response regardless of any client `hours` value, because `calculate_hours`
recomputes it from the two timestamps whenever both are present.

**Live proof — hours TRUSTED when only `from_time` is given:** rung 4 above sent `from_time` + `hours:8`,
**no** `to_time` — the server computed `to_time = from_time + hours` (`17:00:00`), i.e. it **trusted the
client's `hours`** to derive the missing `to_time`, not the other way around.

**Verdict:** send **either** `{from_time, to_time}` (hours is then always recomputed — safest, no drift
possible) **or** `{from_time, hours}` (to_time is synthesized). **Never send `hours` alone with mismatched
times and expect it to win** — whichever of `hours`/`to_time` is *absent* gets derived from the other two;
when **both** are present, `hours` is **always** overwritten from the timestamps. The adapter's
`timeLogPacking.ts` (FR-TSP-062) should therefore send **both** `from_time` and `to_time` explicitly
(computed from `entry_date` + `timesheet_day_start` + `hours`) rather than relying on server derivation —
belt-and-suspenders, and avoids a same-second floating point round-trip changing `hours` by an epsilon.

### §1b `activity_type` — mandatory **only conditionally** (a real, load-bearing finding)

Source (`validate_mandatory_fields`, on **submit** only):
```python
if not data.activity_type and self.employee:
    frappe.throw(_("Row {0}: Activity Type is mandatory.").format(data.idx))
```
**Live proof:** a Timesheet with `employee` set and a row missing `activity_type` — draft save succeeds,
**submit** fails `417 ValidationError: Row 1: Activity Type is mandatory.` Since P3b **always** sends a
resolved `employee` (FR-TSP-051), `activity_type` is **effectively always mandatory at submit for the P3b
push** — confirms FR-TSP-053's `default_activity_type` fail-closed config is necessary, not optional.

---

## §2 The anchor probe (OQ-TSP-1 #2)

Probed in the spec's mandated order: `note`, `title`, `parent_project`, `time_logs[].description`.

**Setup — create with all four candidates set:**
```json
POST /api/resource/Timesheet
{"employee":"HR-EMP-00001",
 "note":"TSP-SPIKE-ANCHOR-NOTE-001",
 "parent_project":"PROJ-0001",
 "time_logs":[{"from_time":"2026-07-21 09:00:00","hours":4,"activity_type":"Planning","project":"PROJ-0001",
               "description":"TSP-SPIKE-ANCHOR-DESC-001"}]}
→ 200  TS-2026-00011. note/parent_project/description all present verbatim on the create response.
```
**Submit + re-fetch:**
```
PUT {"docstatus":1} → 200 (submit response itself omits note/parent_project/title — Frappe's update_doc
  return value is not a full re-fetch; confirms the R9/R9-P3a "never trust the PUT/POST body, re-fetch"
  rule carries for Timesheet too)
GET /api/resource/Timesheet/TS-2026-00011 →
  note = "TSP-SPIKE-ANCHOR-NOTE-001"        (verbatim, survived validate+submit)
  parent_project = "PROJ-0001"               (verbatim, but see caveat below)
  title = "Spike Employee"                   (NOT our value — we never sent title in THIS create; see below)
  time_logs[0].description = "TSP-SPIKE-ANCHOR-DESC-001"  (verbatim, survived)
```

**REST-filterability (the spec's second criterion):**
```
GET /api/resource/Timesheet?filters=[["note","=","TSP-SPIKE-ANCHOR-NOTE-001"]]
  → {"data":[{"name":"TS-2026-00011"}]}                         ✅ filterable
GET /api/resource/Timesheet?filters=[["parent_project","=","PROJ-0001"]]
  → {"data":[{"name":"TS-2026-00011"}]}                         ✅ filterable (but see caveat)
GET /api/resource/Timesheet Detail?filters=[["description","=","TSP-SPIKE-ANCHOR-DESC-001"]]
  → 403 PermissionError (check_parent_permission)                ❌ NOT independently filterable —
      child-table rows are not a standalone listable REST resource in stock Frappe's permission model.
```

**`title` — tested separately** (a fresh create, this time explicitly supplying `title`):
```json
POST {"employee":"HR-EMP-00001","title":"TSP-SPIKE-CUSTOM-TITLE-001", "time_logs":[...]}
→ 200  TS-2026-00012, title = "TSP-SPIKE-CUSTOM-TITLE-001"  (accepted verbatim when explicitly sent —
  the "Spike Employee" seen elsewhere was the doctype's title_field auto-fill firing only when title is
  *absent*, not a hard overwrite)
```
`title` is a plain `Data` field with no submit-time mutation logic found in the controller — it is a viable
anchor mechanically, but **`note` was probed first per the spec's mandated order and already satisfies
both criteria (verbatim survival + REST-filterable)**, so per the P2/P3a precedent (first survivor in probe
order wins, no need to also crown a runner-up) **`note` is the frozen anchor.**

**Mutability post-submit (the `anchorMutable` verdict):**
```
PUT /api/resource/Timesheet/TS-2026-00011  {"note":"MUTATED-AFTER-SUBMIT"}
→ 417  UpdateAfterSubmitError: Not allowed to change <strong>Note</strong> after submission from
  <strong>TSP-SPIKE-ANCHOR-NOTE-001</strong> to <strong>MUTATED-AFTER-SUBMIT</strong>
```
**`note` is immutable after submit** (`allow_on_submit: 0`, confirmed live by the actual rejection, not
just the DocField flag).

**Caveat on `parent_project` as a *rejected* alternative:** it survives and filters identically to `note`,
but it is **real ERP semantics** (many Timesheets legitimately share the same `parent_project`), not a
free-form PMO-owned value — using it as an anchor would collide with genuine project grouping. `note` is
the correct choice both by probe order and by not overloading a meaningful business field.

**§2 VERDICT: anchor = `note`, `anchorMutable: false`.** (Confirms the spec's OQ-TSP-2 "PI/SI twin" branch,
not the anchor-less fail-closed branch — `neverReissue` is **not** needed for the `timesheet` kind.)

---

## §3 Overlap validation (OQ-TSP-1 #3)

Confirmed **both** within-doc and cross-doc, for **both** `employee` and `user` independently
(`Projects Settings.ignore_employee_time_overlap`/`ignore_user_time_overlap`, both `0` = active on this
bench). Enforced in `validate()` — i.e. **on every save, including Draft**, not just at submit.

**Within one Timesheet (two overlapping rows in the same create call):**
```json
POST {"employee":"HR-EMP-00001","time_logs":[
  {"from_time":"2026-07-23 09:00:00","hours":4,"activity_type":"Planning","project":"PROJ-0001"},
  {"from_time":"2026-07-23 11:00:00","hours":4,"activity_type":"Research","project":"PROJ-0001"}]}
→ 417  OverlapError: Row 2: From Time and To Time of TS-2026-00013 is overlapping with TS-2026-00013
```

**Across two separate Timesheets, same employee, both still Draft (docstatus < 2):**
```
Doc A saved clean: employee HR-EMP-00001, 2026-07-23 09:00–13:00 (TS-2026-00013).
POST a NEW Timesheet: {"employee":"HR-EMP-00001","time_logs":[{"from_time":"2026-07-23 11:00:00","hours":4,...}]}
→ 417  OverlapError: Row 1: From Time and To Time of TS-2026-00014 is overlapping with TS-2026-00013
```
The overlap query (`get_overlap_for`) explicitly filters `timesheet.docstatus < 2` — it checks **Draft AND
Submitted** docs, not only Submitted ones. **A boundary-touching window (row B starts exactly when row A
ends) does NOT count as overlap** (confirmed separately in §7's clean 20h+10h back-to-back test — see
below; the SQL uses strict `<`/`>` for the half-open-interval branches).

**Exact error shape:** `exc_type: "OverlapError"` (a named ERPNext exception subclassing the standard
throw path), HTTP `417`, message names both colliding Timesheet numbers and the row index. Parse
`exc_type == "OverlapError"` as its own bucket (distinct from generic `ValidationError`/`MandatoryError`).

---

## §4 Datetime format + timezone (OQ-TSP-1 #4)

- **Naive `'YYYY-MM-DD HH:MM:SS'`** (space separator) — accepted, used throughout §1–§3 successfully.
- **Naive ISO `'YYYY-MM-DDTHH:MM:SS'`** (`T` separator, no zone) — **also accepted**, MySQL/pymysql
  tolerates the `T`:
  ```
  POST {"employee":"HR-EMP-00001","time_logs":[{"from_time":"2026-07-24T09:00:00",...}]}
  → 200  (creates fine; from_time round-trips as the space-separated form on re-fetch)
  ```
- **`Z`-suffixed instant** — **CRASHES, does not validate cleanly:**
  ```
  POST {..."from_time":"2026-07-24T09:00:00Z",...}
  → 500  pymysql.err.OperationalError: (1292, "Incorrect datetime value: '2026-07-24T09:00:00Z' for
         column ...tabTimesheet Detail.from_time at row 1")
  ```
  The value is passed through to a raw MySQL `INSERT` with **no prior parsing/rejection** — MySQL itself
  throws on the literal, surfacing as an **unguarded raw `500` DB error**, not a clean `417`. Same crash
  class as the PI/SI empty-`items` `500` (R9 §1 / R9-P3a §1) — **must be pre-validated/stripped
  client-side, never sent as-is.**
- **`+07:00`-offset instant** — **same `500` crash** (confirmed separately):
  ```
  POST {..."from_time":"2026-07-25T09:00:00+07:00",...} → 500 (same OperationalError shape)
  ```
- **Site timezone = `Asia/Jakarta`** (`System Settings.time_zone`, read live via
  `frappe.client.get_single_value`). ERPNext stores/interprets all naive datetimes in this zone; there is
  no per-request or per-document timezone override on Timesheet.

**Verdict — confirms the spec's drafted OQ-TSP-5 position exactly and upgrades it from "drafted" to
empirically forced:** the adapter **must** send naive site-local `'YYYY-MM-DD HH:MM:SS'` and **must never**
send a `Z`- or offset-suffixed string — doing so is not merely semantically wrong, it is a **raw 500 crash**
that must be excluded by construction (a formatting bug in `timeLogPacking.ts` that ever emitted a
zone-suffixed string would hard-fail every push, not silently misdate — which is at least loud, not silent,
but still must be a pre-flight-impossible class, not a runtime probe).

---

## §5 Does submit post GL/costing entries? (OQ-TSP-1 #5 — the money-path question)

**Hypothesis was "no." Confirmed no, by two independent methods:**

1. **Live query** against a submitted Timesheet (`TS-2026-00010`, `docstatus:1`, `total_hours:8`):
   ```
   GET /api/resource/GL Entry?filters=[["voucher_no","=","TS-2026-00010"]]  → {"data":[]}
   GET /api/resource/GL Entry?filters=[["voucher_type","=","Timesheet"]]   → {"data":[]}
   ```
   **Zero GL Entry rows for any Timesheet on this bench, filtered both by specific voucher and by
   `voucher_type` globally.**
2. **Source inspection** (`timesheet.py`, read inside the running container): `on_submit` calls only
   `validate_mandatory_fields()` and `update_task_and_project()` — no `make_gl_entries`/journal-entry call
   anywhere in the controller. `erpnext/hooks.py` has no GL/accounting doc_event wired to `"Timesheet"`
   (only a portal route alias and a website-permission handler reference it). `total_costing_amount` /
   `total_billable_amount` are computed and **stored on the Timesheet document itself** (from `Activity
   Cost`/`Activity Type` billing/costing rates, when configured) but **never posted anywhere** — they are
   read-back-only figures until (and unless) a **separate, out-of-scope** `make_sales_invoice` action pulls
   billable hours onto a Sales Invoice (P3b explicitly excludes billing, §2 non-goals).

**§5 VERDICT: Timesheet submit posts NO GL entries. It is NOT a money doc.** ADR-0058's money-path
tightening does **not** apply to the `timesheet` kind; `submitOnCreate:true` (FR-TSP-061) commits **hours**,
not currency — costing totals are informational fields on the document, never a ledger posting. This
confirms the spec's hypothesis; nothing to report loudly here (the loud-report trigger did not fire).

---

## §6 Cancel semantics (OQ-TSP-1 #6)

**Cancel a submitted, unreferenced Timesheet:**
```
PUT /api/resource/Timesheet/TS-2026-00010  {"docstatus":2}
→ 200  docstatus:2, status:"Cancelled". No LinkExistsError — nothing in this bench references a Timesheet
  by default (no Sales Invoice was ever built from it; billing is out of scope for P3b).
```
**Cancel an already-cancelled doc (idempotency guard probe):**
```
PUT ... {"docstatus":2}  (again)
→ 417  ValidationError: Cannot edit cancelled document
```
Harmless, matches the R9/R9-P3a "guard the idempotent cancel" pattern verbatim.

**Mutate a field after submit (the `UpdateAfterSubmitError` shape — already shown in §2's anchor-mutability
probe):** `417 UpdateAfterSubmitError` naming the field and the old/new values.

**§6 VERDICT:** Timesheet cancel is a clean, unblocked `200` for the unreferenced case tested here (no P3a-style
auto-unlink needed, since nothing links to a Timesheet in this bench absent the out-of-scope SI-billing
path). Re-cancel is a harmless `417`. No `500`/crash class found on the cancel path.

---

## §7 The zero/empty edges (OQ-TSP-1 #7)

| Body | Result |
|---|---|
| `time_logs: []` (explicit empty array) | **417** `MandatoryError: [Timesheet, ...]: time_logs` — same as omitting the field entirely (rung 1). Clean, not a crash. |
| `time_logs: [{"hours":0, activity_type, project}]`, no from/to — **save** | **200** — a zero-hour row saves fine as a Draft. |
| **submit** that same zero-hour row | **417** `ValidationError: Row 1: Hours value must be greater than zero.` (from `validate_mandatory_fields`, the third check). Clean `417`, not a crash. |
| `from_time == to_time` (zero-length window), explicit — save | **200**, `hours` recomputed to `0.0` (per §1a — both times present ⇒ hours always derived). |
| `hours: 30` on one row (>24), single row, from_time+hours only — save | **200** — **NO cap.** `to_time` derived to the **next calendar day** (`2026-07-27 09:00` → `2026-07-28 15:00`), `start_date`/`end_date` span two days. **ERP does not reject or even warn on a >24h single row.** |
| Two rows same `entry_date`, back-to-back non-overlapping, summing to 30h (`00:00–20:00` + `20:00–06:00-next-day`) — save | **200** — accepted **silently**. Row 2's `to_time` lands on the **next ERP calendar day** (`2026-08-02 06:00`), even though both rows represent PMO's single `entry_date` `2026-08-01`. **Confirms FR-TSP-055 is load-bearing, not defensive-only:** ERP has no daily-total guard; the packing algorithm's day-spill is real and must be pre-validated client-side (`daily-hours-exceed-24`) — ERP will accept the spillover 200-clean and quietly misdate the tail into the next ERP day. |

**No `500`-class crash was found anywhere in the zero/empty ladder** — unlike PI/SI's empty-`items` crash
(R9 §1) and unlike this spike's own §4 datetime-format crash, the empty/zero-hours edges are all guarded
with clean `417`s. The **only** `500` bucket for Timesheet is the datetime-zone-suffix crash in §4.

---

## §8 The `employee` link — error shape and a load-bearing framework quirk (OQ-TSP-1 #8)

**Expected (per the P2/P3a `DoesNotExistError`/`LinkValidationError` pattern for Supplier/Customer):
a bad `employee` value should 404 or 417. Empirically it does NOT — report loudly, this is real and it
changes what the adapter can rely on ERP to catch.**

```json
POST {"employee":"HR-EMP-99999","time_logs":[{"from_time":"2026-08-02 09:00:00","hours":2,
       "activity_type":"Planning","project":"PROJ-0001"}]}
→ 200  TS-2026-00019 created, employee:"HR-EMP-99999" persisted verbatim, employee_name: null
PUT {"docstatus":1} → 200  submits cleanly too — docstatus:1, status:"Submitted", employee still "HR-EMP-99999"
```
**A completely nonexistent Employee is silently accepted through save AND submit. No `DoesNotExistError`,
no `LinkValidationError`, nothing.** (A prior, independent spike attempt on this same bench had already
hit this exact case — `TS-2026-00003`, `employee:"NOPE-DOES-NOT-EXIST"`, `docstatus:2` — corroborating this
is not a one-off fluke.)

**Sanity check — is Link validation active on this bench at all?** Yes, partially:
```json
POST {"employee":"HR-EMP-00001","time_logs":[{"from_time":"2026-08-05 09:00:00","hours":2,
       "activity_type":"Bogus Activity Type XYZ","project":"PROJ-0001"}]}
→ 417  LinkValidationError: Could not find Row #1: Activity Type: Bogus Activity Type XYZ
```
`activity_type` **is** validated; `employee` and `project` (tested identically — a bogus `project` value is
also silently accepted, `200`, both at save and would presumably submit) are **not**.

**Root cause (confirmed by reading Frappe core, `frappe/model/base_document.py::get_invalid_links`, not
guessed):** the existence check's cache/no-fetch branch is
`values = _dict(name=frappe.db.get_value(doctype, docname, "name", cache=True))` — a dict that is always
truthy even when the fetched name is `None`, so a bad link is correctly caught. But when the linking
doctype has **any other field with `fetch_from` pointing at the same link** (e.g. Timesheet's
`employee_name` has `fetch_from: employee.employee_name`; Timesheet Detail's `project_name` has
`fetch_from: project.project_name` — both **confirmed present** by the `project_name:"SPIKE-PROJ-1"` value
auto-populated in every successful create in this spike), the code takes a **different branch**:
`values = frappe.db.get_value(doctype, docname, [...multiple fields...], as_dict=True)`. When `docname`
doesn't exist, **this call returns bare `None`**, not a dict — so the guarding `if values:` is **False**,
and the entire invalid-link append is **skipped**. `activity_type` has no paired `fetch_from` field on
Timesheet Detail, so it takes the single-value cached branch and **is** validated correctly. This is a
genuine Frappe-core behavioral quirk (arguably a latent bug), not a Timesheet-specific design choice — it
will affect **any** Link field paired with a `fetch_from` companion field, which `employee`/`project` both
are and `activity_type` is not.

**§8 VERDICT (the load-bearing one): ERP will NOT catch a garbage or stale `employee` (or `project`) link,
at save or at submit — silently, with no error of any kind.** This is not a defensive nicety; it is the
**only** thing preventing a mis-resolved `erp_employees` link (a stale/deleted ERP Employee, or a mapping
bug) from silently attributing a week of hours to a phantom employee record. **FR-TSP-051's fail-closed
`link_state='confirmed'` pre-flight (validated PMO-side, before any ERP call) is therefore load-bearing, not
belt-and-suspenders** — ERP provides zero backstop for this specific link. The same applies to
FR-TSP-052's project-mapping pre-flight.

---

## §8b `Employee` doctype — the READ shape (OQ-TSP-1 #9, the OQ-TSP-3/OQ-TSP-10 gate)

**List shape (`GET /api/resource/Employee?fields=[...]`):**
```json
{"name":"HR-EMP-00001","employee_name":"Spike Employee","user_id":"Administrator",
 "company_email":null,"personal_email":null,"prefered_email":null,
 "status":"Active","company":"PMO Smoke Co","date_of_joining":"2024-01-01",
 "relieving_date":null,"modified":"2026-07-17 06:53:49.249217"}
```

**Full doc shape (`GET /api/resource/Employee/HR-EMP-00001`)** confirms `name` = the ERP id
(`HR-EMP-#####`, naming series `HR-EMP-`), `employee` (a duplicate self-referencing field, ignore),
`first_name`/`last_name`/`employee_name`, `gender`, `date_of_birth`, `date_of_joining`, `status`,
`user_id`, `company`, `prefered_contact_email` (empty string on this doc — see below), and **no**
`company_email`/`personal_email`/`prefered_email` keys shown when they are unset (Frappe's full-doc GET
omits genuinely-unset Data fields rather than showing `null` for every possible column — confirmed by
`?fields=[...]` explicitly requesting them, which **does** return them as `null`).

**A fresh Employee created with emails explicitly set — the definitive field-relationship proof:**
```json
POST /api/resource/Employee
{"first_name":"Spike2","last_name":"Employee2","company":"PMO Smoke Co","date_of_joining":"2024-01-01",
 "date_of_birth":"1990-01-01","gender":"Male",
 "company_email":"spike2.company@example.com","personal_email":"spike2.personal@example.com",
 "prefered_contact_email":"Company Email"}
→ 200  HR-EMP-00002:
  "personal_email": "spike2.personal@example.com",
  "company_email": "spike2.company@example.com",
  "prefered_contact_email": "Company Email",
  "prefered_email": "spike2.company@example.com"     ← SERVER-DERIVED, not client-set
  (no "user_id" key at all — NOT auto-populated when omitted)
```

**§8b field-by-field verdict:**
| Field | Exists? | Populated by default? | Notes |
|---|---|---|---|
| `name` | yes | auto (`HR-EMP-#####`) | the ERP id — naming series, client-supplied `name` ignored (same idiom as Project in P3a) |
| `employee_name` | yes | auto (`first_name + last_name`) | display name |
| **`user_id`** | yes (real `Link` to `User`) | **NO — not auto-populated.** `HR-EMP-00001` has it set (`Administrator`, from a prior manual spike setup); the freshly-created `HR-EMP-00002` has **no `user_id` at all** when not explicitly supplied. **The adopt cannot rely on `user_id` being populated** — it is an optional, explicitly-set field, not a guaranteed HR-provisioning side effect. |
| `company_email` | yes (`Data`) | no — independent free-text field, exactly what's sent | |
| `personal_email` | yes (`Data`) | no — independent free-text field | |
| `prefered_email` | yes (`Data`, **read-only/computed**) | **derived**, mirrors whichever of `company_email`/`personal_email` (or presumably `user_id`'s email) `prefered_contact_email` (a `Select`) points at | **this is the OQ-TSP-1 #9 candidate for `erp_employees.work_email`** — it is the one field ERPNext itself treats as "the" contact email, resolved server-side, not a raw column the adapter has to pick between two independently-editable text fields |
| `prefered_contact_email` | yes (`Select`: at least `"Company Email"` confirmed; standard ERPNext options are `Company Email`/`Personal Email`/`User ID`) | defaults empty string | the selector driving `prefered_email`'s derivation |
| `status` | yes | `"Active"` by default | `Active`/`Left`/etc. as expected |
| `company` | yes | required at create | matches |
| `date_of_joining` | yes | required at create | matches |
| `relieving_date` | yes | null unless set | matches |
| `modified` | yes | standard Frappe timestamp | poll-cursor works identically to every other adopted doctype |

**§8b WORK-EMAIL VERDICT (the OQ-TSP-10(C) match-candidate answer): use `prefered_email`, NOT
`company_email` or `personal_email` directly.** `prefered_email` is ERPNext's own resolved "the" contact
email (server-derived from whichever source the Employee record's `prefered_contact_email` selector names),
so it is the closest stock equivalent to "the employee's canonical email" without the adapter having to
duplicate ERPNext's own selection logic or guess which of two independent free-text fields is authoritative
for a given HR setup. **Caveat for `erp_employees.work_email` (schema §4.2):** `prefered_email` can be
**empty** (as seen on `HR-EMP-00001`, which has `prefered_contact_email:""` and all three email fields
`null`) — the adopt-then-confirm match probe (FR-TSP-091) must treat an empty `work_email` as
**no proposal possible**, not a match against an empty string.

**Employee support for the shared adopt mechanics (webhook + `modified`-poll):**
- **`modified`-poll:** confirmed working identically to every other doctype (`modified` is a standard
  Frappe system field on every doctype; no special-casing needed).
- **Webhook support:** confirmed **not doctype-restricted**. A `POST /api/resource/Webhook` with
  `webhook_doctype:"Employee"` was accepted past doctype validation (it failed later on an unrelated
  required Webhook field, `"Please set the document name"` — a `ValidationError` about the Webhook record
  itself, **not** a rejection of `Employee` as a valid `document_type`). No orphan Webhook record was
  created (the insert failed before persisting). **Employee can be wired into the shipped party-adopt
  webhook/sweep engine exactly like any P2 doctype — confirmed, not assumed.**

**Employee is NOT submittable:** `GET /api/resource/DocType/Employee` → `is_submittable: 0`, and the
doctype has **no `amended_from` field** (confirmed by listing its fields) — matches the spec's assumption
that `erp_employees.erp_docstatus`/`erp_amended_from` are mirrored "for uniformity" only, never
meaningfully populated for this kind. `Timesheet`, by contrast, **is** `is_submittable: 1` with a real
`amended_from: Link → Timesheet` field present.

**Employee existing without further HR-module setup:** confirmed — `HR-EMP-00001` was created and used
throughout this spike with no additional HR-module configuration (no Department/Designation/Holiday List
required to save or to be referenced by a Timesheet).

---

## §9 FROZEN MAPS (binding — copy-pasteable into plan tasks 2.2/2.6/2.7/3.3, zero invention required)

### `timesheet` → ERP `Timesheet` (the push, `submitOnCreate: true`)

**`tsToBody` (what the adapter sends):**
```ts
{
  employee: <erp_employees external-ref-resolved ERP name, e.g. "HR-EMP-00001">,  // FR-TSP-051, fail-closed pre-flight — NEVER trust ERP to catch a bad value (§8)
  note: <the anchor — see below>,
  time_logs: [
    {
      from_time: "<site-local 'YYYY-MM-DD HH:MM:SS', NEVER 'Z'/offset-suffixed — see §4>",
      to_time:   "<site-local 'YYYY-MM-DD HH:MM:SS' — send explicitly, don't rely on hours-derivation, see §1a>",
      activity_type: <binding.config.default_activity_type — mandatory whenever `employee` is set, §1b>,
      project: <binding.config.project_map[timesheet_entries.project_id] resolved ERP Project name — fail-closed pre-flight, FR-TSP-052, NEVER trust ERP (§8)>,
      // hours: DO NOT SEND — always derived from from_time/to_time when both present (§1a); sending it adds no value and risks a false sense of control
    },
    // one row per non-zero (project_id, entry_date, hours) — FR-TSP-060
  ],
}
```
- **`company` is NOT sent** — single-company-bench-derived here, and P2/P3a precedent is to never stamp it
  manually; **re-verify this derivation on a genuinely multi-company org before relying on it in
  production** (this bench never exercised a second Company).
- **No `sales_invoice`/`is_billable`/`billing_hours`/`billing_rate` — confirmed absent from every rung in
  this spike, matching OQ-TSP-4's "costing only" scope.**

**`tsFromDoc` (what the adapter reads back into `timesheet_erp_mirror`):**
```ts
{
  ts_number: doc.name,                              // "TS-YYYY-#####"
  erp_total_hours: doc.total_hours,                  // numeric — read-back oracle, never recomputed (ADR-0048)
  erp_total_costing_amount: doc.total_costing_amount,// numeric — informational only, NOT a GL figure (§5)
  erp_docstatus: doc.docstatus,                      // 0 Draft / 1 Submitted / 2 Cancelled
  erp_modified: doc.modified,
  erp_amended_from: doc.amended_from,                // real field, Timesheet IS submittable (§8b)
  erp_cancelled_at: <feed-stamped when doc.docstatus becomes 2, not a native ERP field>,
}
```

**Registry triple (`DoctypeEntry` for `timesheet`):**
```ts
anchorField: 'note',
anchorMutable: false,     // UpdateAfterSubmitError confirmed live, §2
neverReissue: undefined,  // NOT anchor-less — OQ-TSP-2's fail-closed branch does NOT fire for this kind
```

### `employee` → ERP `Employee` (read-only inbound adopt, `readOnly: true`)

**`employeeFromDoc` (what the adapter reads into `erp_employees`):**
```ts
{
  employee_number: doc.name,          // "HR-EMP-#####"
  employee_name: doc.employee_name,
  work_email: doc.prefered_email,     // ★ THE match candidate for OQ-TSP-10(C) — NOT company_email/personal_email directly (§8b)
  erp_user_id: doc.user_id ?? null,   // real field, but OFTEN NULL — never assume populated (§8b)
  erp_status: doc.status,
  erp_docstatus: doc.docstatus,       // always 0 — Employee is not submittable (§8b)
  erp_modified: doc.modified,
  erp_amended_from: null,             // field does not exist on Employee — always null, never fetched
  erp_cancelled_at: null,             // Employee has no cancel lifecycle
}
```
`employee` carries **no** anchor/mirror-table concept (it is a master-data adopt via the shipped
party-adopt path, not a push target) — no `anchorField`/`anchorMutable`/`neverReissue` triple applies.

### Error taxonomy (for the dispatch's error classifier)

| `exc_type` | HTTP | Meaning | Retryable? |
|---|---|---|---|
| `MandatoryError` | 417 | `time_logs` missing/empty, or (on submit) `from_time`/`to_time`/`hours>0`/`activity_type` missing | No — fix the body |
| `ValidationError` | 417 | submit-time `Hours value must be greater than zero`; `Cannot edit cancelled document`; `UpdateAfterSubmitError`-adjacent field mutation attempts | No |
| `OverlapError` | 417 | within- or cross-Timesheet time collision for the same `employee` or `user` | No — a real conflict, surface to the operator, do not retry blindly |
| `LinkValidationError` | 417 | a bad `activity_type` (validated); **NOT raised for a bad `employee` or `project`** — see §8, do not rely on this bucket to catch those two | No |
| `OperationalError` (raw pymysql) | **500** | a `Z`/offset-suffixed datetime string reached the DB layer unparsed (§4) | **No — this is a construction bug, not a transient fault; must be prevented client-side, never retried** |
| *(silent 200, no exception)* | 200 | a **nonexistent** `employee` or `project` — ERP will not tell you (§8); PMO-side fail-closed pre-flight (FR-TSP-051/052) is the **only** guard | n/a — there is no error to classify; this is a pre-flight-or-nothing case |

**Anchor-less fallback (OQ-TSP-2):** **does not fire.** `note` survives verbatim through validate + submit
+ re-fetch and is REST-filterable — the `timesheet` registry entry uses the PI/SI-twin branch
(`anchorMutable:false`, no `neverReissue`), not the fail-closed `held`/`neverReissue:true` branch.

---

## Cleanup

All Timesheet docs created during this spike were either cancelled (submitted ones: `TS-2026-00010/00011/00019`,
now `docstatus:2`, kept as cancelled bench history alongside the pre-existing `TS-2026-00001..00004/00007`
from earlier spikes) or deleted (draft-only ones with no submit history:
`TS-2026-00009/00012/00013/00014/00015/00016/00017/00018/00020/00021`). The extra `Employee` fixture created
to prove the email-field relationship (`HR-EMP-00002`) was deleted. The pre-existing `Employee HR-EMP-00001`
("Spike Employee") is retained as a bench fixture (matches the P2/P3a pattern of keeping non-money masters
as fixtures). Final live-verified state: `GET /api/resource/Timesheet` → only the 8 cancelled/pre-existing
rows remain; `GET /api/resource/Employee` → only `HR-EMP-00001`; `GET /api/resource/Webhook` → only the two
pre-existing P2 fixtures (`pmo-demo-supplier-feed`, `pmo-demo-supplier-feed-insert`), no orphan created by
the §8b webhook-doctype-acceptance probe.
