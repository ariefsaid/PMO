# i18n Default Guard Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for this assigned, fresh bounded builder. Execute tasks in order with the implementer contract and preserve the Director's selected executor. Do not spawn workers. Steps use checkbox syntax for tracking.

**Goal:** Extend #1069's existing guard to check supported Trans/static constant defaults and reference shapes, with honest bounded-resolution diagnostics.

**Architecture:** Keep AST scanning, resolution, catalogue analysis and behavioral self-tests in the existing guard script. Resolve strings from in-memory source maps; use the current disk loader only to supply those maps. Preserve current launch/reference scope, baseline identity, id-side behavior and CLI exit rules.

**Tech Stack:** Node 22.22+, app-installed TypeScript, existing Node self-test harness; no dependency changes.

**Spec:** `docs/specs/i18n-default-guard-shapes.spec.md`; the canonical AC-V24P-015 is included there. This plan covers only the guard slice of #1069.

## Global constraints

- Only modify `scripts/check-i18n-completeness.mjs`, including its `selfTest()`; no separate test helper is required because that harness invokes the real implementation in the same file.
- No baseline/catalogue/route-list/app/workflow/ESLint/lockfile changes. The eighteen baseline tuples remain exact. Baseline burn-down and optional scripts lint are separate assignments.
- No runtime application imports, eval, transpile-and-run, package resolution or network inside analysis. Read only the provided source maps. No DB or browser work is required for this Node-only guard change.
- Preserve `collectKeyRefs(src): Set<string>` and `collectInlineDefaults(src, literalConstants?): Array<{key:string,value:string,index:number}>`; existing one-argument callers must still work.
- Missing/default scope remains `launch-scope-files`, orphan scope remains `reference-files`. Unverified default expressions alone do not introduce a new failure policy.
- Static string expressions support literals, no-substitution templates, parentheses, local const aliases and string-only `+`. At most 32 recursive expression/binding levels and 64 distinct imported targets per launch file; no second import hop.
- Node version check: `node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<22)) process.exit(1); console.log(process.versions.node)'` must succeed. Do not install or replace runtimes in this task.
- Run heavy typecheck/Vitest through `PMO_TEST_LOCK_SLOTS=2 scripts/with-test-lock.sh`; do not exceed two heavy local runs. The scoped Node checks can run sequentially through that wrapper too.
- Feature branch work/review/CI may prepare while the Director's v023 release-merge hold is active. Dev is the ceiling; no main/prod action is authorized. No push/merge is delegated by this plan.

## Design decisions and data flow

Existing `readFromDisk()` already supplies launch and whole-app reference maps. Retain their shapes when passing to `analyse`; merge their entries for lookup with launch entries taking precedence for a duplicate path. Use app-relative POSIX keys. No extra filesystem reads are necessary for a constant: production sources already belong to the reference map, while tests supply modules explicitly.

Replace the reference regexes with the existing TypeScript AST. Only bare `t`, `i18n.t` and bare `Trans` are target nodes. `i18nKey`/defaults on unrelated JSX elements do not count. Literal keys include strings and no-substitution templates; JSX expression attributes accept these same literals. Comments, strings containing code and commented JSX are not nodes to collect.

Add an internal `collectDefaultCandidates(src)` returning `{key,index,expression}` records for the explicit default positions. `index` points to the call/opening JSX tag, preserving existing line-number convention. AST expression nodes retain their source file, so `expression.getStart()` locates the lookup key. A candidate's key is static even if its default is unresolved. For options objects with spreads or duplicate/overwritten `defaultValue`, report the candidate unverified rather than guessing the runtime-selected value. Existing straightforward option properties and trailing unrelated properties remain supported.

`resolveLiteralConstants(file, sourceFiles, parsedModules = new Map())` returns `{values: Map<number,string>, reasons: Map<number,string>}` for every explicit candidate default expression in that source. Map keys are expression start offsets, not identifier names, preventing cross-scope leakage. `collectInlineDefaults` uses the optional values map and directly decodes literal expressions when omitted. `analyse` uses candidates plus resolver maps to add `unverifiedDefaults: Array<{file,line,key,reason}>`; all old fields remain.

Resolution looks up the nearest lexical binding, including hoisted shadowing declarations and function parameters. Only unambiguous const identifiers can resolve. Recursively resolve string literals, no-substitution templates, parentheses, const identifiers and binary `+` with two successful string operands; never apply JS coercion. Maintain a binding stack, remove on return, and reject re-entry as `cyclic-binding`. Reject any recursive descent to depth 32 as `depth-limit`, independent of input text size. Resolve only direct named value imports; exported initializer aliases may refer to same-file consts, but cannot take another import edge. Unsupported expressions get a stable reason, not a synthesized value.

For import targets, normalize `./`/`../` against the importing app-relative file or replace leading `@/` with app root; reject escaping paths and packages. Probe the exact map key, `.ts`, `.tsx`, `.js`, `.jsx`, `/index.ts`, `/index.tsx`, `/index.js`, `/index.jsx` in that order. Direct `export const` declarations only; named import aliases use `propertyName ?? name`. Ignore type-only imports. Per launch file, visit at most 64 distinct target modules and memoize repeated targets; cache parsed modules for the whole `analyse` call. Imports are declarations to inspect, never executed modules. No transitive import or re-export walk exists, so cycles through modules are unverified rather than traversed.

Add `MAX_SOURCE_BYTES = 1_048_576`. Check each supplied source's UTF-8 byte length before parsing; throw `source-limit: <app-relative-path>` for oversized input. Before reading application source from disk, a shared `readSourceFile(rel)` resolves the real path, verifies both lexical and resolved app-relative paths remain under `pages`, `components`, `src` or exact `App.tsx`, checks a `.ts/.tsx/.js/.jsx` extension and regular-file size, then reads UTF-8 once. Reject escaping/symlink targets before reading. Apply this helper to both named launch sources and `walkSources` results; expand its existing TS source extension filter to the supported JS/TS extensions, while retaining test exclusions. No arbitrary files, configuration or environment are read as imported modules. Realpath/size/read failures identify the relative file and reason only, with no source contents or physical outside target dumped. `analyse` remains filesystem-free and validates normalized lookup paths against the same approved relative roots.

This is a build-time linear scan plus bounded direct-module/binding inspection; it adds no runtime bundle work, request path, database query or tenant state. Cache scope is one invocation, so changed source cannot inherit stale values from a prior run. Keep the existing catalogue flatten and baseline algorithms instead of creating duplicate comparison logic. No ADR is needed for this routine extension of the existing script.

## Review focus

1. Markup and entities are significant; collapse whitespace only. Task 2 pins a changed tag and a decoded quoted attribute.
2. A nearer dynamic parameter/let binding must block an outer literal. Task 3 pins these false-positive risks.
3. Concatenation must be string-only and bounded. Tasks 3/5 pin numeric/dynamic operands, cycles and depth.
4. A source map containing executable-looking top-level text must remain inert. Task 4 pins this without importing modules.
5. Scope must not silently widen, and unresolved expressions must remain visible on success and failure. Tasks 1/6 pin both.

## Traceability

| Task | Requirement | Canonical owner |
|---|---|---|
| 1 | FR-001/002/008; OBS-002/004 | AC-V24P-015, same-file self-test |
| 2 | FR-003/009; OBS-003 | AC-V24P-015, same-file self-test |
| 3 | FR-004/007 | AC-V24P-015, same-file self-test |
| 4 | FR-005; NFR-002 | AC-V24P-015, same-file self-test |
| 5 | FR-006/007; NFR-002 | AC-V24P-015, same-file self-test |
| 6 | FR-008; NFR-003 | AC-V24P-015, same-file self-test |
| 7 | Verification of tasks 1–6 | AC-V24P-015 evidence, no second owning test |

All behavior tasks are 2–5 minute, independently reviewable red/green units. If a task proves larger, stop at its named seam and report the remaining exact change; do not broaden source ownership.

## Shared self-test vocabulary

Inside existing `selfTest()`, reuse `NS`, `OK_KEY`, `PLANTED_KEY`, `check` and runtime-assembled fixture strings. Add these helpers with Task 1 (not a separate scaffolding task):

```js
const acFile = 'pages/Probe.tsx';
const acScope = {
  missing: 'launch-scope-files', defaults: 'launch-scope-files',
  orphans: 'reference-files',
  defaultExpressions: 'static-string-expressions-and-direct-constant-imports',
};
const ac = (name, actual, expected) => check(
  `AC-V24P-015 ${name}`, JSON.stringify(actual) === JSON.stringify(expected),
  JSON.stringify({ actual, expected }),
);
const runAC = (src, text = 'Hello', extra = {}) => analyse({
  launchScopeFiles: { [acFile]: src }, referenceFiles: { [acFile]: src },
  catalogue: { [NS]: { greeting: text } }, ...extra,
});
```

Use `JSON.stringify(OK_KEY)` when generating source literal keys and `PLANTED_KEY` for absent keys. Each code assertion below is added before the corresponding implementation. `S` below means `node scripts/check-i18n-completeness.mjs --self-test`, run from repository root; always record actual command and output, not just this abbreviation.

### Task 1: AST references and explicit scope (AC-V24P-015, 3–5 min)

**Files:** Modify/test `scripts/check-i18n-completeness.mjs`, `collectKeyRefs`, `analyse` return, `selfTest`.
**Interfaces:** Preserve `collectKeyRefs(src): Set<string>`; add `analyse(...).scope` exactly equal to `acScope`. `analyseId` continues to consume this same collector.

- [ ] RED: add the helpers and table-driven cases below. Build `sources` as `t(K,'Hello')`, `i18n.t(K,'Hello')`, `<Trans i18nKey=K defaults="Hello" />`, and `<Trans i18nKey={K} defaults={'Hello'} />`, replacing K with `JSON.stringify(PLANTED_KEY)`.

```js
for (const src of sources) {
  const r = runAC(src);
  ac('removed supported key', r.missing, [{ file: acFile, key: PLANTED_KEY }]);
  ac('declared checking scope', r.scope, acScope);
}
const ref = `i18n.t(${JSON.stringify(OK_KEY)}, 'Hello')`;
ac('reference-only is not missing scope', runAC('', 'Hello', {
  launchScopeFiles: {}, referenceFiles: { [acFile]: ref },
}).missing, []);
ac('reference-only is not orphan', runAC('', 'Hello', {
  launchScopeFiles: {}, referenceFiles: { [acFile]: ref },
}).orphans, []);
ac('comment shapes ignored', [...collectKeyRefs(`// ${sources[1]}\n/* ${sources[2]} */`)], []);
ac('code-looking string ignored', [...collectKeyRefs(`const prose = ${JSON.stringify(sources[1])}`)], []);
ac('unrelated JSX key ignored', [...collectKeyRefs(`<Other i18nKey=${JSON.stringify(PLANTED_KEY)} />`)], []);
```

Add plural controls for each shape with `key=OK_KEY`: catalogue `{[NS]:{greeting_other:'Hello'}}` gives `missing=[]`; only `greeting_one` gives exactly `[{file:acFile,key:OK_KEY}]`. For `analyseId` with `i18n.t(OK_KEY,...)`, en greeting exists and id `{}` yields exactly `[{key:OK_KEY,why:'absent'}]`.

- [ ] Run `S` and capture RED for i18n.t references/new scope (existing passing controls need not be made artificially red).
- [ ] GREEN: use TS call/JSX opening/self-closing nodes and literal decoding in `collectKeyRefs`; do not call `blankComments` on AST input. Add the four-field scope object to `analyse`; leave `analyseId` scope selection unchanged.
- [ ] Run `S`; all existing and new cases must pass before continuing.

### Task 2: Trans defaults and baseline invariants (AC-V24P-015, 3–5 min)

**Files:** Same script, `collectDefaultCandidates`, `collectInlineDefaults`, `selfTest`.
**Interfaces:** Add internal `collectDefaultCandidates(src): Array<{key:string,index:number,expression:ts.Node}>`; keep collector records `{key,value,index}`. JSX quoted `defaults` is a string-literal node; JSX expression uses its expression node. Later tasks resolve expression offsets.

- [ ] RED: for both quoted and expression attribute strings, generate `<Trans i18nKey=OK_KEY defaults=VALUE />`; compare complete strings below through `runAC`.

```js
const text = 'Hello <strong>{{person}}</strong>';
// trans(value) generates a JSX defaults={JSON.stringify(value)} expression.
const trans = value => `<Trans i18nKey={${JSON.stringify(OK_KEY)}} defaults={${JSON.stringify(value)}} />`;
ac('markup whitespace equivalent', runAC(trans(' Hello  <strong>{{person}}</strong>\n'), text).defaultMismatches, []);
const drift = runAC(trans('Hello <em>{{person}}</em>'), text);
ac('markup drift exact tuple', drift.newDefaultMismatches.map(({key,defaultValue,catalogueValue}) =>
  [key,defaultValue,catalogueValue]), [[OK_KEY,'Hello <em>{{person}}</em>',text]]);
const baseline = [{key:OK_KEY,defaultValue:'Hello <em>{{person}}</em>',catalogueValue:text}];
const kept = runAC(trans(baseline[0].defaultValue), text, {defaultMismatchBaseline:baseline});
ac('exact tuple remains known', [kept.defaultMismatches.length,kept.newDefaultMismatches,kept.staleDefaultBaseline], [1,[],[]]);
ac('stale tuple preserved', runAC(trans(text),text,{defaultMismatchBaseline:baseline}).staleDefaultBaseline,
  [[OK_KEY,baseline[0].defaultValue,text]]);
ac('changed original whitespace is new baseline signature',
  runAC(trans(' Hello <em>{{person}}</em>'),text,{defaultMismatchBaseline:baseline}).newDefaultMismatches.length,1);
```

Also assert quoted JSX `defaults="Hello &amp; welcome"` equals catalogue `Hello & welcome`, and multiline opening tags report the exact call/opening-tag start line. No default on children-only Trans means no collected explicit default. Preserve old key/orphan tests: their clean Trans fixture currently uses `Hello <b>there</b>` against a plain greeting; give that fixture a matching markup catalogue when it is intended to be clean. Keep its original key/orphan assertions and add a separate mismatching control, not a weakened assertion.

- [ ] Run `S` → RED for missing Trans comparisons.
- [ ] GREEN: share target/key/default candidate discovery for t/i18n.t and Trans; compare whole decoded defaults using the existing normalize and signature functions. Preserve option parsing with trailing unrelated properties, escaped quotes and Unicode; do not strip tags or interpolation tokens.
- [ ] Run `S` → GREEN, including baseline exact-signature/stale controls. Do not edit the baseline JSON.

### Task 3: Lexical static string resolution (AC-V24P-015, 3–5 min)

**Files:** Same script, new `resolveLiteralConstants`, optional collector map, analyser diagnostics and self-tests.
**Interfaces:** `resolveLiteralConstants(file:string, sourceFiles:Record<string,string>, parsedModules?:Map): {values:Map<number,string>,reasons:Map<number,string>}`. Map keys are candidate-default expression starts. `collectInlineDefaults(src, literalConstants = new Map())` uses resolved values while retaining direct literal support. Add `unverifiedDefaults` to `analyse`.

- [ ] RED: generate static key literals with OK_KEY, then add cases for second-argument identifiers, `defaultValue` identifiers and `Trans defaults={identifier}`.

```js
const key = JSON.stringify(OK_KEY);
const local = `const FIRST = 'Hel'; const TEXT = FIRST + 'lo'; t(${key}, TEXT);`;
ac('local const concat compared', runAC(local,'Different').newDefaultMismatches.map(m=>[m.key,m.defaultValue]), [[OK_KEY,'Hello']]);
ac('matching local expression', runAC(local).defaultMismatches, []);
const shadow = `const TEXT = 'Hello'; function f(TEXT) { return t(${key}, TEXT); }`;
ac('parameter shadows literal', runAC(shadow).unverifiedDefaults.map(m=>[m.key,m.reason]), [[OK_KEY,'unsupported-binding']]);
const runtime = `t(${key}, makeLabel())`;
ac('runtime is unverified', runAC(runtime).unverifiedDefaults.map(m=>[m.key,m.reason]), [[OK_KEY,'runtime-expression']]);
ac('runtime has no fabricated mismatch', runAC(runtime,'Different').defaultMismatches, []);
ac('numeric concat not coerced', runAC(`const TEXT = 'Hello' + 1; t(${key},TEXT)`).unverifiedDefaults.map(m=>m.reason), ['runtime-expression']);
```

Add nearest-block `let TEXT` shadow, local same-name const success, duplicate ambiguous const declaration, unresolved identifier, no-substitution template, parentheses, options spread/duplicate `defaultValue` unverified, and absent-key-with-runtime-default still missing exactly `{file,key}`. A no-default `t(key)` has no unverified entry. Also add a cycle `const A=B; const B=A; t(key,A)` expecting `cyclic-binding`, and a 40-link local const alias chain expecting `depth-limit`; these can initially fail from the missing resolver, before any recursive production code exists.

- [ ] Run `S` → RED before implementing resolution.
- [ ] GREEN: build lexical declaration lookup, then recursively resolve only allowed string AST forms. Use whole-expression offset maps, reject nearest unsupported bindings, and retain exact source line/key in unresolved records. Record ambiguous option candidates as `runtime-expression`; do not choose an overwritten initializer. Share candidate discovery; do not create an alternate mismatch algorithm. Implement the visited-binding stack and MAX_STATIC_DEPTH=32 guard in this initial recursive resolver so the cycle/depth fixtures never run against unguarded recursion.
- [ ] Run `S` → GREEN. Task 5 adds boundary and import-visit tests; retain these initial cycle/depth protections.

### Task 4: Direct imported static constants (AC-V24P-015, 3–5 min)

**Files:** Same script, resolver/source-map lookup/cache and self-tests.
**Interfaces:** Existing `analyse` arguments remain valid; `sourceFiles` for resolution is `{...referenceFiles,...launchScopeFiles}`. Pass one `parsedModules:Map` across all launch-file resolutions in an analysis invocation.

- [ ] RED: add relative and @/ alias fixtures; imports may rename SOURCE to TEXT. Use both direct string and literal-concatenation exported initializers.

```js
const key = JSON.stringify(OK_KEY);
const imported = `import { SOURCE as TEXT } from '@/src/lib/probeText'; t(${key}, TEXT)`;
const moduleSource = `throw new Error('must remain inert'); export const SOURCE = 'Hel' + 'lo';`;
const importedRun = text => runAC(imported,text,{referenceFiles:{
  [acFile]:imported,'src/lib/probeText.ts':moduleSource,
}});
ac('imported concat compared', importedRun('Different').newDefaultMismatches.map(m=>[m.key,m.defaultValue]), [[OK_KEY,'Hello']]);
ac('imported literal equality', importedRun('Hello').defaultMismatches, []);
ac('imported literal verified', importedRun('Hello').unverifiedDefaults, []);
```

Repeat with `../src/lib/probeText`, exact `.ts`, directory `/index.ts`, and `.js`/`.jsx` source-map paths. Add export containing same-file const string alias. Add same exported name in a different module to prove explicit-import identity, no export keyword → `nonliteral-export`, missing map target → `missing-module`, dynamic exported initializer → `nonliteral-export`. Add `import {SOURCE as TEXT} ...; function f(TEXT){return t(key,TEXT)}` and a nested `let TEXT` to assert `unsupported-binding`, with no imported literal mismatch. The throwing text must stay inert because no loader/import/evaluation is used.

- [ ] Run `S` → RED for supported imports.
- [ ] GREEN: implement the exact target lookup order from the design; inspect direct exported consts in parsed target ASTs, honoring named-import aliases. Resolve target-local string expressions with the same resolver. Cache target ASTs in the run-local map; no second import hop or disk fallback.
- [ ] Run `S` → GREEN; confirm source maps remain unchanged by comparing serialized input before/after for the import fixture.

### Task 5: Bounds and unsupported controls (AC-V24P-015, 3–5 min)

**Files:** Same script, resolver guards, `readSourceFile`, existing source loaders and self-tests.
**Interfaces:** Constants `MAX_STATIC_DEPTH = 32`, `MAX_IMPORTED_FILES = 64`, `MAX_SOURCE_BYTES = 1_048_576`; internal `readSourceFile(rel): string`; reasons include `cyclic-binding`, `depth-limit`, `import-limit` in addition to spec reasons.

- [ ] RED: add import-limit/source-limit/containment assertions before their implementations. The cycle/depth controls below exercise the guards introduced test-first in Task 3; do not manufacture RED for those preserved cases.

```js
const key = JSON.stringify(OK_KEY);
const cycle = `const A = B; const B = A; t(${key}, A)`;
ac('cycle remains unverified', runAC(cycle).unverifiedDefaults.map(m=>m.reason), ['cyclic-binding']);
const deep = Array.from({length:40},(_,i)=>`const S${i} = ${i===39 ? "'Hello'" : `S${i+1}`};`).join('\n');
ac('deep alias chain bounded', runAC(`${deep}\nt(${key}, S0)`).unverifiedDefaults.map(m=>m.reason), ['depth-limit']);
ac('dynamic concat operand unverified', runAC(`const TEXT = 'Hello' + getSuffix(); t(${key}, TEXT)`).unverifiedDefaults.map(m=>m.reason), ['runtime-expression']);
```

Generate 65 distinct named imports with literal modules and 65 `t(OK_KEY,Tn)` calls, in source order. Exactly the 65th use is `import-limit`; all first 64 are verified and each retains the expected value. Repeating one module 65 times with different aliases must yield no `import-limit`. Test a 30-parenthesis expression vs a 33-parenthesis expression to pin the descent boundary, plus exact depth-31/depth-32 generated parentheses. Add type-only/default/namespace imports → `unsupported-import`; a package or escaping path → `unsupported-import`; a barrel/re-export or imported second-hop initializer → `nonliteral-export`. Two cyclic module declarations must terminate with unverified findings without import execution. An exact 1,048,576-byte comment-padded source map passes size validation; one byte larger throws `source-limit` before AST parsing. Test `readSourceFile` with temporary synthetic files under an approved source root: an ordinary source reads, a symlink to a file in a temporary directory outside the app root is rejected, and an oversized file is rejected before `readFileSync`; remove all fixtures in `finally`. Capture rejected read attempts with a temporary `fs.readFileSync` wrapper restored in `finally`, asserting that the outside target contents were never read. A lexically escaping import is `unsupported-import` without filesystem access.

- [ ] Run `S` → RED for absent/wrong import/source/containment diagnostics; existing cycle/depth controls remain GREEN.
- [ ] GREEN: retain binding-stack/depth guards and track distinct resolved imported target paths per launch source. Add the shared guarded source reader and pre-parse byte limit using the exact design above; no additional module reads from the resolver. Reset the import-visit set for the next launch source; keep module AST cache shared only within the invocation. Map invalid/dynamic export resolution to `nonliteral-export`, preserving `cyclic-binding`/`depth-limit` when they are the actual bound reached.
- [ ] Run `S` → GREEN; retained fixtures must cover both successful boundary controls and rejected overflow cases.

### Task 6: Honest CLI diagnostics and existing plumbing (AC-V24P-015, 2–5 min)

**Files:** Same script, `report`, entry path, self-tests.
**Interfaces:** Keep `report(result,entries,fileCount): 0|1`, `readFromDisk()` shape and all CLI modes. Reporting uses additive `scope` and `unverifiedDefaults`; no new disk loader.

- [ ] RED: capture `console.log`/`console.error` inside a self-test `try/finally`, call real `report` with an unverified-only result, then with an unverified-plus-missing result. Restore console methods before calling `ac`.

Require these exact included lines for both outcomes:

```text
Scope: missing/defaults=launch-scope-files; orphans=reference-files; default-expressions=static-string-expressions-and-direct-constant-imports.
Unverified defaults: 1 (excluded from default equality checks).
```

The diagnostic must include `${acFile}:1`, exact `OK_KEY` and `runtime-expression`. Unverified-only returns `0`; the separate missing-key result returns `1`. An all-static clean control reports `Unverified defaults: 0 (excluded from default equality checks).` Do not suppress a valid missing or baseline failure because unverified findings exist.

- [ ] Run `S` → RED for missing reporting lines.
- [ ] GREEN: print scope and unverified count before either report return, and one diagnostic per unresolved explicit default. Preserve existing failure branches and success output goals. Ensure the normal entry calls the extended `analyse` with existing maps; `--id` retains the en/id loader separation.
- [ ] Run `S` → GREEN, then `cd pmo-portal && npm run check:i18n` from the actual builder tree. A newly detected live-catalogue finding blocks completion and goes to the Director; no new baseline/copy edits are authorized.

### Task 7: Mutation evidence and final scoped gates (AC-V24P-015, 3–5 min)

**Files:** No retained file beyond the owned script. This is verification, not a new behavior task.

- [ ] Run `node --check scripts/check-i18n-completeness.mjs`; then `PMO_TEST_LOCK_SLOTS=2 scripts/with-test-lock.sh node scripts/check-i18n-completeness.mjs --self-test` → all cases pass.
- [ ] Run the exact mutation driver below from repository root. It mutates the shipped new-mismatch classification, requires the new AC-V24P-015 markup drift assertion to fail, restores the script in `finally`, and reruns the actual self-test after restoration. Do not change assertions. Capture its output privately.

```bash
python3 - <<'MUTATION'
from pathlib import Path
import subprocess
p = Path('scripts/check-i18n-completeness.mjs')
original = p.read_text()
needle = 'const newDefaultMismatches = defaultMismatches.filter((m) => !baseline.has(signature(m)));'
assert original.count(needle) == 1, 'Keep the existing baseline classification statement recognizable'
try:
    p.write_text(original.replace(needle, 'const newDefaultMismatches = [];'))
    result = subprocess.run(['node', str(p), '--self-test'], text=True, capture_output=True)
    print(result.stdout, end='')
    print(result.stderr, end='')
    assert result.returncode != 0, 'Mutation survived: mismatch classification is not bound to tests'
    assert '✗ AC-V24P-015 markup drift exact tuple' in result.stdout
finally:
    p.write_text(original)
subprocess.run(['node', str(p), '--self-test'], check=True)
MUTATION
```

For focused collector/resolver mutation evidence, independently suppress the Trans candidate, i18n.t reference or imported resolved value in the real script, one at a time; each must fail its named new AC case before restoration. The driver above is the mandatory exact mutation command; those focused mutations strengthen the builder/reviewer evidence without requiring new files.
- [ ] After final restoration run `node --check scripts/check-i18n-completeness.mjs` and `PMO_TEST_LOCK_SLOTS=2 scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run check:i18n'` → GREEN for all three modes.
- [ ] Run `PMO_TEST_LOCK_SLOTS=2 scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'` → GREEN. Do not run a full local suite. No matching changed Vitest tests is acceptable for this script-only change, and is not claimed as its proof: the self-test is the owner.
- [ ] Existing app ESLint does not cover the owned repo script. Record that scope; `node --check` is required and is not described as lint. Do not create a scripts lint policy to satisfy this slice. CI's existing lint/verify and unit shards still apply.
- [ ] Confirm `git diff --name-only` contains only the owned script; verify no baseline/catalogue/route/workflow files changed. Report the actual source-only diff, Node version, RED/GREEN/mutation/check:i18n/typecheck/changed-unit outputs and remaining unverified count.

## Completion and release handoff

A passing self-test alone is insufficient: actual `check:i18n` must pass without changing copy or baseline. Director receives any newly exposed catalogue/signature finding for a separately scoped decision. Keep all evidence from the builder tree, not the planning tree.

All three reviewers remain required: spec, code quality and security (the last right-sized to an offline static script). Reviewers read builder gate evidence and rerun only a targeted check they doubt. No rendered Discover or e2e journey is added for this script-only slice. PR-to-dev still requires four unit shards, pgTAP and verify on CI; a logged browser dispatch occurs only if the Director's lane-closing/post-merge cadence requires it. Do not run DB/browser work from this brief. The v024 hold must be lifted by actual release-merge evidence before merge to dev.

No unresolved requirement question is delegated to the builder. Static string `+` is explicitly admitted to cover existing authored multiline constants; broader expression/import forms remain unverified and need future fixtures and scope admission.
