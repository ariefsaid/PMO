# Hourly rental invoice check

FR-001: When an hourly rental invoice is checked, the system shall use explicit contracted hours less dated proven broken hours, floored at zero, times the agreed hourly rate.
FR-002: When an Equipment Officer checks a supplier invoice, the system shall expose hours, rate, quantity, deduction and evidence and record checked or disputed without adding approval or payment rights.
FR-003: While a rental uses a daily or monthly basis, its existing calculation shall remain unchanged.
FR-004: When a period spans different hourly terms, the system shall request separate checks for each term.

AC-HRE-001: Given 200 contracted hours, 40 proven broken hours and rate 100, when the officer checks the invoice for 160 hours, then deduction is 4000 and expected amount is 16000.
AC-HRE-002: Given unproven broken hours, when the check runs, then those hours are shown but not deducted.
AC-HRE-003: Given an unrelated role or organisation, when it reads or writes the check, then access is refused.
AC-HRE-004: Given the equipment officer on the availability screen, when they enter the period and quantities and mark disputed, then the saved result and evidence are visible without payment or approval actions.

Owning proof: AC-HRE-001..003 pgTAP; AC-HRE-004 browser journey.
