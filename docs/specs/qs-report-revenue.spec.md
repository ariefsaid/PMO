# Validated daily report revenue

FR-QSR-001: When an active Quantity Surveyor reads a validated daily site report in their organisation while the organisation's QS report revenue setting is on, the system shall return that report's frozen rates and amounts.
FR-QSR-002: The system shall preserve existing cost, general revenue and write permissions.
FR-QSR-003: An Admin shall be able to change the organisation setting; the default shall be on.

- AC-QSR-001 (unit): Given a QS and enabled setting, when viewing a validated report, then report revenue is offered, and submitted reports are excluded.
- AC-QSR-002 (pgTAP): Given validated quantity 10 at frozen rate 5, when the QS reads the report, then its amount is 50.
- AC-QSR-003 (pgTAP): Given a QS, when requesting unvalidated or foreign reports or work-order revenue, then access is refused.
- AC-QSR-004 (pgTAP): Given the setting is off, when the QS reads report revenue, then access is refused; only Admin changes the setting.
- AC-QSR-005 (e2e): Given validated priced progress, when the QS opens Daily reports and the report, then the day revenue equals quantity times rate and no work-order total appears.
