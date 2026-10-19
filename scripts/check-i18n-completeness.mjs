#!/usr/bin/env node
/**
 * FR-L10N-042a / FR-L10N-042b — the i18n completeness gate (en side + id side).
 *
 * Two en-side failures, both of which make a catalogue quietly lie about its own coverage:
 *
 *   1. UNEXTRACTED — a launch-scope screen renders an English string that never became a key.
 *      The runtime is forgiving by design (FR-L10N-041: a missing key falls back to the English
 *      source, never a raw key), so an unextracted string is INVISIBLE at runtime in every
 *      locale. It looks like working software right up to the moment a client reads it.
 *   2. ORPHANED — a catalogue key nothing references any more. It survives a refactor, gets
 *      translated, gets counted as coverage, and points at text that no longer exists.
 *   3. DEFAULT DRIFT — an inline English default disagrees with an existing en catalogue value.
 *      i18next prefers that catalogue value, so tests without catalogue resources can pass while
 *      users see stale copy. Existing reviewed mismatches live in a self-cleaning baseline.
 *
 *   FR-L10N-042's own text is why both halves are here: the forgiving runtime is affordable
 *   ONLY because this gate makes gaps unshippable. The two rulings work as a pair or not at all.
 *
 * TWO MODES, one per DD-I18N-9 stage (both wired into `check:i18n`):
 *
 *   default (en) — FR-L10N-042a, stage 1: the two failures above, over the `en` catalogue only.
 *   --id         — FR-L10N-042b, stage 2 (shipped WITH the change that populated `id`, so it was
 *                  green on arrival — DD-I18N-9, 2026-08-24): every en key a launch-scope screen
 *                  references must exist in `id` with a NON-EMPTY value, and `id` may hold no key
 *                  `en` does not (the id tree mirrors en's). Empty is a failure because i18next
 *                  falls back silently: an empty/missing id value renders as English and looks
 *                  like working software right up to the moment a client reads it.
 *
 *   The default mode still never reads `id` — en completeness must not depend on translation
 *   state, and the self-test asserts that separation structurally.
 *
 * Scope comes from `pmo-portal/src/lib/i18n/launch-scope-routes.txt`, per OD-I18N-1 (the gate
 * covers launch-scope routes, not the whole app) and DD-I18N-9 (the list is a readable file that
 * each feature adds to as it ships). Read that file's header before changing anything here.
 * En keys OUTSIDE launch scope may stay untranslated in `id` — they fall back to English until
 * their feature's line lands in the route list, matching the gate's additive staging.
 *
 * Usage:
 *   node scripts/check-i18n-completeness.mjs
 *   node scripts/check-i18n-completeness.mjs --id
 *   node scripts/check-i18n-completeness.mjs --self-test
 *
 * ⚑ Every gate in this repo is itself gated (`--self-test`), because BOTH of the existing
 *   enforcement scripts once failed for their own bugs — and a check that silently matches
 *   nothing is indistinguishable from a check that passes. The self-test plants each defect
 *   class and requires the analyser to go red, then requires a clean fixture to go green.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const APP = path.join(REPO, 'pmo-portal');
const ROUTE_LIST = path.join(APP, 'src/lib/i18n/launch-scope-routes.txt');
const EN_CATALOGUE = path.join(APP, 'public/locales/en/common.json');
const DEFAULT_MISMATCH_BASELINE = path.join(HERE, 'i18n-default-mismatch-baseline.json');
/** Read ONLY by --id mode (FR-L10N-042b); the en-side loader must never touch it. */
const ID_CATALOGUE = path.join(APP, 'public/locales/id/common.json');
/** Roots scanned for key REFERENCES (the orphan half). Deliberately the whole app, not just
 *  launch scope: a key pointing at text that no longer exists is dead wherever it lives. */
const REFERENCE_ROOTS = ['pages', 'components', 'src', 'App.tsx'];
const MAX_IMPORTED_FILES = 64;
const MAX_SOURCE_BYTES = 1_048_576;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

// ── Source scanning ─────────────────────────────────────────────────────────────────────────

/**
 * Blank out comments, string bodies, template bodies and regex literals, preserving every byte
 * offset and every newline so line numbers still line up with the original.
 *
 * This is what stops a doc comment from counting as a key reference — `src/lib/i18n/index.ts`
 * documents the convention with `t('budget.remaining', …)` in prose, and without this the gate
 * reports that illustration as a real reference to a key that does not exist.
 */
export function blankComments(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let prevSig = '';
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) {
          j++;
          break;
        }
        if (src[j] === '\n') break;
        j++;
      }
      i = j;
      prevSig = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '$' && src[j + 1] === '{') {
          depth++;
          j += 2;
          continue;
        }
        if (src[j] === '}' && depth > 0) {
          depth--;
          j++;
          continue;
        }
        if (src[j] === '`' && depth === 0) {
          j++;
          break;
        }
        j++;
      }
      i = j;
      prevSig = c;
      continue;
    }
    // A `/` here is a regex literal only after an operator/opener; after a value it is division.
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]/.test(prevSig)) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) {
          j++;
          break;
        } else if (src[j] === '\n') break;
        j++;
      }
      i = j;
      continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}

/**
 * Every key a source file references — `t('some.key' …)` and `<Trans i18nKey="some.key" …>`.
 *
 * Both shapes are ordinary literal references and must count identically. `<Trans>` is the only
 * way to keep markup INSIDE one translatable sentence (#571): a sentence with a `<strong>` or a
 * `<Link>` in the middle is otherwise assembled from prefix/suffix fragments in English word
 * order, which silently renders nonsense in a language that orders the clause differently.
 * Counting only `t(` would report every such sentence's key as an orphan and push authors back
 * to the fragments.
 *
 * ⚑ Static literals only, which is sufficient because the call sites were written that way on
 * purpose: `i18next-parser` extracts literal keys only, so a computed `t(\`task.status.${s}\`)`
 * would be invisible to the extractor AND to this gate, and its catalogue entries would read as
 * orphans. `MyTasks.tsx` and `Rail.tsx` both carry a comment saying exactly that. If a computed
 * key ever appears, this gate reports its keys as orphans — which is the correct alarm, not a
 * bug to be worked around by loosening the scan.
 */
export function collectKeyRefs(src) {
  const keys = new Set();
  const sourceFile = ts.createSourceFile('source.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const literalText = (node) =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const isTargetCall = (expression) =>
    (ts.isIdentifier(expression) && expression.text === 't') ||
    (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'i18n' && expression.name.text === 't');
  const isBareTrans = (tagName) => ts.isIdentifier(tagName) && tagName.text === 'Trans';
  const visit = (node) => {
    if (ts.isCallExpression(node) && isTargetCall(node.expression)) {
      const key = literalText(node.arguments[0]);
      if (key !== undefined && key.length > 0) keys.add(key);
    } else if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && isBareTrans(node.tagName)) {
      const attribute = node.attributes.properties.find((property) =>
        ts.isJsxAttribute(property) && property.name.text === 'i18nKey');
      if (attribute && attribute.initializer) {
        const key = ts.isStringLiteral(attribute.initializer)
          ? decodeQuotedJsxString(attribute.initializer, sourceFile)
          : ts.isJsxExpression(attribute.initializer) ? literalText(attribute.initializer.expression) : undefined;
        if (key !== undefined && key.length > 0) keys.add(key);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return keys;
}

/** Parse with the app's installed TypeScript compiler; no additional dependency is needed. */
const requireFromApp = createRequire(path.join(APP, 'package.json'));
const ts = requireFromApp('typescript');
const decodedJsxLiteralCache = new Map();
const MAX_STATIC_DEPTH = 32;

/** Decode only a JSX-quoted string through the public TypeScript JSX emitter. */
function decodeQuotedJsxString(node, sourceFile) {
  const raw = node.getText(sourceFile);
  if (decodedJsxLiteralCache.has(raw)) return decodedJsxLiteralCache.get(raw);
  if (!raw.includes('&')) {
    decodedJsxLiteralCache.set(raw, node.text);
    return node.text;
  }
  // The synthetic file contains only this already-parsed literal; emitted code is parsed, never run.
  const synthetic = `const __pmoLiteral = <Trans defaults=${raw} />;`;
  const emitted = ts.transpileModule(synthetic, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ESNext },
  }).outputText;
  const emittedFile = ts.createSourceFile('decoded-jsx.js', emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let decoded;
  const visit = (current) => {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) &&
        ts.isIdentifier(current.expression.expression) && current.expression.expression.text === 'React' &&
        current.expression.name.text === 'createElement' && current.arguments[1] &&
        ts.isObjectLiteralExpression(current.arguments[1])) {
      const attribute = current.arguments[1].properties.find((property) =>
        ts.isPropertyAssignment(property) && propertyNameTextForDecode(property.name) === 'defaults');
      if (attribute && ts.isPropertyAssignment(attribute) && ts.isStringLiteral(attribute.initializer)) {
        decoded = attribute.initializer.text;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(emittedFile);
  if (decoded === undefined) throw new Error('unable to decode quoted JSX literal with the TypeScript emitter');
  decodedJsxLiteralCache.set(raw, decoded);
  return decoded;
}

function propertyNameTextForDecode(name) {
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;
}

/** Explicit default positions on supported t() calls and bare <Trans> nodes. */
function collectDefaultCandidates(src, sourceFile = ts.createSourceFile('source.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)) {
  const found = [];
  const literalText = (node) =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const propertyNameText = (name) =>
    name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
      ? name.text : undefined;
  const isTarget = (expression) =>
    (ts.isIdentifier(expression) && expression.text === 't') ||
    (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'i18n' && expression.name.text === 't');
  const addOptionsCandidate = (key, index, options) => {
    if (literalText(options) !== undefined) {
      found.push({ key, index, expression: options });
      return;
    }
    if (!options) return;
    if (!ts.isObjectLiteralExpression(options)) {
      found.push({ key, index, expression: options });
      return;
    }
    const properties = options.properties.filter((property) => propertyNameText(property.name) === 'defaultValue');
    if (!properties.length) return;
    const property = properties[0];
    const expression = ts.isPropertyAssignment(property) ? property.initializer
      : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
    const ambiguous = properties.length !== 1 || options.properties.some(ts.isSpreadAssignment);
    found.push({ key, index, expression, ambiguous });
  };
  const visit = (node) => {
    if (ts.isCallExpression(node) && isTarget(node.expression)) {
      const key = literalText(node.arguments[0]);
      if (key !== undefined) addOptionsCandidate(key, node.getStart(sourceFile), node.arguments[1]);
    } else if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) && node.tagName.text === 'Trans') {
      const keyAttributes = node.attributes.properties.filter((property) =>
        ts.isJsxAttribute(property) && property.name.text === 'i18nKey');
      const defaultAttributes = node.attributes.properties.filter((property) =>
        ts.isJsxAttribute(property) && property.name.text === 'defaults');
      const keyInitializer = keyAttributes[0] && keyAttributes[0].initializer;
      const key = keyInitializer && ts.isStringLiteral(keyInitializer)
        ? decodeQuotedJsxString(keyInitializer, sourceFile)
        : keyInitializer && ts.isJsxExpression(keyInitializer) ? literalText(keyInitializer.expression) : undefined;
      if (key !== undefined && defaultAttributes.length) {
        const initializer = defaultAttributes[0].initializer;
        const expression = initializer && ts.isStringLiteral(initializer) ? initializer
          : initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
        found.push({
          key,
          index: node.getStart(sourceFile),
          expression,
          value: initializer && ts.isStringLiteral(initializer)
            ? decodeQuotedJsxString(initializer, sourceFile) : undefined,
          ambiguous: defaultAttributes.length !== 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found.filter(({ key }) => key.length > 0);
}

/** Literal English defaults on supported references, decoded by the TypeScript parser. */
function inlineDefaultsFromCandidates(candidates, literalConstants = new Map()) {
  return candidates.flatMap((candidate) => {
    const { key, value, index, expression, ambiguous } = candidate;
    const offset = candidateOffset(candidate);
    const literal = literalConstants.has(offset) ? literalConstants.get(offset)
      : value !== undefined ? value
        : expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
          ? expression.text : undefined;
    return literal !== undefined && !ambiguous ? [{ key, value: literal, index }] : [];
  });
}

export function collectInlineDefaults(src, literalConstants = new Map()) {
  return inlineDefaultsFromCandidates(collectDefaultCandidates(src), literalConstants);
}

function candidateOffset(candidate) {
  return candidate.expression ? candidate.expression.getStart() : candidate.index;
}

function isFunctionLikeNode(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function isLexicalScope(node) {
  return ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node) ||
    ts.isCatchClause(node) || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) ||
    isFunctionLikeNode(node) || node.kind === ts.SyntaxKind.ClassStaticBlockDeclaration;
}

function findScope(node, predicate = isLexicalScope) {
  for (let current = node; current; current = current.parent) if (predicate(current)) return current;
  return undefined;
}

function addBinding(bindingsByScope, scope, name, binding) {
  if (!scope || !name) return;
  let scopeBindings = bindingsByScope.get(scope);
  if (!scopeBindings) {
    scopeBindings = new Map();
    bindingsByScope.set(scope, scopeBindings);
  }
  const list = scopeBindings.get(name) ?? [];
  list.push(binding);
  scopeBindings.set(name, list);
}

function bindingIdentifiers(name, identifiers = []) {
  if (!name) return identifiers;
  if (ts.isIdentifier(name)) identifiers.push(name);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) bindingIdentifiers(element.name, identifiers);
    }
  }
  return identifiers;
}

function scopeBindingsFor(sourceFile) {
  const bindingsByScope = new Map();
  const addNamed = (name, scope, binding) => {
    for (const identifier of bindingIdentifiers(name)) addBinding(bindingsByScope, scope, identifier.text, binding);
  };
  const nearestVarScope = (node) => findScope(node, (current) => ts.isSourceFile(current) || isFunctionLikeNode(current));
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) {
      const declarationList = node.parent;
      const flags = declarationList.flags;
      const kind = flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : 'var';
      const scope = kind === 'var' ? nearestVarScope(node) : findScope(node.parent);
      const identifierName = ts.isIdentifier(node.name);
      addNamed(node.name, scope, {
        kind: identifierName ? kind : 'destructured',
        declaration: node,
        initializer: identifierName ? node.initializer : undefined,
      });
    } else if (ts.isParameter(node)) {
      addNamed(node.name, node.parent, { kind: 'parameter', declaration: node });
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
      addNamed(node.name, findScope(node.parent), { kind: 'declaration', declaration: node });
    } else if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) {
      addNamed(node.name, node, { kind: 'declaration', declaration: node });
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      addNamed(node.variableDeclaration.name, node, { kind: 'catch-binding', declaration: node.variableDeclaration });
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      const moduleSpecifier = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
      const isTypeOnly = clause.isTypeOnly;
      if (clause.name) addNamed(clause.name, sourceFile, {
        kind: isTypeOnly ? 'type-import' : 'import-default', declaration: node, moduleSpecifier,
      });
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        addNamed(clause.namedBindings.name, sourceFile, {
          kind: isTypeOnly ? 'type-import' : 'import-namespace', declaration: node, moduleSpecifier,
        });
      } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          addNamed(element.name, sourceFile, {
            kind: isTypeOnly || element.isTypeOnly ? 'type-import' : 'import-named',
            declaration: node,
            moduleSpecifier,
            importedName: (element.propertyName ?? element.name).text,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindingsByScope;
}

function getParsedSourceFile(file, source, parsedModules) {
  assertSourceSize(file, source);
  const existing = parsedModules.get(file);
  if (existing && ts.isSourceFile(existing)) return existing;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  parsedModules.set(file, sourceFile);
  return sourceFile;
}

function isApprovedSourceMapPath(file) {
  return file === 'App.tsx' || ['pages/', 'components/', 'src/'].some((root) => file.startsWith(root));
}

function assertSourceSize(file, source) {
  if (typeof source === 'string' && Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new Error(`${file}: source-limit`);
  }
}

function resolveImportTarget(importingFile, specifier, sourceFiles) {
  if (typeof specifier !== 'string' || specifier.includes('\\') || path.posix.isAbsolute(specifier)) {
    return { reason: 'unsupported-import' };
  }
  let base;
  if (specifier.startsWith('@/')) base = path.posix.normalize(specifier.slice(2));
  else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(importingFile), specifier));
  } else return { reason: 'unsupported-import' };
  if (!isApprovedSourceMapPath(base) && base !== 'App') return { reason: 'unsupported-import' };
  const baseExtension = path.posix.extname(base);
  if (baseExtension && !SOURCE_EXTENSIONS.has(baseExtension)) return { reason: 'unsupported-import' };
  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
  ];
  const target = candidates.find((candidate) =>
    isApprovedSourceMapPath(candidate) && SOURCE_EXTENSIONS.has(path.posix.extname(candidate)) &&
    Object.hasOwn(sourceFiles, candidate) && typeof sourceFiles[candidate] === 'string');
  return target ? { file: target } : { reason: 'missing-module' };
}

function directExportedConst(sourceFile, importedName) {
  const matches = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) ||
        !(statement.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === importedName) {
        matches.push({ isConst, initializer: declaration.initializer });
      }
    }
  }
  if (!matches.length) return { reason: 'nonliteral-export' };
  if (matches.length !== 1) return { reason: 'ambiguous-binding' };
  if (!matches[0].isConst || !matches[0].initializer) return { reason: 'nonliteral-export' };
  return { initializer: matches[0].initializer };
}

function resolveDefaultCandidates(candidates, sourceFile, {
  file = sourceFile.fileName,
  sourceFiles = {},
  parsedModules = new Map(),
} = {}) {
  const values = new Map();
  const reasons = new Map();
  const importedTargets = new Set();
  const environmentFor = (moduleFile, moduleSourceFile, allowImports) => ({
    file: moduleFile,
    sourceFile: moduleSourceFile,
    bindingsByScope: scopeBindingsFor(moduleSourceFile),
    allowImports,
  });
  const findBinding = (environment, name, location) => {
    for (let current = location; current; current = current.parent) {
      const scopeBindings = environment.bindingsByScope.get(current);
      if (scopeBindings && scopeBindings.has(name)) return scopeBindings.get(name);
    }
    return [];
  };

  const resolveExpression = (node, depth, bindingStack, environment) => {
    if (depth >= MAX_STATIC_DEPTH) return { reason: 'depth-limit' };
    if (!node) return { reason: 'runtime-expression' };
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { value: node.text };
    if (ts.isParenthesizedExpression(node)) return resolveExpression(node.expression, depth + 1, bindingStack, environment);
    if (ts.isIdentifier(node)) {
      const found = findBinding(environment, node.text, node);
      if (!found.length) return { reason: 'unresolved-binding' };
      if (found.length !== 1) return { reason: 'ambiguous-binding' };
      const binding = found[0];
      if (binding.kind === 'import-named') {
        if (!environment.allowImports) return { reason: 'nonliteral-export' };
        const target = resolveImportTarget(environment.file, binding.moduleSpecifier, sourceFiles);
        if (target.reason) return target;
        if (!importedTargets.has(target.file)) {
          if (importedTargets.size >= MAX_IMPORTED_FILES) return { reason: 'import-limit' };
          importedTargets.add(target.file);
        }
        const targetSource = sourceFiles[target.file];
        if (typeof targetSource !== 'string') return { reason: 'missing-module' };
        const targetFile = getParsedSourceFile(target.file, targetSource, parsedModules);
        const exported = directExportedConst(targetFile, binding.importedName);
        if (exported.reason) return exported;
        const targetEnvironment = environmentFor(target.file, targetFile, false);
        const result = resolveExpression(exported.initializer, depth + 1, bindingStack, targetEnvironment);
        if (typeof result.value === 'string' || result.reason === 'cyclic-binding' || result.reason === 'depth-limit') {
          return result;
        }
        return { reason: 'nonliteral-export' };
      }
      if (binding.kind === 'import-default' || binding.kind === 'import-namespace' || binding.kind === 'type-import') {
        return { reason: 'unsupported-import' };
      }
      if (binding.kind !== 'const' || !binding.initializer) return { reason: 'unsupported-binding' };
      if (bindingStack.has(binding)) return { reason: 'cyclic-binding' };
      bindingStack.add(binding);
      const result = resolveExpression(binding.initializer, depth + 1, bindingStack, environment);
      bindingStack.delete(binding);
      return result;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = resolveExpression(node.left, depth + 1, bindingStack, environment);
      if (left.reason) return left;
      const right = resolveExpression(node.right, depth + 1, bindingStack, environment);
      if (right.reason) return right;
      if (typeof left.value === 'string' && typeof right.value === 'string') {
        return { value: left.value + right.value };
      }
    }
    return { reason: 'runtime-expression' };
  };

  for (const candidate of candidates) {
    const offset = candidateOffset(candidate);
    if (candidate.ambiguous) {
      reasons.set(offset, 'runtime-expression');
      continue;
    }
    if (candidate.value !== undefined) {
      values.set(offset, candidate.value);
      continue;
    }
    const result = resolveExpression(candidate.expression, 0, new Set(), environmentFor(file, sourceFile, true));
    if (typeof result.value === 'string') values.set(offset, result.value);
    else reasons.set(offset, result.reason ?? 'runtime-expression');
  }
  return { values, reasons };
}

function resolveLiteralConstants(file, sourceFiles, parsedModules = new Map()) {
  const source = sourceFiles[file];
  if (typeof source !== 'string') return { values: new Map(), reasons: new Map() };
  const sourceFile = getParsedSourceFile(file, source, parsedModules);
  return resolveDefaultCandidates(collectDefaultCandidates(source, sourceFile), sourceFile, {
    file, sourceFiles, parsedModules,
  });
}

const STOP_WORDS =
  /\b(const|let|var|return|null|undefined|function|import|export|typeof|interface|extends|await|async|new)\b/;
/** Values that render but are not prose: an email or URL example carries no language. */
const NOT_PROSE = /^(?:[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/\S+)$/;
/** JSX props whose value is read by a human. */
const LABEL_PROPS =
  'label|title|placeholder|aria-label|ariaLabel|heading|description|emptyMessage|confirmLabel|cancelLabel|submitLabel|alt|helpText|hint|message|actionLabel|sub|emptyTitle|emptySub';
/** Object-literal fields that end up on screen — column definitions, status maps, nav entries. */
const LABEL_FIELDS =
  'label|title|description|placeholder|header|helpText|emptyMessage|sub|emptyTitle|emptySub|message';

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * An auditable opt-out, deliberately shaped like the `eslint-disable` already carried at
 * `ProjectDetailHeader.tsx:75`: a REASON is mandatory, so an exemption stays reviewable instead
 * of becoming a silent mute. The real case this exists for is an export-only column header —
 * FR-L10N-050 forbids `t()` on anything an export writes, so those strings must NOT be
 * extracted, and no narrowing of the rules above can tell them from rendered ones.
 */
const EXEMPT = /i18n-exempt:\s*\S/;
function exemptAt(lines, lineNo) {
  const self = lines[lineNo - 1] ?? '';
  const prev = lines[lineNo - 2] ?? '';
  return EXEMPT.test(self) || EXEMPT.test(prev);
}

/**
 * Rendered English that never became a key, in one file.
 *
 * Three shapes, matching the extraction survey in the spec (§3): JSX prose text nodes, label-
 * bearing JSX props, and label-ish object-literal fields. A string that is already inside a
 * `t(key, default)` call cannot match any of them — the default sits in argument position, not
 * in a text node or a `label=` / `label:` slot — which is what makes "extracted" the passing
 * state rather than something the gate has to prove separately.
 */
/**
 * Blank the BODY of every JSX attribute value (offsets and newlines preserved), leaving the
 * quotes in place.
 *
 * A JSX attribute value is not a text node, and rule 1 below is a text-node scan. It only starts
 * to matter with `<Trans defaults="Certify … <strong>no Timesheet</strong> …">` (#571): keeping
 * the markup INSIDE the sentence is the whole point of `<Trans>`, but to the `>…<` scan that
 * `>no Timesheet<` reads as rendered prose nobody extracted — the exact opposite of the truth,
 * and a finding whose only "fix" is to shatter the sentence back into fragments.
 *
 * Deliberately narrow. It requires `identifier=` immediately before the quote, so it can never
 * match a quote inside prose — the apostrophe in a JSX text node like `Couldn't load` is not an
 * attribute and is left alone. And it is applied to the text-node scan ONLY: the prop and
 * object-field rules keep the untouched source, so `label="Unwrapped copy"` is still found.
 */
export function blankAttrValues(s) {
  return s.replace(
    /(\b[A-Za-z][A-Za-z0-9_-]*\s*=\s*(['"]))([^'"\n]*)(\2)/g,
    (_, head, _q, body, tail) => head + ' '.repeat(body.length) + tail,
  );
}

export function findUnextracted(src) {
  const stripped = blankComments(src);
  const strippedText = blankAttrValues(stripped);
  const lines = src.split('\n');
  const found = [];
  const push = (idx, kind, text) => {
    const line = lineOf(src, idx);
    if (exemptAt(lines, line)) return;
    found.push({ line, kind, text });
  };

  // 1. JSX text nodes: `>…<` with the `{…}` expression containers removed.
  const textRe = />([^<>]*)</g;
  let m;
  while ((m = textRe.exec(strippedText))) {
    // `=>` — the `>` of an arrow function closes nothing. Without this, the generic in
    // `(d: Map<string, number>) => Column<T>[]` reads as the rendered text "Column".
    if (m.index > 0 && strippedText[m.index - 1] === '=') continue;
    const start = m.index + 1;
    const raw = src.slice(start, start + m[1].length);
    let text = '';
    let depth = 0;
    for (const ch of raw) {
      if (ch === '{') {
        depth++;
        continue;
      }
      if (ch === '}') {
        if (depth) depth--;
        continue;
      }
      if (!depth) text += ch;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!/[A-Za-z]{2}/.test(text)) continue; // punctuation, digits, a lone separator
    if (/[;=()&|]/.test(text)) continue; // code, not prose
    if (STOP_WORDS.test(text)) continue;
    if (/^[:.?]/.test(text)) continue; // a ternary or type fragment
    // A leading comma is usually a type-argument fragment (`Array<Foo>, Bar<Baz>` → ", Bar"),
    // but it is also how an interleaved prose fragment starts (", requested by "). Keep it only
    // when a lowercase word survives, which an identifier list does not have.
    if (/^,/.test(text) && !/(^|\s)[a-z]{2,}(\s|$)/.test(text.replace(/^,\s*/, ''))) continue;
    if (NOT_PROSE.test(text)) continue;
    push(start, 'jsx-text', text);
  }

  // 2. Label-bearing JSX props with a bare string value. `label={t('k', 'X')}` cannot match:
  //    its value starts with `{`, not a quote.
  for (const p of stripped.matchAll(new RegExp(`\\b(${LABEL_PROPS})\\s*=\\s*(['"])([^'"\\n]*)\\2`, 'g'))) {
    const value = src.slice(p.index + p[0].indexOf(p[2]) + 1, p.index + p[0].length - 1).trim();
    if (!/[A-Za-z]{2}/.test(value) || NOT_PROSE.test(value)) continue;
    push(p.index, 'jsx-prop', `${p[1]}="${value}"`);
  }

  // 3. Object-literal label fields with a bare string value.
  for (const f of stripped.matchAll(new RegExp(`\\b(${LABEL_FIELDS})\\s*:\\s*(['"])([^'"\\n]*)\\2`, 'g'))) {
    const value = src.slice(f.index + f[0].indexOf(f[2]) + 1, f.index + f[0].length - 1).trim();
    if (!/[A-Za-z]{2}/.test(value) || NOT_PROSE.test(value)) continue;
    push(f.index, 'object-field', `${f[1]}: '${value}'`);
  }

  return found.sort((a, b) => a.line - b.line);
}

/** `{a: {b: 'x'}}` → `['a.b']`. Plural suffixes are ordinary keys; i18next resolves them itself. */
export function flattenCatalogue(node, prefix = '', out = []) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenCatalogue(v, key, out);
    else out.push(key);
  }
  return out;
}

/** `{a: {b: 'x'}}` → `Map('a.b' → 'x')` — the value-preserving flatten the id half needs, because
 *  "present but empty" and "absent" are different defects with the same rendered symptom. */
function catalogueValueForDefault(catalogue, dotted) {
  let cur = catalogue;
  for (const part of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

export function flattenCatalogueEntries(node, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenCatalogueEntries(v, key, out);
    else out.set(key, v);
  }
  return out;
}

// ── The analyser ────────────────────────────────────────────────────────────────────────────

/**
 * i18next plural suffixes (CLDR categories). A count-bearing key lives in the catalogue ONLY in
 * its suffixed forms — `foo_one`, `foo_other` — while the source references the BASE `foo`, because
 * i18next picks the form at call time via `Intl.PluralRules`.
 *
 * ⚑ WITHOUT THIS THE GATE PUNISHES THE CORRECT PATTERN. Every suffixed key reads as an orphan
 * ("referenced by no source file") and the base reads as missing, so the only way to a green gate
 * is to weld the English plural into the source — which is exactly the defect DD-I18N-1 forbids and
 * exactly what four Gantt strings did for two milestones (#575). A gate that fails the right answer
 * teaches the wrong one.
 *
 * All six CLDR categories are listed, not just the two English uses: a translator adding `_few` for
 * a language that has it must not turn this gate red.
 */
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

/** `foo_other` → `foo`; anything else unchanged. */
function pluralBase(key) {
  const hit = PLURAL_SUFFIXES.find((suffix) => key.endsWith(suffix));
  return hit ? key.slice(0, -hit.length) : key;
}

/**
 * True when the catalogue carries a USABLE plural set for a base key the source references.
 *
 * ⚑ `_other` SPECIFICALLY, not "any suffix". CLDR requires `other` in every language — it is the
 * only category Indonesian has at all. So a set holding `_one` without `_other` is not a partial
 * translation, it is a key an Indonesian reader can never hit: every count falls through to the
 * English default while this gate reports green. Accepting any-suffix was the first version of
 * this function and it passed exactly that catalogue when tested (#575).
 */
function hasRequiredPluralForm(known, key) {
  return known.has(`${key}_other`);
}

/**
 * The whole check, over in-memory inputs so the self-test can exercise THIS function rather
 * than a re-implementation of it. A gate whose self-test tests a copy proves nothing about the
 * gate — that is the `check-edge-fn-test-binding` rule applied to this script itself.
 *
 * @param launchScopeFiles {Record<string,string>} rel path → source, the routed screens
 * @param referenceFiles   {Record<string,string>} rel path → source, the whole app
 * @param catalogue        {object} the parsed `en` catalogue
 */
export function analyse({ launchScopeFiles, referenceFiles, catalogue, defaultMismatchBaseline = [] }) {
  const catalogueKeys = flattenCatalogue(catalogue);
  const known = new Set(catalogueKeys);
  const sourceFiles = { ...referenceFiles, ...launchScopeFiles };
  const parsedModules = new Map();
  for (const [file, source] of Object.entries(sourceFiles)) assertSourceSize(file, source);

  const unextracted = [];
  const missing = [];
  const defaultMismatches = [];
  const unverifiedDefaults = [];
  for (const [file, src] of Object.entries(launchScopeFiles)) {
    for (const hit of findUnextracted(src)) unextracted.push({ file, ...hit });
    for (const key of collectKeyRefs(src)) {
      if (!known.has(key) && !hasRequiredPluralForm(known, key)) missing.push({ file, key });
    }
    const sourceFile = getParsedSourceFile(file, src, parsedModules);
    const candidates = collectDefaultCandidates(src, sourceFile);
    const resolution = resolveLiteralConstants(file, sourceFiles, parsedModules);
    for (const candidate of candidates) {
      const reason = resolution.reasons.get(candidateOffset(candidate));
      if (reason) unverifiedDefaults.push({
        file,
        line: lineOf(src, candidate.index),
        key: candidate.key,
        reason,
      });
    }
    for (const hit of inlineDefaultsFromCandidates(candidates, resolution.values)) {
      const catalogueText = catalogueValueForDefault(catalogue, hit.key);
      if (catalogueText === undefined) continue; // Existing missing-key rule owns this finding.
      const normalize = (value) => value.replace(/\s+/g, ' ').trim();
      if (typeof catalogueText === 'string' && normalize(catalogueText) !== normalize(hit.value)) {
        defaultMismatches.push({
          file,
          line: lineOf(src, hit.index),
          key: hit.key,
          defaultValue: hit.value,
          catalogueValue: catalogueText,
        });
      }
    }
  }

  const referenced = new Set();
  for (const src of Object.values(referenceFiles)) {
    for (const key of collectKeyRefs(src)) referenced.add(key);
  }
  const orphans = catalogueKeys.filter((k) => !referenced.has(k) && !referenced.has(pluralBase(k)));

  const signature = (m) => JSON.stringify([m.key, m.defaultValue, m.catalogueValue]);
  const baseline = new Set(defaultMismatchBaseline.map((entry) => signature({
    key: entry.key, defaultValue: entry.defaultValue, catalogueValue: entry.catalogueValue,
  })));
  const present = new Set(defaultMismatches.map(signature));
  const staleDefaultBaseline = [...baseline]
    .filter((entry) => !present.has(entry))
    .map((entry) => JSON.parse(entry));
  const newDefaultMismatches = defaultMismatches.filter((m) => !baseline.has(signature(m)));

  return {
    unextracted,
    missing,
    orphans,
    defaultMismatches,
    newDefaultMismatches,
    staleDefaultBaseline,
    catalogueKeys,
    unverifiedDefaults,
    scope: {
      missing: 'launch-scope-files',
      defaults: 'launch-scope-files',
      orphans: 'reference-files',
      defaultExpressions: 'static-string-expressions-and-direct-constant-imports',
    },
  };
}

/**
 * The id half (FR-L10N-042b, DD-I18N-9 stage 2), over in-memory inputs for the same self-test-
 * binding reason as `analyse`.
 *
 * The launch-scope set is every key a launch-scope screen references that the en catalogue holds
 * — a key en does NOT hold is the en gate's `missing` finding, and double-reporting it here would
 * blame the translation for an extraction gap. Two id-side defects:
 *
 *   UNTRANSLATED — a launch-scope key absent from id, or present with an empty value. Both render
 *   as the English fallback (FR-L10N-041), so neither is visible at runtime.
 *   EXTRANEOUS   — an id key en does not hold. The id tree mirrors en's exactly; a key with no en
 *   counterpart translates text that no longer exists and counts as coverage while doing it.
 */
/**
 * Every interpolation token in a message: `{{name}}` values and `<n>`/`</n>` component slots.
 * Sorted, so a reordered sentence — which translation REQUIRES — is not mistaken for a dropped
 * token. Only the multiset matters.
 */
function placeholders(value) {
  return (value.match(/\{\{\s*\w+\s*\}\}|<\/?\d+>/g) ?? []).sort();
}

/** Read one dotted key out of a nested catalogue object. */
function catalogueValue(catalogue, dotted) {
  let cur = catalogue;
  for (const part of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

export function analyseId({ launchScopeFiles, catalogue, idCatalogue }) {
  for (const [file, source] of Object.entries(launchScopeFiles)) assertSourceSize(file, source);
  const enKeys = new Set(flattenCatalogue(catalogue));
  const idMap = flattenCatalogueEntries(idCatalogue);

  const scopeKeys = new Set();
  for (const src of Object.values(launchScopeFiles)) {
    for (const key of collectKeyRefs(src)) {
      if (enKeys.has(key)) {
        scopeKeys.add(key);
        continue;
      }
      // ⚑ A PLURAL CALL SITE REFERENCES THE BASE, WHICH en NEVER HOLDS. Without this branch the
      // base is silently filtered out and its suffixed forms are checked by NOTHING — so an
      // en-only plural key passes the id gate green while every Indonesian reader gets English at
      // every count. That is stage 2's whole purpose defeated, and it was live: `analyse` was
      // taught about plurals and this sibling was not (#575 review, Critical 1).
      for (const suffix of PLURAL_SUFFIXES) {
        if (enKeys.has(`${key}${suffix}`)) scopeKeys.add(`${key}${suffix}`);
      }
    }
  }

  const untranslated = [];
  const placeholderMismatches = [];
  for (const key of [...scopeKeys].sort()) {
    const v = idMap.get(key);
    if (v === undefined) {
      untranslated.push({ key, why: 'absent' });
      continue;
    }
    if (typeof v === 'string' && !v.trim()) {
      untranslated.push({ key, why: 'empty' });
      continue;
    }
    // ⚑ PRESENCE IS NOT CORRECTNESS. A translation that drops `{{amount}}` or `<3></3>` renders a
    // broken sentence ONLY for Indonesian readers — a money confirmation with no money — and no
    // en-side test can see it. The catalogue was machine-translated in bulk (#567), which is
    // exactly the process that drops a token silently.
    const en = catalogueValue(catalogue, key);
    if (typeof en === 'string') {
      const want = placeholders(en);
      const got = placeholders(v);
      if (want.join('\u0000') !== got.join('\u0000')) {
        placeholderMismatches.push({ key, en: want, id: got });
      }
    }
  }

  const extraneous = [...idMap.keys()].filter((k) => !enKeys.has(k)).sort();

  return {
    untranslated,
    placeholderMismatches,
    extraneous,
    scopeKeyCount: scopeKeys.size,
    idKeyCount: idMap.size,
  };
}

// ── Disk plumbing ───────────────────────────────────────────────────────────────────────────

export function parseRouteList(text) {
  const entries = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [route, ...files] = line.split(/\s+/);
    if (!files.length) {
      throw new Error(`launch-scope-routes.txt: route "${route}" names no file`);
    }
    entries.push({ route, files });
  }
  return entries;
}

const isTestFile = (p) => /\.test\.[cm]?[jt]sx?$/.test(p) || p.includes('__tests__');

function readSourceFile(rel) {
  const fail = (reason) => { throw new Error(`${rel}: ${reason}`); };
  if (typeof rel !== 'string' || rel.includes('\\') || path.posix.isAbsolute(rel)) fail('source-containment');
  const normalized = path.posix.normalize(rel);
  if (!isApprovedSourceMapPath(normalized) || !SOURCE_EXTENSIONS.has(path.posix.extname(normalized))) {
    fail('source-containment');
  }

  const abs = path.resolve(APP, ...normalized.split('/'));
  const lexicalRel = path.relative(APP, abs).split(path.sep).join('/');
  if (!isApprovedSourceMapPath(lexicalRel) || !SOURCE_EXTENSIONS.has(path.posix.extname(lexicalRel))) {
    fail('source-containment');
  }

  let realPath;
  let appRealPath;
  try {
    realPath = fs.realpathSync(abs);
    appRealPath = fs.realpathSync(APP);
  } catch {
    fail('source-read');
  }
  const realRel = path.relative(appRealPath, realPath).split(path.sep).join('/');
  if (!isApprovedSourceMapPath(realRel) || !SOURCE_EXTENSIONS.has(path.posix.extname(realRel))) {
    fail('source-containment');
  }

  let stat;
  try {
    stat = fs.statSync(realPath);
  } catch {
    fail('source-read');
  }
  if (!stat.isFile()) fail('source-read');
  if (stat.size > MAX_SOURCE_BYTES) fail('source-limit');

  let source;
  try {
    source = fs.readFileSync(realPath, 'utf8');
  } catch {
    fail('source-read');
  }
  assertSourceSize(rel, source);
  return source;
}

function expandEntryFile(spec) {
  if (!spec.endsWith('/*.tsx')) return [spec];
  const dir = spec.slice(0, -'/*.tsx'.length);
  const abs = path.join(APP, dir);
  if (!fs.existsSync(abs)) throw new Error(`launch-scope-routes.txt: no such directory "${dir}"`);
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.tsx') && !isTestFile(f))
    .sort()
    .map((f) => `${dir}/${f}`);
}

function walkSources(abs, out = []) {
  if (!fs.existsSync(abs)) return out;
  if (fs.statSync(abs).isFile()) {
    if (SOURCE_EXTENSIONS.has(path.extname(abs)) && !isTestFile(abs)) out.push(abs);
    return out;
  }
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__tests__') continue;
      walkSources(p, out);
    } else if (SOURCE_EXTENSIONS.has(path.extname(e.name)) && !isTestFile(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function readFromDisk() {
  const entries = parseRouteList(fs.readFileSync(ROUTE_LIST, 'utf8'));
  const launchScopeFiles = {};
  for (const entry of entries) {
    for (const spec of entry.files) {
      for (const rel of expandEntryFile(spec)) {
        const abs = path.join(APP, rel);
        if (!fs.existsSync(abs)) {
          throw new Error(
            `launch-scope-routes.txt: route "${entry.route}" names "${rel}", which does not exist`,
          );
        }
        launchScopeFiles[rel] ??= readSourceFile(rel);
      }
    }
  }

  const referenceFiles = {};
  for (const root of REFERENCE_ROOTS) {
    for (const abs of walkSources(path.join(APP, root))) {
      const rel = path.relative(APP, abs).split(path.sep).join('/');
      referenceFiles[rel] = readSourceFile(rel);
    }
  }

  const catalogue = JSON.parse(fs.readFileSync(EN_CATALOGUE, 'utf8'));
  return { entries, launchScopeFiles, referenceFiles, catalogue };
}

/** --id mode ONLY. Kept out of `readFromDisk` so the en-side gate stays structurally incapable
 *  of depending on translation state — the self-test asserts this separation. */
function readIdFromDisk() {
  return JSON.parse(fs.readFileSync(ID_CATALOGUE, 'utf8'));
}

// ── Reporting ───────────────────────────────────────────────────────────────────────────────

function report(result, entries, fileCount) {
  const {
    unextracted, missing, orphans, newDefaultMismatches, staleDefaultBaseline, catalogueKeys,
    scope, unverifiedDefaults = [],
  } = result;
  let failed = false;

  console.log(
    `Scope: missing/defaults=${scope.missing}; orphans=${scope.orphans}; ` +
      `default-expressions=${scope.defaultExpressions}.`,
  );
  console.log(`Unverified defaults: ${unverifiedDefaults.length} (excluded from default equality checks).`);
  for (const item of unverifiedDefaults) {
    console.log(`  ${item.key}  pmo-portal/${item.file}:${item.line}  (${item.reason})`);
  }

  if (unextracted.length) {
    failed = true;
    console.error(
      `\n✗ ${unextracted.length} rendered string(s) on a launch-scope screen are NOT extracted.`,
    );
    console.error(
      `  Wrap each in t('<namespace>.<key>', '<the English text>') and add the key to`,
    );
    console.error(`  pmo-portal/public/locales/en/common.json.`);
    console.error(
      `  If it is NOT rendered — an export-only column header, say (FR-L10N-050 forbids t() on`,
    );
    console.error(
      `  export values) — annotate the line with a reason: // i18n-exempt: <why>\n`,
    );
    for (const u of unextracted) {
      console.error(`  pmo-portal/${u.file}:${u.line}  [${u.kind}]  ${u.text}`);
    }
  }

  if (missing.length) {
    failed = true;
    console.error(`\n✗ ${missing.length} key(s) referenced by a launch-scope screen are absent`);
    console.error(`  from the en catalogue. They render as their English default today, so`);
    console.error(`  nothing looks broken — and nothing will ever translate them.\n`);
    for (const m of missing) console.error(`  pmo-portal/${m.file}  →  ${m.key}`);
  }

  if (orphans.length) {
    failed = true;
    console.error(`\n✗ ${orphans.length} orphaned key(s): present in the en catalogue, referenced`);
    console.error(`  by no source file. They point at text that no longer exists, and they count`);
    console.error(`  as coverage while doing it. Delete them, or restore the call site.\n`);
    for (const k of orphans) console.error(`  ${k}`);
  }

  if (newDefaultMismatches.length) {
    failed = true;
    console.error(`\n✗ ${newDefaultMismatches.length} inline English default(s) differ from the en catalogue:`);
    for (const m of newDefaultMismatches) {
      console.error(`  ${m.key}  pmo-portal/${m.file}:${m.line}\n    default: ${m.defaultValue}\n    catalogue: ${m.catalogueValue}`);
    }
  }
  if (staleDefaultBaseline.length) {
    failed = true;
    console.error(`\n✗ ${staleDefaultBaseline.length} stale inline-default baseline entry(ies); remove them:`);
    for (const [key, defaultValue, catalogueValue] of staleDefaultBaseline) {
      console.error(`  ${key}\n    default: ${defaultValue}\n    catalogue: ${catalogueValue}`);
    }
  }

  if (failed) {
    console.error(`\nFR-L10N-042a — the en-side i18n completeness gate. See`);
    console.error(`pmo-portal/src/lib/i18n/launch-scope-routes.txt for what is in scope and why.`);
    return 1;
  }

  console.log(
    `✓ i18n completeness (en): ${entries.length} launch-scope route(s) / ${fileCount} file(s), ` +
      `${catalogueKeys.length} catalogue key(s) — none unextracted, none missing, none orphaned.`,
  );
  return 0;
}

function reportId(result, entries, fileCount) {
  const { untranslated, placeholderMismatches, extraneous, scopeKeyCount, idKeyCount } = result;
  let failed = false;

  if (untranslated.length) {
    failed = true;
    console.error(
      `\n✗ ${untranslated.length} launch-scope key(s) are not translated in the id catalogue.`,
    );
    console.error(`  A missing or empty id value renders as its English fallback (FR-L10N-041),`);
    console.error(`  so nothing looks broken — and a client reads English. Add each key to`);
    console.error(`  pmo-portal/public/locales/id/common.json with a non-empty translation.\n`);
    for (const u of untranslated) console.error(`  ${u.key}  (${u.why})`);
  }

  if (placeholderMismatches?.length) {
    failed = true;
    console.error(
      `\n✗ ${placeholderMismatches.length} id value(s) do not carry en's interpolation tokens.`,
    );
    console.error(`  The translation is PRESENT but structurally wrong: a dropped {{value}} or`);
    console.error(`  <n></n> slot removes a figure from the rendered sentence — a money confirm`);
    console.error(`  with no money — and it breaks for Indonesian readers ONLY, where no en-side`);
    console.error(`  test can see it. Reordering is fine; losing a token is not.\n`);
    for (const m of placeholderMismatches) {
      console.error(`  ${m.key}\n    en: ${m.en.join(' ') || '(none)'}\n    id: ${m.id.join(' ') || '(none)'}`);
    }
  }

  if (extraneous.length) {
    failed = true;
    console.error(`\n✗ ${extraneous.length} id key(s) have no en counterpart. The id tree mirrors`);
    console.error(`  en's exactly — these translate text that no longer exists, and they count as`);
    console.error(`  coverage while doing it. Delete them, or restore the en key.\n`);
    for (const k of extraneous) console.error(`  ${k}`);
  }

  if (failed) {
    console.error(`\nFR-L10N-042b — the id-side i18n completeness gate (DD-I18N-9 stage 2). See`);
    console.error(`pmo-portal/src/lib/i18n/launch-scope-routes.txt for what is in scope and why.`);
    return 1;
  }

  console.log(
    `✓ i18n completeness (id): ${entries.length} launch-scope route(s) / ${fileCount} file(s), ` +
      `${scopeKeyCount} launch-scope key(s) all translated non-empty; ` +
      `${idKeyCount} id key(s), none without an en counterpart.`,
  );
  return 0;
}

// ── Self-test ───────────────────────────────────────────────────────────────────────────────

/**
 * ⚑ The fixtures below are ASSEMBLED AT RUNTIME, never written as whole literals.
 *
 * This script lives inside the tree it scans. A fixture written literally — a planted key as a
 * real `t('probe.missing', …)` call, a planted orphan spelled out in full — could be picked up
 * by the very scan it is meant to test the moment the reference roots widen or this file moves,
 * and a planted defect that reads as legitimately referenced turns a red self-test green while
 * looking correct. Splitting the strings makes that impossible by construction rather than by
 * remembering where the script sits.
 */
function selfTest() {
  const T = 't';
  const Q = "'";
  const k = (...parts) => parts.join('.');
  const call = (key, def) => `${T}(${Q}${key}${Q}, ${Q}${def}${def ? '' : ''}${Q})`;

  const NS = ['probe', 'fixture'].join('');
  const OK_KEY = k(NS, 'greeting');
  const PLANTED_KEY = k(NS, ['un', 'known'].join(''));
  const ORPHAN_KEY = k(NS, ['dead', 'Text'].join(''));
  const RAW = ['Unwrapped', 'launch', 'scope', 'copy'].join(' ');

  const clean = {
    launchScopeFiles: {
      'pages/Probe.tsx': `export const P = () => <p>{${call(OK_KEY, 'Hello there')}}</p>;\n`,
    },
    referenceFiles: {
      'pages/Probe.tsx': `export const P = () => <p>{${call(OK_KEY, 'Hello there')}}</p>;\n`,
    },
    catalogue: { [NS]: { greeting: 'Hello there' } },
  };

  const cases = [];
  const check = (name, ok, detail) => cases.push({ name, ok, detail });
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

  // AC-V24P-015: AST references are scoped to the actual launch and reference maps.
  {
    const key = JSON.stringify(PLANTED_KEY);
    const sources = [
      `t(${key}, 'Hello')`,
      `i18n.t(${key}, 'Hello')`,
      `<Trans i18nKey=${key} defaults="Hello" />`,
      `<Trans i18nKey={${key}} defaults={'Hello'} />`,
    ];
    for (const src of sources) {
      const result = runAC(src);
      ac('removed supported key', result.missing, [{ file: acFile, key: PLANTED_KEY }]);
      ac('declared checking scope', result.scope, acScope);
    }

    const ref = `i18n.t(${JSON.stringify(OK_KEY)}, 'Hello')`;
    const referenceOnly = runAC('', 'Hello', {
      launchScopeFiles: {}, referenceFiles: { [acFile]: ref },
    });
    ac('reference-only is not missing scope', referenceOnly.missing, []);
    ac('reference-only is not orphan', referenceOnly.orphans, []);
    ac('comment shapes ignored', [...collectKeyRefs(`// ${sources[1]}\n/* ${sources[2]} */`)], []);
    ac('code-looking string ignored', [...collectKeyRefs(`const prose = ${JSON.stringify(sources[1])}`)], []);
    ac('unrelated JSX key ignored', [...collectKeyRefs(`<Other i18nKey=${JSON.stringify(PLANTED_KEY)} />`)], []);

    const pluralSources = [
      `t(${JSON.stringify(OK_KEY)}, 'Hello')`,
      `i18n.t(${JSON.stringify(OK_KEY)}, 'Hello')`,
      `<Trans i18nKey=${JSON.stringify(OK_KEY)} defaults="Hello" />`,
      `<Trans i18nKey={${JSON.stringify(OK_KEY)}} defaults={'Hello'} />`,
    ];
    for (const src of pluralSources) {
      const plural = runAC(src, 'Hello', { catalogue: { [NS]: { greeting_other: 'Hello' } } });
      ac('plural other satisfies base', plural.missing, []);
      const incomplete = runAC(src, 'Hello', { catalogue: { [NS]: { greeting_one: 'Hello' } } });
      ac('plural one alone leaves base missing', incomplete.missing, [{ file: acFile, key: OK_KEY }]);
    }
    ac('id mode shares AST key collection', analyseId({
      launchScopeFiles: { [acFile]: `i18n.t(${JSON.stringify(OK_KEY)}, 'Hello')` },
      catalogue: { [NS]: { greeting: 'Hello' } }, idCatalogue: {},
    }).untranslated, [{ key: OK_KEY, why: 'absent' }]);
  }

  // AC-V24P-015: Trans compares the entire decoded fallback, including markup.
  {
    const text = 'Hello <strong>{{person}}</strong>';
    const trans = (value) => `<Trans i18nKey={${JSON.stringify(OK_KEY)}} defaults={${JSON.stringify(value)}} />`;
    ac('markup whitespace equivalent', runAC(trans(' Hello  <strong>{{person}}</strong>\n'), text).defaultMismatches, []);
    const drift = runAC(trans('Hello <em>{{person}}</em>'), text);
    ac('markup drift exact tuple', drift.newDefaultMismatches.map(({ key, defaultValue, catalogueValue }) =>
      [key, defaultValue, catalogueValue]), [[OK_KEY, 'Hello <em>{{person}}</em>', text]]);

    const baseline = [{ key: OK_KEY, defaultValue: 'Hello <em>{{person}}</em>', catalogueValue: text }];
    const kept = runAC(trans(baseline[0].defaultValue), text, { defaultMismatchBaseline: baseline });
    ac('exact tuple remains known', [kept.defaultMismatches.length, kept.newDefaultMismatches, kept.staleDefaultBaseline], [1, [], []]);
    ac('stale tuple preserved', runAC(trans(text), text, { defaultMismatchBaseline: baseline }).staleDefaultBaseline,
      [[OK_KEY, baseline[0].defaultValue, text]]);
    ac('changed original whitespace is new baseline signature',
      runAC(trans(' Hello <em>{{person}}</em>'), text, { defaultMismatchBaseline: baseline }).newDefaultMismatches.length, 1);

    const quotedEntity = `<Trans i18nKey=${JSON.stringify(OK_KEY)} defaults="A&amp;&quot;&#65;&#x42;&unknown;" />`;
    ac('quoted JSX entities decoded and unknown retained', collectInlineDefaults(quotedEntity).map(({ key, value }) => [key, value]),
      [[OK_KEY, 'A&"AB&unknown;']]);
    ac('quoted JSX entity default compares decoded text', runAC(quotedEntity, 'A&"AB&unknown;').defaultMismatches, []);
    ac('quoted JSX entity keys decode', [...collectKeyRefs('<Trans i18nKey="probe&amp;key" />')], ['probe&key']);
    const ordinaryString = `t(${JSON.stringify(OK_KEY)}, '&amp;')`;
    ac('ordinary JavaScript string entities stay literal', collectInlineDefaults(ordinaryString).map(({ key, value }) => [key, value]),
      [[OK_KEY, '&amp;']]);
    ac('ordinary JavaScript string compares literally', runAC(ordinaryString, '&').newDefaultMismatches.map(({ defaultValue, catalogueValue }) =>
      [defaultValue, catalogueValue]), [['&amp;', '&']]);
    const multiline = `const Component = () => (\n  <Trans\n    i18nKey={${JSON.stringify(OK_KEY)}}\n    defaults="Welcome"\n  />\n);`;
    ac('multiline Trans reports opening tag line', runAC(multiline, 'Hello').defaultMismatches.map(({ line }) => line), [2]);
    const childrenOnly = `<Trans i18nKey=${JSON.stringify(OK_KEY)}>Hello</Trans>`;
    ac('children-only Trans has no explicit default', collectInlineDefaults(childrenOnly), []);
  }

  // AC-V24P-015: local defaults resolve only through the nearest static lexical const.
  {
    const key = JSON.stringify(OK_KEY);
    const local = `const FIRST = 'Hel'; const TEXT = FIRST + 'lo'; t(${key}, TEXT);`;
    ac('local const concat compared', runAC(local, 'Different').newDefaultMismatches.map(({ key: foundKey, defaultValue }) =>
      [foundKey, defaultValue]), [[OK_KEY, 'Hello']]);
    ac('matching local expression', runAC(local).defaultMismatches, []);
    const optionAlias = `const TEXT = 'Hello'; t(${key}, { defaultValue: TEXT });`;
    ac('defaultValue identifier resolves', runAC(optionAlias, 'Different').newDefaultMismatches.map(({ key: foundKey, defaultValue }) =>
      [foundKey, defaultValue]), [[OK_KEY, 'Hello']]);
    const transAlias = `<Trans i18nKey={${key}} defaults={TEXT} />; const TEXT = 'Hello';`;
    ac('Trans identifier resolves', runAC(transAlias, 'Different').newDefaultMismatches.map(({ key: foundKey, defaultValue }) =>
      [foundKey, defaultValue]), [[OK_KEY, 'Hello']]);

    const shadow = `const TEXT = 'Hello'; function f(TEXT) { return t(${key}, TEXT); }`;
    ac('parameter shadows literal', runAC(shadow).unverifiedDefaults ?? [],
      [{ file: acFile, line: 1, key: OK_KEY, reason: 'unsupported-binding' }]);
    const runtime = `t(${key}, makeLabel())`;
    ac('runtime is unverified', runAC(runtime).unverifiedDefaults ?? [],
      [{ file: acFile, line: 1, key: OK_KEY, reason: 'runtime-expression' }]);
    ac('runtime has no fabricated mismatch', runAC(runtime, 'Different').defaultMismatches, []);
    ac('numeric concat not coerced', runAC(`const TEXT = 'Hello' + 1; t(${key},TEXT)`).unverifiedDefaults ?? [],
      [{ file: acFile, line: 1, key: OK_KEY, reason: 'runtime-expression' }]);

    const blockShadow = `const TEXT = 'Hello'; { let TEXT = makeLabel(); t(${key}, TEXT); }`;
    ac('block let shadows outer const', runAC(blockShadow).unverifiedDefaults ?? [],
      [{ file: acFile, line: 1, key: OK_KEY, reason: 'unsupported-binding' }]);
    const localLiteral = `const TEXT = 'Hello'; t(${key}, TEXT);`;
    ac('nearest local const resolves', runAC(localLiteral, 'Different').newDefaultMismatches.map(({ defaultValue }) => [defaultValue]),
      [['Hello']]);
    const duplicate = `const TEXT = 'Hello'; const TEXT = 'World'; t(${key}, TEXT);`;
    ac('duplicate const is ambiguous', runAC(duplicate).unverifiedDefaults ?? [],
      [{ file: acFile, line: 1, key: OK_KEY, reason: 'ambiguous-binding' }]);
    ac('unresolved identifier reason', runAC(`t(${key}, UNKNOWN)`).unverifiedDefaults ?? [],
      [{ file: acFile, line: 1, key: OK_KEY, reason: 'unresolved-binding' }]);
    ac('no-substitution template resolves', runAC(`const TEXT = \`Hello\`; t(${key}, TEXT)`, 'Different').newDefaultMismatches.map(({ defaultValue }) =>
      [defaultValue]), [['Hello']]);
    ac('parenthesized literal resolves', runAC(`t(${key}, (('Hello')))`, 'Different').newDefaultMismatches.map(({ defaultValue }) =>
      [defaultValue]), [['Hello']]);
    ac('spread option is unverified', runAC(`t(${key}, { ...options, defaultValue: 'Hello' })`).unverifiedDefaults ?? [],
      [{ file: acFile, line: 1, key: OK_KEY, reason: 'runtime-expression' }]);
    ac('duplicate option is unverified', runAC(`t(${key}, { defaultValue: 'Hello', defaultValue: 'World' })`).unverifiedDefaults ?? [],
      [{ file: acFile, line: 1, key: OK_KEY, reason: 'runtime-expression' }]);
    const missingRuntime = runAC(`t(${JSON.stringify(PLANTED_KEY)}, makeLabel())`);
    ac('unverified default keeps missing key', missingRuntime.missing, [{ file: acFile, key: PLANTED_KEY }]);
    ac('no explicit default is not unverified', runAC(`t(${key})`).unverifiedDefaults ?? [], []);

    const cycle = `const A = B; const B = A; t(${key}, A)`;
    ac('cycle remains unverified', runAC(cycle).unverifiedDefaults ?? [],
      [{ file: acFile, line: 1, key: OK_KEY, reason: 'cyclic-binding' }]);
    const deep = Array.from({ length: 40 }, (_, i) =>
      `const S${i} = ${i === 39 ? "'Hello'" : `S${i + 1}`};`).join('\n');
    ac('deep alias chain bounded', runAC(`${deep}\nt(${key}, S0)`).unverifiedDefaults ?? [],
      [{ file: acFile, line: 41, key: OK_KEY, reason: 'depth-limit' }]);
  }

  // AC-V24P-015: direct named imports resolve from the supplied source map without execution.
  {
    const key = JSON.stringify(OK_KEY);
    const moduleSource = `throw new Error('must remain inert'); export const SOURCE = 'Hel' + 'lo';`;
    const imported = (specifier) => `import { SOURCE as TEXT } from ${JSON.stringify(specifier)}; t(${key}, TEXT)`;
    const importedRun = (source, modulePath, sourceText, text) => runAC(source, text, {
      referenceFiles: { [acFile]: source, [modulePath]: sourceText },
    });
    const aliasImport = imported('@/src/lib/probeText');
    const aliasResult = importedRun(aliasImport, 'src/lib/probeText.ts', moduleSource, 'Different');
    ac('imported concat compared', aliasResult.newDefaultMismatches.map(({ key: foundKey, defaultValue }) =>
      [foundKey, defaultValue]), [[OK_KEY, 'Hello']]);
    ac('imported literal equality', importedRun(aliasImport, 'src/lib/probeText.ts', moduleSource, 'Hello').defaultMismatches, []);
    ac('imported literal verified', importedRun(aliasImport, 'src/lib/probeText.ts', moduleSource, 'Hello').unverifiedDefaults, []);
    ac('relative import resolves', importedRun(imported('../src/lib/probeText'), 'src/lib/probeText.ts', moduleSource, 'Different').newDefaultMismatches.map(({ defaultValue }) =>
      [defaultValue]), [['Hello']]);

    for (const extension of ['.ts', '.tsx', '.js', '.jsx']) {
      const modulePath = `src/lib/probeText${extension}`;
      const source = imported(`@/${modulePath}`);
      ac(`exact ${extension} import resolves`, importedRun(source, modulePath, `export const SOURCE = 'Hello';`, 'Different').newDefaultMismatches.map(({ defaultValue }) =>
        [defaultValue]), [['Hello']]);
    }
    const appRootImport = imported('@/App');
    ac('app-root source import resolves', runAC(appRootImport, 'Different', {
      referenceFiles: { [acFile]: appRootImport, 'App.tsx': `export const SOURCE = 'Hello';` },
    }).newDefaultMismatches.map(({ defaultValue }) => [defaultValue]), [['Hello']]);
    const indexPath = 'src/lib/probeFolder/index.ts';
    ac('index.ts import resolves', importedRun(imported('@/src/lib/probeFolder'), indexPath,
      `export const SOURCE = 'Hello';`, 'Different').newDefaultMismatches.map(({ defaultValue }) => [defaultValue]), [['Hello']]);
    ac('same-file exported alias resolves', importedRun(aliasImport, 'src/lib/probeText.ts',
      `const PREFIX = 'Hel'; export const SOURCE = PREFIX + 'lo';`, 'Different').newDefaultMismatches.map(({ defaultValue }) =>
      [defaultValue]), [['Hello']]);

    const identityRefs = {
      [acFile]: imported('@/src/lib/first'),
      'src/lib/first.ts': `export const SOURCE = 'First';`,
      'src/lib/second.ts': `export const SOURCE = 'Second';`,
    };
    ac('import resolves only the named target', runAC(identityRefs[acFile], 'Different', {
      referenceFiles: identityRefs,
    }).newDefaultMismatches.map(({ defaultValue }) => [defaultValue]), [['First']]);
    ac('non-exported local is not an import target', importedRun(aliasImport, 'src/lib/probeText.ts',
      `const SOURCE = 'Hello';`, 'Different').unverifiedDefaults.map(({ reason }) => [reason]), [['nonliteral-export']]);
    ac('missing source-map target is explicit', runAC(imported('@/src/lib/missing'), 'Hello').unverifiedDefaults.map(({ reason }) =>
      [reason]), [['missing-module']]);
    ac('dynamic exported initializer is unverified', importedRun(aliasImport, 'src/lib/probeText.ts',
      `export const SOURCE = makeLabel();`, 'Different').unverifiedDefaults.map(({ reason }) => [reason]), [['nonliteral-export']]);

    const shadowParameter = importedRun(
      `import { SOURCE as TEXT } from '@/src/lib/probeText'; function f(TEXT) { return t(${key}, TEXT); }`,
      'src/lib/probeText.ts', `export const SOURCE = 'Hello';`, 'Different');
    ac('parameter shadows imported value', shadowParameter.unverifiedDefaults.map(({ reason }) => [reason]), [['unsupported-binding']]);
    const shadowBlock = importedRun(
      `import { SOURCE as TEXT } from '@/src/lib/probeText'; { let TEXT = makeLabel(); t(${key}, TEXT); }`,
      'src/lib/probeText.ts', `export const SOURCE = 'Hello';`, 'Different');
    ac('block let shadows imported value', shadowBlock.unverifiedDefaults.map(({ reason }) => [reason]), [['unsupported-binding']]);

    const sourceMap = { [acFile]: aliasImport, 'src/lib/probeText.ts': moduleSource };
    const before = JSON.stringify(sourceMap);
    runAC(aliasImport, 'Hello', { referenceFiles: sourceMap });
    ac('import analysis leaves source maps unchanged', JSON.stringify(sourceMap), before);
  }

  // AC-V24P-015: imported resolution and disk loading remain explicitly bounded.
  {
    const key = JSON.stringify(OK_KEY);
    const makeImports = (count, specifier = (i) => `@/src/lib/guard-${i}`) => {
      const imports = Array.from({ length: count }, (_, i) =>
        `import { SOURCE as TEXT${i} } from ${JSON.stringify(specifier(i))};`).join('\n');
      const calls = Array.from({ length: count }, (_, i) => `t(${key}, TEXT${i});`).join('\n');
      return `${imports}\n${calls}`;
    };
    const runImport = (src, modules = {}) => runAC(src, 'Hello', {
      referenceFiles: { [acFile]: src, ...modules },
    });
    const manyImports = makeImports(65);
    const manyModules = Object.fromEntries(Array.from({ length: 65 }, (_, i) =>
      [`src/lib/guard-${i}.ts`, `export const SOURCE = 'Hello';`]));
    const limited = runImport(manyImports, manyModules);
    ac('64 distinct imported targets resolve before the 65th is bounded',
      [limited.unverifiedDefaults.length, limited.unverifiedDefaults.map(({ reason }) => reason), limited.defaultMismatches],
      [1, ['import-limit'], []]);

    const repeated = makeImports(65, () => '@/src/lib/repeated');
    ac('repeated aliases to one imported target consume one visit',
      runImport(repeated, { 'src/lib/repeated.ts': `export const SOURCE = 'Hello';` }).unverifiedDefaults, []);

    const splitSource = (first, count) => makeImports(count, (i) => `@/src/lib/split-${first + i}`);
    const firstLaunch = splitSource(0, 40);
    const secondLaunch = splitSource(40, 40);
    const splitModules = Object.fromEntries(Array.from({ length: 80 }, (_, i) =>
      [`src/lib/split-${i}.ts`, `export const SOURCE = 'Hello';`]));
    const splitAnalysis = analyse({
      launchScopeFiles: { 'pages/First.tsx': firstLaunch, 'pages/Second.tsx': secondLaunch },
      referenceFiles: { 'pages/First.tsx': firstLaunch, 'pages/Second.tsx': secondLaunch, ...splitModules },
      catalogue: { [NS]: { greeting: 'Hello' } },
    });
    ac('distinct-target cap resets for each launch file', splitAnalysis.unverifiedDefaults, []);

    const parentheses = (depth) => `${'('.repeat(depth)}'Hello'${')'.repeat(depth)}`;
    ac('30 parenthesized levels resolve', runAC(`t(${key}, ${parentheses(30)})`, 'Different').newDefaultMismatches.map(({ defaultValue }) =>
      [defaultValue]), [['Hello']]);
    ac('33 parenthesized levels are bounded', runAC(`t(${key}, ${parentheses(33)})`).unverifiedDefaults.map(({ reason }) => [reason]),
      [['depth-limit']]);
    ac('exact depth 31 resolves', runAC(`t(${key}, ${parentheses(31)})`, 'Different').newDefaultMismatches.map(({ defaultValue }) =>
      [defaultValue]), [['Hello']]);
    ac('exact depth 32 is rejected', runAC(`t(${key}, ${parentheses(32)})`).unverifiedDefaults.map(({ reason }) => [reason]),
      [['depth-limit']]);
    ac('dynamic concat operand is unverified', runAC(`const TEXT = 'Hello' + getSuffix(); t(${key}, TEXT)`).unverifiedDefaults.map(({ reason }) =>
      [reason]), [['runtime-expression']]);

    const unsupported = [
      ['type-only import', `import type { SOURCE as TEXT } from '@/src/lib/probeText'; t(${key}, TEXT)`, 'unsupported-import'],
      ['default import', `import TEXT from '@/src/lib/probeText'; t(${key}, TEXT)`, 'unsupported-import'],
      ['namespace import', `import * as TEXT from '@/src/lib/probeText'; t(${key}, TEXT)`, 'unsupported-import'],
      ['package import', `import { SOURCE as TEXT } from 'probe-package'; t(${key}, TEXT)`, 'unsupported-import'],
      ['unsupported file extension', `import { SOURCE as TEXT } from '@/src/lib/text.json'; t(${key}, TEXT)`, 'unsupported-import'],
      ['escaping import', `import { SOURCE as TEXT } from '../../../outside'; t(${key}, TEXT)`, 'unsupported-import'],
      ['barrel export', `import { SOURCE as TEXT } from '@/src/lib/barrel'; t(${key}, TEXT)`, 'nonliteral-export'],
      ['second import hop', `import { SOURCE as TEXT } from '@/src/lib/hop'; t(${key}, TEXT)`, 'nonliteral-export'],
    ];
    for (const [name, src, reason] of unsupported) {
      const modules = name === 'barrel export'
        ? { 'src/lib/barrel.ts': `export { SOURCE } from './probeText';` }
        : name === 'unsupported file extension'
          ? { 'src/lib/text.json': `export const SOURCE = 'Hello';` }
        : name === 'second import hop'
          ? { 'src/lib/hop.ts': `import { SOURCE as INNER } from './probeText'; export const SOURCE = INNER;`,
              'src/lib/probeText.ts': `export const SOURCE = 'Hello';` }
          : {};
      ac(`${name} stays explicitly unverified`, runImport(src, modules).unverifiedDefaults.map(({ reason: actual }) => [actual]), [[reason]]);
    }

    const cycleSource = `import { OTHER } from './cycleB'; export const SOURCE = OTHER;`;
    const cycleModules = {
      'src/lib/cycleA.ts': cycleSource,
      'src/lib/cycleB.ts': `import { SOURCE } from './cycleA'; export const OTHER = SOURCE;`,
    };
    const moduleCycle = runImport(`import { SOURCE as TEXT } from '@/src/lib/cycleA'; t(${key}, TEXT)`, cycleModules);
    ac('cyclic module declarations stop without chasing imports', moduleCycle.unverifiedDefaults.map(({ reason }) => [reason]),
      [['nonliteral-export']]);

    const tail = `*/\nt(${key}, 'Hello')`;
    const exactSource = `/*${'x'.repeat(1_048_576 - Buffer.byteLength(`/*${tail}`))}${tail}`;
    ac('exactly 1 MiB source-map entry is accepted',
      [Buffer.byteLength(exactSource), runAC(exactSource, 'Hello', { referenceFiles: { [acFile]: exactSource } }).unverifiedDefaults],
      [1_048_576, []]);

    let oversizedError;
    try {
      runAC(`${exactSource} `, 'Hello', { referenceFiles: { [acFile]: `${exactSource} ` } });
    } catch (error) {
      oversizedError = error.message;
    }
    ac('one byte over 1 MiB fails before AST analysis', oversizedError, `${acFile}: source-limit`);

    const readSource = (rel) => typeof readSourceFile === 'function'
      ? readSourceFile(rel)
      : (() => { throw new Error(`${rel}: source-reader-unavailable`); })();
    const suffix = `${process.pid}-${Date.now()}`;
    const ordinaryRel = `pages/.i18n-guard-selftest-${suffix}.ts`;
    const outsideDir = fs.mkdtempSync(path.join(path.dirname(APP), `.i18n-guard-external-${suffix}-`));
    const outsideFile = path.join(outsideDir, 'outside.ts');
    const linkRel = `pages/.i18n-guard-selftest-link-${suffix}.ts`;
    const largeRel = `pages/.i18n-guard-selftest-large-${suffix}.ts`;
    const ordinaryAbs = path.join(APP, ordinaryRel);
    const linkAbs = path.join(APP, linkRel);
    const largeAbs = path.join(APP, largeRel);
    const outsideText = `export const OUTSIDE = '${suffix}';`;
    const originalReadFileSync = fs.readFileSync;
    const reads = [];
    let ordinaryText;
    let ordinaryError;
    let linkError;
    let largeError;
    let escapeError;
    let outsideRead = false;
    let oversizedRead = false;
    try {
      fs.writeFileSync(ordinaryAbs, `export const SAFE = 'inside';`);
      fs.writeFileSync(outsideFile, outsideText);
      fs.symlinkSync(outsideFile, linkAbs);
      fs.writeFileSync(largeAbs, 'x'.repeat(1_048_577));
      fs.readFileSync = function monitoredRead(file, ...args) {
        const resolved = typeof file === 'string' ? path.resolve(file) : '';
        if (resolved === path.resolve(outsideFile)) outsideRead = true;
        if (resolved === path.resolve(largeAbs)) oversizedRead = true;
        reads.push(resolved);
        return originalReadFileSync.call(this, file, ...args);
      };
      try { ordinaryText = readSource(ordinaryRel); } catch (error) { ordinaryError = error.message; }
      try { readSource(linkRel); } catch (error) { linkError = error.message; }
      try { readSource(largeRel); } catch (error) { largeError = error.message; }
      try { readSource('../outside.ts'); } catch (error) { escapeError = error.message; }
    } finally {
      fs.readFileSync = originalReadFileSync;
      fs.rmSync(ordinaryAbs, { force: true });
      fs.rmSync(linkAbs, { force: true });
      fs.rmSync(largeAbs, { force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
    ac('approved source is read', [ordinaryText, ordinaryError], [`export const SAFE = 'inside';`, undefined]);
    ac('outside symlink is rejected before its contents are read', [linkError, outsideRead, linkError?.includes(outsideText)],
      [`${linkRel}: source-containment`, false, false]);
    ac('oversized file is rejected before readFileSync', [largeError, oversizedRead],
      [`${largeRel}: source-limit`, false]);
    ac('lexically escaping source path is rejected', escapeError, '../outside.ts: source-containment');
  }

  // AC-V24P-015: the reporter keeps unresolved defaults visible without making them failures.
  {
    const captureReport = (result) => {
      const originalLog = console.log;
      const originalError = console.error;
      let output = '';
      let exitCode;
      try {
        console.log = (...args) => { output += `${args.join(' ')}\n`; };
        console.error = (...args) => { output += `${args.join(' ')}\n`; };
        exitCode = report(result, [{ route: '/probe', files: [acFile] }], 1);
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
      return { exitCode, output };
    };
    const scopeLine = 'Scope: missing/defaults=launch-scope-files; orphans=reference-files; ' +
      'default-expressions=static-string-expressions-and-direct-constant-imports.';
    const unverifiedLine = 'Unverified defaults: 1 (excluded from default equality checks).';
    const unresolved = captureReport(runAC(`t(${JSON.stringify(OK_KEY)}, makeLabel())`));
    ac('unverified-only report stays informational and names scope/key/location/reason',
      [unresolved.exitCode, unresolved.output.includes(scopeLine), unresolved.output.includes(unverifiedLine),
        unresolved.output.includes(`${acFile}:1`), unresolved.output.includes(OK_KEY), unresolved.output.includes('runtime-expression')],
      [0, true, true, true, true, true]);

    const missingWithUnverified = captureReport(runAC(`t(${JSON.stringify(PLANTED_KEY)}, makeLabel())`));
    ac('unverified report does not suppress missing-key failure',
      [missingWithUnverified.exitCode, missingWithUnverified.output.includes(scopeLine),
        missingWithUnverified.output.includes(unverifiedLine), missingWithUnverified.output.includes(PLANTED_KEY)],
      [1, true, true, true]);

    const baselineWithUnverified = captureReport(runAC(`t(${JSON.stringify(OK_KEY)}, makeLabel())`, 'Hello', {
      defaultMismatchBaseline: [{ key: OK_KEY, defaultValue: 'Obsolete', catalogueValue: 'Hello' }],
    }));
    ac('unverified report does not suppress stale-baseline failure',
      [baselineWithUnverified.exitCode, baselineWithUnverified.output.includes(unverifiedLine),
        baselineWithUnverified.output.includes('stale inline-default baseline')], [1, true, true]);

    const allStatic = captureReport(runAC(`t(${JSON.stringify(OK_KEY)}, 'Hello')`));
    ac('all-static report prints zero unverified defaults', allStatic.output.includes(
      'Unverified defaults: 0 (excluded from default equality checks).'), true);
  }

  // 0. Clean fixture passes — the control. Without it, a self-test that only plants defects
  //    would still pass if the analyser reported EVERYTHING as broken.
  {
    const r = analyse(clean);
    check(
      'a clean catalogue passes',
      !r.unextracted.length && !r.missing.length && !r.orphans.length && !r.defaultMismatches.length,
      `unextracted=${r.unextracted.length} missing=${r.missing.length} orphans=${r.orphans.length}`,
    );
  }

  // Inline defaults must match the catalogue for both supported i18next call shapes.
  {
    const stringCall = `t('${OK_KEY}', 'Hello there')`;
    const optionsCall = `t('${OK_KEY}', { defaultValue: 'Hello there' })`;
    const namespacedCall = `i18n.t('${OK_KEY}', { defaultValue: 'Hello there' })`;
    const source = `const a = ${stringCall};\nconst b = ${optionsCall};\nconst c = ${namespacedCall};`;
    const matching = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': source } });
    check('matching string, defaultValue, and i18n.t defaults pass', !matching.defaultMismatches.length, JSON.stringify(matching.defaultMismatches));
    const mismatchSource = `const a = t('${OK_KEY}', 'Good morning');\nconst b = t('${OK_KEY}', { defaultValue: 'Welcome' });`;
    const mismatch = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': mismatchSource } });
    check('string and defaultValue mismatches fail', mismatch.newDefaultMismatches.length === 2,
      JSON.stringify(mismatch.newDefaultMismatches));
    const allowlisted = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': mismatchSource },
      defaultMismatchBaseline: mismatch.defaultMismatches.map(({ key, defaultValue, catalogueValue }) => ({ key, defaultValue, catalogueValue })) });
    check('an allowlisted mismatch is not new', !allowlisted.newDefaultMismatches.length && !allowlisted.staleDefaultBaseline.length, '');
    const stale = analyse({ ...clean, defaultMismatchBaseline: [{ key: OK_KEY, defaultValue: 'Obsolete', catalogueValue: 'Older' }] });
    check('a stale mismatch baseline entry fails', stale.staleDefaultBaseline.length === 1, JSON.stringify(stale.staleDefaultBaseline));
  }

  // Compiler parsing must retain later option properties and decode JS escapes. These cases
  // prevent regressions to regex collection that truncates strings or requires defaultValue last.
  {
    const optionWithTrailingProps = `t('${OK_KEY}', { defaultValue: 'Welcome', value: name })`;
    const escapedQuote = `t('${OK_KEY}', { defaultValue: 'The project\\'s state changed' })`;
    const unicodeEscape = `t('${OK_KEY}', { defaultValue: 'H\\u0065llo there' })`;
    const trailing = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': optionWithTrailingProps } });
    check('defaultValue followed by other properties is collected',
      trailing.newDefaultMismatches.some((m) => m.defaultValue === 'Welcome'), JSON.stringify(trailing.defaultMismatches));
    const quote = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': escapedQuote } });
    check('escaped quote does not truncate a mismatch',
      quote.newDefaultMismatches.some((m) => m.defaultValue === "The project's state changed"), JSON.stringify(quote.defaultMismatches));
    const unicode = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': unicodeEscape } });
    check('decoded unicode escape equal to catalogue passes', !unicode.defaultMismatches.length, JSON.stringify(unicode.defaultMismatches));
  }

  // 1. Plant a MISSING key: a launch-scope screen references a key the catalogue does not hold.
  {
    const src = `export const P = () => <p>{${call(PLANTED_KEY, 'Nowhere')}}</p>;\n`;
    const r = analyse({
      ...clean,
      launchScopeFiles: { 'pages/Probe.tsx': src },
      referenceFiles: { 'pages/Probe.tsx': src, ...clean.referenceFiles },
    });
    check(
      'a missing key fails the gate',
      r.missing.some((m) => m.key === PLANTED_KEY),
      `missing=${JSON.stringify(r.missing.map((m) => m.key))}`,
    );
  }

  // 2. Plant an ORPHAN: a catalogue key no source file references.
  {
    const r = analyse({
      ...clean,
      catalogue: { [NS]: { greeting: 'Hello there', deadText: 'Text nothing renders' } },
    });
    check(
      'an orphaned key fails the gate',
      r.orphans.includes(ORPHAN_KEY),
      `orphans=${JSON.stringify(r.orphans)}`,
    );
  }

  // 3. Plant an UNEXTRACTED rendered string — the half a key-only check cannot see. A JSX text
  //    node and a label prop, because they are found by different rules.
  {
    const DQ = String.fromCharCode(34);
    const src =
      `export const P = () => <p>${RAW}</p>;\n` +
      `export const Q = () => <Field label=${DQ}${RAW}${DQ} />;\n`;
    const r = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': src } });
    check(
      'an unextracted JSX text node fails the gate',
      r.unextracted.some((u) => u.kind === 'jsx-text' && u.text === RAW),
      `unextracted=${JSON.stringify(r.unextracted)}`,
    );
    check(
      'an unextracted label prop fails the gate',
      r.unextracted.some((u) => u.kind === 'jsx-prop'),
      `unextracted=${JSON.stringify(r.unextracted)}`,
    );
  }

  // 4. An extracted string does NOT fail — the false-positive control. Without this, a rule that
  //    flags every string would pass cases 3 and still be useless.
  {
    const src = `export const P = () => <p>{${call(OK_KEY, RAW)}}</p>;\n`;
    const r = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': src } });
    check(
      'an already-extracted string does not fail',
      !r.unextracted.length,
      `unextracted=${JSON.stringify(r.unextracted)}`,
    );
  }

  // 5. A comment is not a call site. `src/lib/i18n/index.ts` documents the convention in prose;
  //    counted as a reference, the illustration becomes a phantom missing key.
  {
    const src = `// see ${call(k(NS, 'illustration'), 'Example')} for the convention\n`;
    const r = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': src } });
    check('a key inside a comment is not a reference', !r.missing.length, `missing=${r.missing.length}`);
  }

  // 5b. `<Trans i18nKey="…">` is a reference, not an orphan (#571). A sentence carrying markup
  //     can only stay ONE translatable string via `<Trans>`; if this gate saw only `t(`, every
  //     such key would read as dead and the fix would be to shatter the sentence back into
  //     English-ordered fragments. Both halves are asserted: the key counts as referenced, and
  //     a `<Trans>` key the catalogue does not hold still reddens the gate.
  {
    const DQ = String.fromCharCode(34);
    const attr = ['i18n', 'Key'].join('');
    const trans = (key) => `<Trans ${attr}=${DQ}${key}${DQ} defaults=${DQ}Hello <b>there</b>${DQ} />`;
    const src = `export const P = () => ${trans(OK_KEY)};\n`;
    const r = analyse({
      ...clean,
      launchScopeFiles: { 'pages/Probe.tsx': src },
      referenceFiles: { 'pages/Probe.tsx': src },
      catalogue: { [NS]: { greeting: 'Hello <b>there</b>' } },
    });
    check(
      'a <Trans i18nKey> key counts as referenced',
      !r.orphans.includes(OK_KEY) && !r.missing.length,
      `orphans=${JSON.stringify(r.orphans)} missing=${JSON.stringify(r.missing.map((x) => x.key))}`,
    );
    const bad = `export const P = () => ${trans(PLANTED_KEY)};\n`;
    const rBad = analyse({
      ...clean,
      launchScopeFiles: { 'pages/Probe.tsx': bad },
      referenceFiles: { 'pages/Probe.tsx': bad, ...clean.referenceFiles },
    });
    check(
      'a <Trans i18nKey> naming a key the catalogue lacks fails the gate',
      rBad.missing.some((x) => x.key === PLANTED_KEY),
      `missing=${JSON.stringify(rBad.missing.map((x) => x.key))}`,
    );
  }

  // 5c. The markup inside a `<Trans defaults="…">` is part of the extracted sentence, not a
  //     rendered text node — and the false-positive it used to raise had only one "fix": break
  //     the sentence back into English-ordered fragments, i.e. re-introduce the defect #571
  //     removed. The apostrophe control is the other half: narrowing rule 1 must not go so wide
  //     that a JSX text node containing `'` stops being scanned.
  {
    const DQ = String.fromCharCode(34);
    const attr = ['def', 'aults'].join('');
    const inner = ['no', 'Timesheet'].join(' ');
    const src =
      `export const P = () => <Trans ${attr}=${DQ}Certify it holds ` +
      `<strong>${inner}</strong> for the week.${DQ} />;\n`;
    const r = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': src } });
    check(
      'markup inside a <Trans defaults> attribute is not a rendered text node',
      !r.unextracted.length,
      `unextracted=${JSON.stringify(r.unextracted)}`,
    );
    const apos = `export const P = () => <p>${RAW} isn${String.fromCharCode(39)}t wrapped</p>;\n`;
    const rApos = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': apos } });
    check(
      'an apostrophe in JSX text does not hide the unextracted string',
      rApos.unextracted.some((u) => u.kind === 'jsx-text'),
      `unextracted=${JSON.stringify(rApos.unextracted)}`,
    );
  }

  // 6. The exemption needs a reason. A bare marker must NOT mute a finding.
  {
    const muted = `// i18n-exempt: export-only, FR-L10N-050\nexport const P = () => <p>${RAW}</p>;\n`;
    const bare = `// i18n-exempt:\nexport const P = () => <p>${RAW}</p>;\n`;
    const rMuted = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': muted } });
    const rBare = analyse({ ...clean, launchScopeFiles: { 'pages/Probe.tsx': bare } });
    check('an exemption WITH a reason mutes the finding', !rMuted.unextracted.length, '');
    check(
      'an exemption WITHOUT a reason does not mute it',
      rBare.unextracted.length > 0,
      `unextracted=${rBare.unextracted.length}`,
    );
  }

  // 6b. Plural keys (#575). A count-bearing key lives in the catalogue ONLY as `foo_one`/`foo_other`
  //     while the source references the base `foo`. All three assertions matter, and the THIRD is
  //     the one that keeps the relaxation honest: without it, teaching the gate to forgive a
  //     plural suffix would forgive every orphan whose name happens to end in one.
  {
    const PLURAL_BASE = k(NS, ['items', 'Count'].join(''));
    const pluralCatalogue = {
      [NS]: {
        greeting: 'Hello there',
        itemsCount_one: '{{count}} item',
        itemsCount_other: '{{count}} items',
      },
    };
    const usesPlural = `export const P = () => <p>{${call(PLURAL_BASE, '{{count}} items')}}</p>;\n`;
    const rPlural = analyse({
      launchScopeFiles: { 'pages/Probe.tsx': usesPlural },
      referenceFiles: { 'pages/Probe.tsx': usesPlural },
      catalogue: pluralCatalogue,
    });
    check(
      'a base key backed only by plural forms is NOT reported missing',
      !rPlural.missing.some((m) => m.key === PLURAL_BASE),
      `missing=${JSON.stringify(rPlural.missing)}`,
    );
    check(
      'plural forms whose base IS referenced are NOT orphans',
      !rPlural.orphans.some((o) => o.endsWith('_one') || o.endsWith('_other')),
      `orphans=${JSON.stringify(rPlural.orphans)}`,
    );
    // ⚑ THE HOLE-CHECK. Same catalogue, nothing referencing the base — the plural forms must STILL
    // be reported. A suffix is not a licence.
    const rUnreferenced = analyse({
      launchScopeFiles: { 'pages/Probe.tsx': `export const P = () => <p>{${call(OK_KEY, 'Hello there')}}</p>;\n` },
      referenceFiles: { 'pages/Probe.tsx': `export const P = () => <p>{${call(OK_KEY, 'Hello there')}}</p>;\n` },
      catalogue: pluralCatalogue,
    });
    // ⚑ An INCOMPLETE set must not pass. `_other` is the only category Indonesian has, so a key
    //    holding just `_one` is unreachable for every id reader at every count.
    const rPartial = analyse({
      launchScopeFiles: { 'pages/Probe.tsx': usesPlural },
      referenceFiles: { 'pages/Probe.tsx': usesPlural },
      catalogue: { [NS]: { greeting: 'Hello there', itemsCount_one: '{{count}} item' } },
    });
    check(
      'a plural set missing _other is still reported missing',
      rPartial.missing.some((m) => m.key === PLURAL_BASE),
      `missing=${JSON.stringify(rPartial.missing)}`,
    );

    check(
      'plural forms whose base is referenced by NOTHING are still orphans',
      rUnreferenced.orphans.some((o) => o.endsWith('_one')) &&
        rUnreferenced.orphans.some((o) => o.endsWith('_other')),
      `orphans=${JSON.stringify(rUnreferenced.orphans)}`,
    );
  }

  // 7. Mode separation — EVOLVED for DD-I18N-9 stage 2. Stage 1's assertion was "the gate never
  //    reads `id` at all" (`id` shipped empty, so any id check would have been permanently red).
  //    Stage 2 arrived WITH the populated catalogue, so the ruling is now two-sided: the en-side
  //    loader still must not read `id` (en completeness must never depend on translation state),
  //    and the id-side loader must actually read it (a stage-2 gate that silently stopped
  //    looking at `id` would pass everything while checking nothing).
  {
    const source = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const enStart = source.indexOf('function readFromDisk');
    const idStart = source.indexOf('function readIdFromDisk');
    const enLoader = source.slice(enStart, idStart);
    check(
      'the en-side loader never reads the id catalogue (FR-L10N-042a)',
      enStart > 0 && idStart > enStart && !/ID_CATALOGUE|locales\/(?:\$\{[^}]*\}|id)\//.test(enLoader),
      '',
    );
    const idLoaderBody = idStart > 0 ? source.slice(idStart, source.indexOf('}', idStart) + 1) : '';
    check(
      'the id-side loader reads the id catalogue (FR-L10N-042b, stage 2)',
      /ID_CATALOGUE/.test(idLoaderBody) && /locales\/id\//.test(source),
      '',
    );
  }

  // 8. Stage 2 (FR-L10N-042b): the id half, same fixture discipline — a clean control first,
  //    then each planted defect class must redden the analyser.
  {
    const idOf = (v) => ({ [NS]: { greeting: v } });
    const base = { launchScopeFiles: clean.launchScopeFiles, catalogue: clean.catalogue };

    const rClean = analyseId({ ...base, idCatalogue: idOf('Halo') });
    check(
      'a fully translated id catalogue passes',
      !rClean.untranslated.length && !rClean.extraneous.length,
      `untranslated=${rClean.untranslated.length} extraneous=${rClean.extraneous.length}`,
    );

    const rAbsent = analyseId({ ...base, idCatalogue: { [NS]: {} } });
    check(
      'a launch-scope key ABSENT from id fails the gate',
      rAbsent.untranslated.some((u) => u.key === OK_KEY && u.why === 'absent'),
      `untranslated=${JSON.stringify(rAbsent.untranslated)}`,
    );

    const rEmpty = analyseId({ ...base, idCatalogue: idOf('   ') });
    check(
      'a launch-scope key EMPTY in id fails the gate',
      rEmpty.untranslated.some((u) => u.key === OK_KEY && u.why === 'empty'),
      `untranslated=${JSON.stringify(rEmpty.untranslated)}`,
    );

    const rExtra = analyseId({
      ...base,
      idCatalogue: { [NS]: { greeting: 'Halo', deadText: 'Terjemahan tanpa sumber' } },
    });
    check(
      'an id key en does not hold fails the gate',
      rExtra.extraneous.includes(ORPHAN_KEY),
      `extraneous=${JSON.stringify(rExtra.extraneous)}`,
    );

    // Plural + parity on the id side (#575 review, Critical 1 / Important 2). `analyse` was taught
    // about plurals and THIS function was not — an en-only plural key passed green while every id
    // reader got English at every count. And presence was never correctness: a translation that
    // drops a token breaks only for id readers.
    {
      const PLURAL_BASE = k(NS, ['items', 'Count'].join(''));
      const usesPlural = `export const P = () => <p>{${call(PLURAL_BASE, '{{count}} items')}}</p>;\n`;
      const enPlural = {
        [NS]: { itemsCount_one: '{{count}} item', itemsCount_other: '{{count}} items' },
      };
      const rMissingPlural = analyseId({
        launchScopeFiles: { 'pages/Probe.tsx': usesPlural },
        catalogue: enPlural,
        idCatalogue: { [NS]: { itemsCount_one: '{{count}} item' } },
      });
      check(
        'a plural form absent from id fails the gate (the base is expanded, not skipped)',
        rMissingPlural.untranslated.some((u) => u.key.endsWith('_other')),
        `untranslated=${JSON.stringify(rMissingPlural.untranslated)}`,
      );

      const rDropped = analyseId({
        launchScopeFiles: { 'pages/Probe.tsx': usesPlural },
        catalogue: enPlural,
        idCatalogue: { [NS]: { itemsCount_one: '{{count}} item', itemsCount_other: 'beberapa item' } },
      });
      check(
        'an id value that DROPS an interpolation token fails the gate',
        rDropped.placeholderMismatches.some((m) => m.key.endsWith('_other')),
        `mismatches=${JSON.stringify(rDropped.placeholderMismatches)}`,
      );

      // Control: translation REORDERS sentences. A reorder must not be mistaken for a drop.
      const rReordered = analyseId({
        launchScopeFiles: {
          'pages/Probe.tsx': `export const P = () => <p>{${call(OK_KEY, 'Hello {{a}} and {{b}}')}}</p>;\n`,
        },
        catalogue: { [NS]: { greeting: 'Hello {{a}} and {{b}}' } },
        idCatalogue: { [NS]: { greeting: 'Halo {{b}} dan {{a}}' } },
      });
      check(
        'a REORDERED translation with the same tokens passes',
        !rReordered.placeholderMismatches.length,
        `mismatches=${JSON.stringify(rReordered.placeholderMismatches)}`,
      );
    }

    // Scope control: an en key OUTSIDE launch scope may stay untranslated (DD-I18N-9's additive
    // staging). Without this, a rule demanding the whole catalogue would pass every red case
    // above — and gate features that have not shipped their route-list line yet.
    const rScope = analyseId({
      launchScopeFiles: clean.launchScopeFiles,
      catalogue: { [NS]: { greeting: 'Hello there', notYet: 'Ships later' } },
      idCatalogue: idOf('Halo'),
    });
    check(
      'an en key outside launch scope may stay untranslated',
      !rScope.untranslated.length,
      `untranslated=${JSON.stringify(rScope.untranslated)}`,
    );
  }

  const failures = cases.filter((c) => !c.ok);
  for (const c of cases) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok || !c.detail ? '' : `  — ${c.detail}`}`);
  }
  if (failures.length) {
    console.error(`\n✗ self-test: ${failures.length}/${cases.length} failed.`);
    console.error(`  The gate does not detect what it claims to. Do NOT trust a green run.`);
    return 1;
  }
  console.log(`✓ self-test: ${cases.length}/${cases.length} — the gate reddens on every planted defect.`);
  return 0;
}

// ── Entry ───────────────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest());
  }
  if (process.argv.includes('--id')) {
    const { entries, launchScopeFiles, catalogue } = readFromDisk();
    const result = analyseId({ launchScopeFiles, catalogue, idCatalogue: readIdFromDisk() });
    process.exit(reportId(result, entries, Object.keys(launchScopeFiles).length));
  }
  const { entries, launchScopeFiles, referenceFiles, catalogue } = readFromDisk();
  const baseline = JSON.parse(fs.readFileSync(DEFAULT_MISMATCH_BASELINE, 'utf8'));
  const result = analyse({ launchScopeFiles, referenceFiles, catalogue, defaultMismatchBaseline: baseline });
  process.exit(report(result, entries, Object.keys(launchScopeFiles).length));
}
