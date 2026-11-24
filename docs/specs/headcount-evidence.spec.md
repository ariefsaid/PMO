# Spec: Evidence on a head count day (HCE)

**Status:** built on branch `feat/1124d-site` (lane site, item 2, 24 Nov decisions). IDs `FR-HCE-###`, `AC-HCE-###`.
Plan: `docs/plans/2026-11-24-site-evidence-areas.md`. Migration `2131`. Extends `docs/specs/guard-headcount.spec.md`.

**Job story.** When I record how many unnamed people worked on a day, I want to attach the photo or document that shows it, so the
person who approves the count sees the proof before approving.

## 1. Today (checked 2026-11-24)
- A head count line (`headcount_days`, `1710`) has a crew, class, date and number; it is recorded by `record_headcount_day`
  (authority `attendance_can_record(crew)` or the Project Administrator job role, never a field account) and approved by a different manager (`approve_headcount_day`).
  It carries no file.
- The organisation's document storage is the project document register (`project_documents`, private storage, category rules and
  policies). The close-out checklist already cites one of its documents as evidence (`1400`/`1401`).

## 2. Requirements (EARS)
- **FR-HCE-001** Where a head count line exists and is not approved, the recorder (exactly the people who may record that head count,
  including a Project Administrator) shall be able to attach a photo or document and to remove one.
- **FR-HCE-002** The file shall be a project document of the head count's work order's project, with a file attached; the screen
  creates it through the existing document storage, so the organisation's own document rules decide who may file one. The head
  count cites it; it stores no second copy.
- **FR-HCE-003** A field account shall not attach or remove evidence (it may not record a head count). A person who may not record
  that crew's head count shall be refused (`42501`); this does not grant approval authority.
- **FR-HCE-004** An approved line is final: attaching or removing is refused (`HC_LOCKED`, `23514`).
- **FR-HCE-005** Whoever may read the head count line reads its evidence, so the approver sees the files on the line before approving;
  another organisation reads none. A line carries at most 10 files; the same document is cited once.
- **FR-HCE-006** Clearing a line removes its citations; the documents stay in the register.
- **FR-HCE-007** The head count section shall list the files of each line (open one, attach, remove), in English and Bahasa Indonesia, on phone and desktop.
- **FR-HCE-008** While an evidence read is pending or being retried, the system shall preserve any known files, identify loading or error
  with a retry action, never describe unresolved evidence as absent, and keep approval unavailable until the read resolves.

## 3. Acceptance criteria (owning layer)
- **AC-HCE-001** Given an open line, the crew's foreman attaches a document of the work order's project; attaching it again changes nothing. [pgTAP `2131`; unit `HeadCountSection.test`, `headcount.test`]
- **AC-HCE-002** Given an Engineer who is not authorized for the crew, or a field account (even one that is the crew's field controller), attach is refused; a crew controller, a crew manager and a Project Administrator may attach and detach; the Project Administrator may not thereby approve. [pgTAP `2131`, mutation-checked]
- **AC-HCE-003** Given a document of another project, or one with no file, attach is refused. [pgTAP `2131`, mutation-checked]
- **AC-HCE-004** Given an approved line, attach and remove are refused. [pgTAP `2131`; unit `HeadCountSection.test`]
- **AC-HCE-005** Given a line with files, the approving Project Manager reads them before approving; another organisation reads none. [pgTAP `2131`; unit `HeadCountSection.test`]
- **AC-HCE-006** Given an open line, a file is removed by the recorder. [pgTAP `2131`; unit `HeadCountSection.test`]
- **AC-HCE-007** Given pending, failed, or refreshing evidence, the screen shows the right state, preserves any known files, offers retry
  after failure, and blocks approval until resolved. [unit `HeadCountSection.test`]

## 4. Not in scope
A rule that an attachment is required to approve (not decided); evidence on named-person attendance; a separate bucket for head count files.
