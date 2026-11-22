# Site day: reports, safety, checkpoints, crew loans, absence (walk fixes)

Source: a first-time-person walk of the released build as the site controller, a Foreman, a Field user and the
Project Manager, phone first, Bahasa Indonesia. Each requirement fixes a symptom a person saw. Owning layer per AC.

## Requirements (EARS) and acceptance (Given/When/Then)

- **FR-SD-001** When a person who may read incidents opens the issue closing-time report and the organisation has it on, the
  report shall load its table, or say plainly why it cannot.
  **AC-SD-001** (unit) Given the report read never starts (not allowed), When the page renders, Then it shows
  "The report cannot be shown", not a skeleton. Cause: the incident `view` action was undefined in `can()`, so the data
  query was disabled for every role and the page waited on it forever. `view incident` is now any active member, as the
  database function allows.
- **FR-SD-002** When a worker is lent to a crew, the system shall keep the worker in exactly one roster per day, and the lend
  form shall name a destination crew that is on no work order those days.
  **AC-SD-002** (unit + pgTAP 1630) Given the host crew is on no work order on a loan day, Then the worker stays on the home
  roster that day (`worker_effective_crew`, migration 1630) and the form refuses (all days) or warns (some days), naming the
  crew. When one worker's save is refused, the roster names that person and saves the rest. A reader who cannot lend sees who can.
- **FR-SD-003** When the author locks a daily safety record, the system shall ask first, name the workers not yet checked, wait for
  missing notes, and say any refusal in the reader's language. The record is one tap from the work-order top.
  **AC-SD-003** (unit) today's record link. **AC-SD-004** (unit) confirmation, unchecked workers, No-without-note, localized
  refusal. Cause of "failed twice": a note commits on blur, so Submit raced the note save; the confirmation step removes the race.
- **FR-SD-005** Today's timed checkpoints shall be recordable from the work order with no report. **AC-SD-005** (unit).
- **FR-SD-006** When the stock notice says there is no site location, it shall link to the setting, and saving the setting shall
  confirm. **AC-SD-006** (unit).
- **FR-SD-007** A field worker shall be able to report "I am not coming in today" (sick or other, optional note) in two taps; it
  reaches the crew's roster keeper and, while leave is on, the line manager and the leave approver role; the roster shows
  "reported absent". It is a statement, not leave or attendance. **AC-SD-007** (unit + pgTAP 1631).
- **FR-SD-008** A reader who cannot tick the roster shall be told who does. **AC-SD-008** (unit; one sentence shared with the
  clock-in lane under `crews:tickReadOnly`).
- **FR-SD-009** The author of a site report shall be told, at send, that the validator needs a photo of the paper form.
  **AC-SD-009** (unit).

## Not changed
No authority rule is looser than before. `report_absence` writes only the caller's own record.
