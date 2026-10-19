# i18n default guard: supported static shapes

Status: narrow #1069 planning handoff, 2026-10-19; implementation and gate evidence are separate.
This bounded slice implements the guard portion of #1069. AC-V24P-015 is defined below; broader catalogue and runtime work remains separate.

## Intent and boundary

When a contributor changes a supported translation reference or English fallback, they need the existing completeness command to compare that source with the catalogue and identify the exact key and checking scope. Extend the existing guard and its behavioral self-tests only.

The implementation owns `scripts/check-i18n-completeness.mjs`, including its existing `selfTest()`. It changes no catalogue, route list, baseline tuple, runtime namespace, application source, workflow, dependency, lockfile or ESLint policy. The eighteen recorded baseline tuples and their copy decisions remain separate work. Completing this slice does not close all of #1069.

Reuse the existing TypeScript parser, `analyse`, `analyseId`, normalization, plural handling, baseline signature and CLI modes. No database, API, repository, UI, RLS or tenancy contract changes are involved; migration/rollback work is inapplicable. No new ADR: this is a bounded implementation extension of the existing guard, not a new architectural contract.

## Observed contracts

The deciding artifact is the current `scripts/check-i18n-completeness.mjs`, with the declared route membership in `pmo-portal/src/lib/i18n/launch-scope-routes.txt` and the existing `check:i18n` command in `pmo-portal/package.json`.

- OBS-001: `collectKeyRefs(src)` returns `Set<string>`; `collectInlineDefaults(src)` returns `{key,value,index}[]`; `analyse` accepts in-memory source maps and reports existing missing/default/baseline/orphan arrays.
- OBS-002: Missing keys, unextracted text and default comparisons use only explicitly named launch files. Orphan detection uses reference files collected under `pages`, `components`, `src` and `App.tsx`, excluding tests. The id mode derives its keys from launch files.
- OBS-003: Equality collapses whitespace with `value.replace(/\s+/g, ' ').trim()`. Baseline identity is exactly `JSON.stringify([key,defaultValue,catalogueValue])`, using original decoded text, not normalized identity; absent signatures are stale.
- OBS-004: An unsuffixed key may be backed by `_other`; `_one` alone does not suffice. Preserve the current default comparison's exact-key lookup rather than introducing plural-default comparison semantics.

## Requirements (EARS)

- FR-001: When live source contains literal `t(key, ...)`, `i18n.t(key, ...)`, or bare `<Trans i18nKey=...>` references, the collector shall return their keys, ignoring comments and text that merely resembles code.
- FR-002: When a launch file references a supported static key absent from the catalogue and its required plural form, `analyse` shall report `{file,key}` in `missing`; a reference-only file shall participate in orphan detection without expanding missing/default scope.
- FR-003: When bare `Trans` has a literal `i18nKey` and a literal `defaults` attribute, `analyse` shall compare the complete decoded defaults string, including markup and interpolation tokens, using existing whitespace equality and baseline rules. Both quoted attributes and JSX expression strings shall work. Children-only defaults, renamed/component-member Trans and computed keys are outside this slice.
- FR-004: When a supported default expression names a lexically visible `const` whose initializer resolves entirely to strings under the static rules below, the analyser shall use that decoded literal. It shall not select an outer binding when a nearer parameter, import, let/var, destructuring or declaration shadows it.
- FR-005: When a default expression names an explicit named import of a directly exported static-string `const`, the analyser shall resolve it only from the supplied read-only source map, honoring imported-name aliases. Relative imports and the existing `@/` app-root alias shall be supported.
- FR-006: While resolving imported literals, the analyser shall inspect at most 64 distinct target files per launch file and at most 32 recursive expression/binding levels and cache parsed import modules for the analysis invocation. Repeated imports shall consume one target visit. It shall never execute modules or chase re-export/import chains.
- FR-007: When a statically keyed explicit default cannot be resolved under these rules, the analyser shall record `{file,line,key,reason}` in `unverifiedDefaults`, omit a fabricated equality/mismatch finding, and retain independent missing-key checks. The CLI shall display these findings and their count even if the verified subset passes.
- FR-008: When the guard reports a result, it shall state missing/default scope as `launch-scope-files`, orphan scope as `reference-files`, and default-expression scope as `static-string-expressions-and-direct-constant-imports`; existing return fields and exit semantics shall remain compatible. Unverified defaults alone are informational, not a newly introduced failing policy.
- FR-009: When a supported mismatch matches an exact baseline signature, the guard shall retain it as a known mismatch; changed signatures shall remain new, and absent signatures shall remain stale. Implementation shall not add, remove or rewrite baseline tuples.
- NFR-001: The implementation shall use Node 22.22+ and the existing app-installed TypeScript, with no new dependency or runtime import of application code.
- NFR-002: Resolution shall remain bounded by supplied source-map membership and the 64-target limit, use app-relative POSIX paths, reject paths escaping approved application sources, and perform no additional filesystem or network lookup inside `analyse`. Each source file shall be at most 1,048,576 UTF-8 bytes. Disk loading shall validate real paths before reading source, accepting only application `pages`, `components`, `src`, and `App.tsx` sources with `.ts`, `.tsx`, `.js` or `.jsx` extensions. A symlink resolving outside those approved application paths shall be rejected; source-limit/read/containment failures shall fail clearly with file/reason and no source-content dump.
- NFR-003: All new behavioral fixtures shall invoke the shipped collector/analyser/reporting functions from the existing self-test, include AC-V24P-015 in their descriptions, and assert exact diagnostic keys and scope.
- NFR-004: Build and review may prepare on a feature branch; merging this slice to dev remains held until the Director verifies the preceding release merge. Dev is the current ceiling; no main or production action is authorized.

## Supported and unverified input policy

Literal keys/defaults mean TypeScript string literals or no-substitution template literals; JSX quoted strings are decoded by the AST. The default positions are `t`/`i18n.t` argument two, `defaultValue` in a literal second-argument options object, and `Trans.defaults`. Explicit object property names may be identifiers or quoted strings. A call with no explicit default is not an unverified default.

Local resolution follows the nearest lexical declaration, including block and function scopes; duplicate/ambiguous declarations are unverified. Imported resolution accepts direct named value imports, including `import { SOURCE as LOCAL }`; the target must directly declare `export const SOURCE = <static-string-expression>`. Relative target candidates are the exact source-map key, `.ts`, `.tsx`, `.js`, `.jsx`, `/index.ts`, `/index.tsx`, `/index.js`, `/index.jsx`, in that order; `@/` starts at the app root. No package, default, namespace, type-only import, barrel or re-export resolution is implied.

Static string expressions are string literals, no-substitution template literals, parentheses, lexically resolved const aliases and binary `+` whose two operands each resolve to strings. Both operands must succeed: no JavaScript coercion, numeric addition, function calls, interpolated templates or property evaluation. A directly imported exported const may use such expressions and same-file const aliases; another import edge is unsupported. This covers authored English constants split across several string literal lines without executing their module.

Unverified reasons are `runtime-expression`, `unresolved-binding`, `unsupported-binding`, `unsupported-import`, `missing-module`, `nonliteral-export`, `import-limit`, `ambiguous-binding`, `cyclic-binding`, or `depth-limit`. A visited-binding stack stops cycles; expression/binding descent starts at depth zero and rejects descent to depth 32. A shadowing nonliteral binding prevents use of a same-name literal elsewhere. The 64-target cap bounds import traversal; each source is capped at 1,048,576 UTF-8 bytes before parsing; the source map and 64-target cap bound aggregate lookup work. An oversized in-memory source fails analysis with its path and `source-limit` before parsing, rather than making an unchecked completeness claim. A future accepted expression shape needs its own red/green fixture.

## Acceptance and proof

**AC-V24P-015 (canonical, reused):** Given literal Trans markup defaults, changed defaults, literal imported constants, unresolved expressions, comments and plural keys, When the real completeness analyser self-tests run, Then supported equality/removal mismatches fail and equivalent supported text passes without executing imports.

The one lowest sufficient owner remains `node scripts/check-i18n-completeness.mjs --self-test`; the following fixture rows refine that same AC, not new independently owned ACs:

| Given / When / Then fixture | Owning plan tasks |
|---|---|
| Given each t/i18n.t/Trans reference in launch scope, when its key is removed, then `missing` contains exactly that `{file,key}` and scope is explicit; comments are ignored. | 1 |
| Given a key only in reference scope, when present/removed, then orphan recognition works without claiming launch completeness. | 1 |
| Given complete Trans markup defaults, when whitespace is equivalent then comparison passes; when text or markup changes then the exact key/default/catalogue mismatch is reported. | 2 |
| Given an exact Trans baseline tuple, when retained/changed/removed, then known/new/stale signature behavior remains unchanged. | 2 |
| Given local/imported static strings and nearer shadowing bindings, when compared, then the correct literal is compared or the explicit default is unverified. | 3, 4 |
| Given named imported direct exported const literals and an unused throwing top-level statement, when compared, then equality/mismatch is determined without executing that statement. | 4 |
| Given unsupported imports/expressions, cyclic aliases, expression depth 32 or more than 64 target modules, when analysed, then unverified reasons are explicit and deterministic. | 5 |
| Given plural references, when `_other` exists then the base is not missing; when only `_one` exists then the base is missing; id references still use the same collector. | 1 |
| Given unverified defaults, when the real CLI reporter runs, then key/file/line/reason, scope and unverified count appear without implying those defaults passed comparison. | 6 |

## Verification and disposition

The builder must obtain RED then GREEN self-test evidence for new behavior, run the actual `npm run check:i18n`, and mutation-check the actual script. A real-catalogue mismatch newly recognized by this extension is not authorization to alter copy or baseline; retain evidence privately and return it to the Director. Full #1069 baseline cleanup, historical removal-scope investigation and optional scripts lint remain separately admitted work.
