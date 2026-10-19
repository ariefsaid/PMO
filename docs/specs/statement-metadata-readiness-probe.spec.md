# Statement metadata readiness probe

Status: bounded requirement captured for Director review, 2026-10-19. The production run remains an operator action after code review and the dev gates.

## Job story and scope

When preparing financial statements for release, the operator needs the existing production deployment probes to verify the integration API user's ordinary metadata reads, so required ERPNext setup can be completed before statements go live.

Add Company, Accounts Settings and Currency READ to the ERPNext API-user setup requirements. Add a read-only metadata check to the existing production deployment probes. This requirement makes no assertion about any deployed principal's current permissions.

The deciding consumer is `fetchStatementPublicationMetadata` in `pmo-portal/src/lib/adapterSeam/erpnext/statementMetadata.ts`. Its consumed fields and value semantics define this check. The probe uses document GET for Company as well as Accounts Settings and Currency, establishing READ access to the configured Company. The separate legacy metadata export does not define this contract. Preserve existing deployment probe oracles and financial statement behavior.

## Required ordinary reads

Use the already configured integration API user and its configured company, with the same authentication resolution and destination protections used by the application. A privileged operator or alternate test user's successful read does not establish readiness for that integration API user. Permission introspection or identity-only results cannot substitute for the actual reads below.

| Dependency | Ordinary GET | Fields and accepted values |
|---|---|---|
| Company | `/api/resource/Company/<encoded configured company>` | Object; `name` equals the configured company; own `default_currency` equals `IDR`; own `default_finance_book` is null, empty string, or a nonblank string. |
| Accounts Settings | `/api/resource/Accounts%20Settings/Accounts%20Settings` | Object with `name` equal to `Accounts Settings`; own `ignore_is_opening_check_for_reporting` and `ignore_account_closing_balance`, each `0`, `1`, `'0'`, or `'1'`. False-valued zero is valid. |
| Currency | `/api/resource/Currency/IDR` | Object with `name` equal to `IDR`; own `fraction_units` and `number_format`, validated using the rules below. |

All three requests select precisely those fields, including `name`. All three use a `data` object envelope; a Company collection response cannot substitute for the document READ. Extra envelope/row fields are accepted and discarded.

Currency rules follow the consumer: `fraction_units` is null/empty string or a nonnegative safe integer, supplied as a number or a canonical decimal integer string (`0` or a nonzero digit followed by digits). `number_format` is null/empty string or one of `#,###.##`, `#.###,##`, `# ###.##`, `# ###,##`, `#'###.##`, `#, ###.##`, `#,##,###.##`, `#,###.###`, `#.###`, `#,###`. A recognized number format supplies presentation precision. Otherwise fraction units must resolve precision: 0 and 1 resolve to 0; another integer must factor entirely into powers of 2 and 5 with maximum exponent at most 9. Null/blank fraction units require a recognized number format. Validate fraction units even when a recognized format supplies precision. No accounting values are calculated.

## Requirements (EARS)

- **FR-001:** When the existing production deployment probes run, the metadata check shall issue the three ordinary reads above through the configured integration API user's existing client and company context.
- **FR-002:** When a response arrives, the check shall validate its HTTP outcome, envelope, identity and consumed fields using the table and Currency rules above.
- **FR-003:** When any required read returns 401 or 403, the check shall fail readiness as authentication or permission respectively, even if another dependency succeeds.
- **FR-004:** When any dependency is missing, returns another unsuccessful HTTP outcome, has a malformed response, or cannot be reached, the check shall fail readiness with a neutral classified reason.
- **FR-005:** While running the metadata check, the probe shall perform only those three GETs, serially, at most once each; it shall continue the remaining checks after an individual failure and report all three outcomes.
- **FR-006:** When all required reads and fields are valid, the check shall pass, including legitimate zero flags, null/blank default finance book, supported Currency defaults and unrelated extra fields.
- **FR-007:** When reporting results, the probe shall emit only fixed dependency labels, classified reason codes and aggregate check counts, followed on failure by the setup action in FR-008; raw responses, exception messages, credentials, identities, configured company names, destination coordinates and financial values shall not appear.
- **FR-008:** The ERPNext API-user setup documentation shall require READ on Company, Accounts Settings and Currency and access to their consumed fields. When readiness fails, the operator shall arrange the required ERPNext role/setup correction before statements go live, then rerun the read-only check.
- **FR-009:** When this check is added to the production deployment probes, all existing deployment probe requests, assertions, order and exit classifications shall remain effective, and metadata failure shall make the combined run unsuccessful.
- **NFR-001:** Any production database reads needed by the adopting client shall use the established sanctioned read-only database wrapper, captured in memory. The tracked core shall accept an injected ordinary-read transport, have no credential loading or network side effects at import, and be testable entirely offline under Node 22.22+ without additional packages.
- **NFR-002:** The adopted transport shall use the existing probe budget: zero retries, at most 20 seconds per read, serial maximum of three reads. Existing destination, language, response-size and credential protections remain in effect.
- **NFR-003:** Implementation shall add no grants, role assignments, credentials, bindings, schema changes or statement publication side effects. This metadata check covers Company, Accounts Settings and Currency only.
- **NFR-004:** Public documentation shall describe setup requirements only and contain no operational identities, environment-variable coordinates, private operational paths or current deployment permission claims.

## Acceptance criteria and owning proof

AC-001 through AC-008 are owned by offline Node unit tests in `scripts/statement-metadata-readiness.test.mjs`. AC-009 has one owning private adoption Node test, `AC-009 preserves old probes and metadata gate`, which also invokes the existing offline legacy self-test as supporting regression proof. The separately reviewed private production-driver adoption also needs its offline harness before an operator runs it against production. Synthetic test results are not production readiness evidence.

| ID | Given / When / Then | Owner |
|---|---|---|
| **AC-001** | Given a configured synthetic company, when the check builds and evaluates its Company read, then it uses document GET with the encoded configured company and all three fields, accepts the matching complete document, and rejects collection/name-only/mismatched responses and missing or invalid required fields. | Node unit |
| **AC-002** | Given Accounts Settings metadata, when its response is evaluated, then both reporting flags and identity must be present; numeric/string 0 and 1 pass, and missing fields or other values fail. | Node unit |
| **AC-003** | Given Currency metadata, when its response is evaluated, then supported number-format and fraction-unit branches pass exactly as the consumer allows; missing fields, unsupported formats, invalid fraction units or unresolved precision fail. | Node unit |
| **AC-004** | Given an independently denied Company, Accounts Settings or Currency read, when the three checks run, then each 401/403 case makes readiness fail with authentication/permission respectively and the other checks still run. | Node unit |
| **AC-005** | Given 404/5xx, malformed envelopes/JSON payloads or a thrown transport failure for any dependency, when the checks run, then readiness fails with unavailable/malformed/transport respectively and no raw failure text escapes. | Node unit |
| **AC-006** | Given three valid responses with unrelated additional fields, zero flags and a null/blank book, when the probe runs, then it makes exactly three serial GET requests with the precise selected fields, passes all three and issues no other calls. | Node unit |
| **AC-007** | Given any success or failure and synthetic sensitive text in bodies/errors, when the summary is formatted, then it reports checked/passed/failed counts and fixed dependency/reason labels only, with the fixed setup action on failure and no sensitive text. | Node unit |
| **AC-008** | Given the ERPNext setup section, when its documented requirements are checked, then Company, Accounts Settings and Currency READ plus the consumed-field and before-go-live/rerun requirements are present as setup requirements. | Node unit document contract |
| **AC-009** | Given the existing deployment probes, when their offline regression suite runs after this addition, then every existing probe oracle still passes; in the private adoption harness, a metadata failure makes the combined driver fail while all three legacy probe outcomes remain effective. | Private adoption Node harness; existing shell self-test supports it |

## Delivery boundary

The public build supplies the tracked, offline-tested core and setup documentation, with CI registration owned by the Director. The Director then reviews and adopts the check into the existing operator-held production probe driver, reusing the established integration credential provider and running its offline harness. An actual production probe run is a separate operator action; this spec and synthetic tests do not authorize a deployment or establish production readiness. This adds no DB/RLS/`org_id` contract and needs no migration or ADR.
