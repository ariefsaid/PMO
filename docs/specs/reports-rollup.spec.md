# Finance report project totals

When Finance Reports loads its earned and billed table, the system shall fetch the visible project and currency totals in one request, using the billed and cost bases already used by the project tab.

While the table's existing organisation setting is enabled, the system shall preserve its row visibility, financial figures and unavailable states. If the account has no access to a figure, the system shall withhold that figure.

- **AC-RR-001** Given at least 30 projects with mixed progress, billing and cost states, when the caller reads the table, then every row and financial column equals the per-project calculation.
- **AC-RR-002** Given the organisation setting, tenant, access role and field-account status, when the caller reads totals, then the returned rows and figures follow the existing access rules.
- **AC-RR-003** Given either one or 30 visible projects, when the report table loads, then it sends one totals RPC and displays the returned rows.
