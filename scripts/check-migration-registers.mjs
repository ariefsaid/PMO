#!/usr/bin/env node
/**
 * check-migration-registers — what a database branch must register, before it is pushed (#2916).
 *
 * On 25–26 November two PRs went red in CI's database job because a migration forgot a registration a
 * developer must remember by hand: a new column on a change-history-tracked table with no entry in
 * `record_history_config` (#2908), and a function whose pinned role admission was missing from the
 * source-rights catalogue (PR #2902). In the same week a close-out definer turned PR #2913 red on the
 * AC-LA-014 light-account sweep. Every one of those gates runs against a database, so the miss surfaces
 * only after a push. This guard reads the branch's migrations STATICALLY — no database — and prints, per
 * migration, every registration it must carry and whether the branch already carried it:
 *
 *   change-history   every `alter table … add column` on a table tracked in `record_history_config`
 *                    (the tracked list is read from the migrations themselves) must be classified in a
 *                    registry statement the branch carries. Gate: supabase/tests/record_changes_catalog_gate.test.sql
 *   inventory        a new client-callable SECURITY DEFINER function (granted to authenticated, or not
 *                    revoked from it) needs a proname line in supabase/tests/inventory/anon-executable-definers/.
 *                    Gate: supabase/tests/0178_anon_executable_definers.test.sql (AC-ACL-004)
 *   denominator      every new SECURITY DEFINER function needs its exact signature in one
 *                    scripts/isolation-probe-denominator.d/*.json fragment. Gate: scripts/check-isolation-denominator.mjs
 *   light-account    a new client-callable SECURITY DEFINER function must refuse a field account by body
 *                    (`assert_not_light`) or be allowlisted in the AC-LA-014 sweep
 *                    (supabase/tests/2711_light_account_boundary_sweep.test.sql)
 *   rights-catalogue a function or policy body the branch writes that admits a role the 2519 source-rights
 *                    catalogue pins (supabase/tests/2519_source_rights_catalogue.test.sql) must be in that
 *                    role's pinned set, or the catalogue's exhaustive-enumeration assertions go red
 *   drop-register    a function the branch drops must no longer be named in an inventory fragment or a
 *                    denominator fragment (the check-e2e-skips rule: a stale entry is itself a defect)
 *   search-path      every SECURITY DEFINER function the branch defines must `set search_path = …, pg_temp`
 *                    (pg_temp last, so a hostile temp object cannot shadow a trusted name)
 *   rollback         every migration file the branch ADDS needs supabase/migrations/rollback/<name>_down.sql
 *
 * Scope and limits, stated so nobody trusts it further than it goes: it is textual (grep-level, like
 * check-date-formatting), it sees only the migrations a branch adds or changes against the base ref, and it
 * reads `create [or replace] function` bodies only when they are dollar-quoted (every migration here is).
 * It cannot see: columns added by dynamic SQL or by `create table … as` column lists of a table registered
 * later in the same branch, an admission the branch REMOVES from a function or policy body (the pinned set
 * would go stale the other way), grants made by another migration or by a default privilege, non-dollar-quoted
 * bodies (reported as unread, never silently skipped), and rename-carrying diffs (git rename status is out of
 * scope). The database-backed gates remain the authority; this names the miss one push earlier.
 *
 * Run:   node scripts/check-migration-registers.mjs                       # HEAD against origin/dev
 *        node scripts/check-migration-registers.mjs --base <ref> --head <ref|worktree>
 *        node scripts/check-migration-registers.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { blankComments, normaliseArgs } from './check-restated-functions.mjs';
import { parseFragment } from './anon-definer-inventory.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS_REL = 'supabase/migrations';
export const ROLLBACK_REL = 'supabase/migrations/rollback';
export const INVENTORY_REL = 'supabase/tests/inventory/anon-executable-definers';
export const DENOMINATOR_REL = 'scripts/isolation-probe-denominator.d';
export const LA_SWEEP_REL = 'supabase/tests/2711_light_account_boundary_sweep.test.sql';
export const RIGHTS_CATALOGUE_REL = 'supabase/tests/2519_source_rights_catalogue.test.sql';
const WORKTREE = Symbol('worktree');

/** The `create function` keywords that follow `add` in `alter table … add …` but are not columns. */
const ADD_KEYWORDS = /^(constraint|primary|foreign|unique|check|exclude)$/i;

/** Index of the `)` closing the `(` at `open`, or -1. Nesting- and string-aware (check-restated-functions' own). */
function closingParen(text, open) {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "'") {
        if (text[i + 1] === "'") i++;
        else quoted = false;
      }
      continue;
    }
    if (c === "'") quoted = true;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/* ─────────────────────────── SQL text preparation ─────────────────────────── */

/** `sql` with every `$tag$…$tag$` body replaced by spaces, same length: top-level statements only. */
export function blankDollarBodies(sql) {
  return sql.replace(/\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Comment-blanked, body-blanked text split on `;`: the top-level statements of one migration. */
export function topLevelStatements(sql) {
  return blankDollarBodies(blankComments(sql)).split(';');
}

/* ─────────────────────────── per-migration parsers ─────────────────────────── */

function searchPathOf(header) {
  const beforeAs = header.split(/\bas\b/i)[0];
  const m = beforeAs.match(/set\s+search_path\s*=\s*([^;]+)$/i);
  if (!m) return null;
  const parts = m[1].split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts.length ? parts : null;
}

/**
 * Every public `create [or replace] function` in one migration text: {definitions, skipped}. A definition
 * is {name, args, orReplace, header, definer, returnsTrigger, searchPath, body}. Same dollar-quote rule as
 * check-restated-functions.parseDefinitions: a body it cannot delimit is reported in `skipped`, never
 * silently skipped. Comments are blanked first, so a body carries no comment text to match against.
 */
export function parseFunctions(sql) {
  const text = blankComments(sql);
  const definitions = [];
  const skipped = [];
  const head = /create\s+(or\s+replace\s+)?function\s+(?:([a-z_][a-z0-9_]*)\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  for (const match of text.matchAll(head)) {
    if ((match[2] ?? 'public').toLowerCase() !== 'public') continue;
    const name = match[3].toLowerCase();
    const open = match.index + match[0].length - 1;
    const close = closingParen(text, open);
    if (close < 0) {
      skipped.push(name);
      continue;
    }
    const args = normaliseArgs(text.slice(open + 1, close));
    const rest = text.slice(close + 1);
    const tag = rest.match(/\$([A-Za-z_]*)\$/);
    const bodyStart = tag ? close + 1 + tag.index + tag[0].length : -1;
    const bodyEnd = tag ? text.indexOf(tag[0], bodyStart) : -1;
    if (bodyEnd < 0) {
      skipped.push(name);
      continue;
    }
    const header = tag ? rest.slice(0, tag.index) : '';
    definitions.push({
      name,
      args,
      orReplace: Boolean(match[1]),
      header,
      definer: /security\s+definer/i.test(header),
      returnsTrigger: /returns\s+trigger/i.test(header),
      searchPath: searchPathOf(header),
      body: text.slice(bodyStart, bodyEnd),
    });
  }
  return { definitions, skipped };
}

/** `name(uuid,text)` — the denominator's entry shape, schema-qualified types stripped. */
export function signatureOf(fn) {
  const types = fn.args.split(',').map((t) => t.replace(/^public\./, '').trim()).filter(Boolean);
  return `${fn.name}(${types.join(',')})`;
}

/** Same normalisation for a register entry (`public.foo( uuid, text )` → `foo(uuid,text)`), or null. */
export function normaliseSignatureEntry(entry) {
  const m = entry.trim().match(/^"?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s*\((.*)\)$/i);
  if (!m) return null;
  const args = m[2].replace(/\s+/g, '').toLowerCase().replace(/public\./g, '');
  return `${m[1].toLowerCase()}(${args})`;
}

/** grant/revoke of a named function: {action: 'grant'|'revoke', name, args|null, roles}. Body-blanked text. */
export function parseGrants(sql) {
  const text = blankDollarBodies(blankComments(sql));
  const out = [];
  const re = /(grant|revoke)\s+(?:(?:all|execute)\s+)?on\s+function\s+(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)\s*(?:\(([^)]*)\))?\s+(?:to|from)\s+([^;]+)/gi;
  for (const m of text.matchAll(re)) {
    const roles = new Set(m[5].split(/[\s,]+/).filter(Boolean).map((r) => r.toLowerCase()));
    out.push({ action: m[1].toLowerCase(), name: m[3].toLowerCase(), args: m[4] !== undefined ? normaliseArgs(m[4]) : null, roles });
  }
  return out;
}

/** Functions the migration drops: [{name, args|null}] — args distinguish a removal from a re-signature. */
export function parseDrops(sql) {
  const text = blankDollarBodies(blankComments(sql));
  return [...text.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)\s*(?:\(([^)]*)\))?/gi)]
    .filter((m) => (m[1] ?? 'public').toLowerCase() === 'public')
    .map((m) => ({ name: m[2].toLowerCase(), args: m[3] !== undefined ? normaliseArgs(m[3]) : null }));
}

/** `alter table … add …` columns: [{table, columns:[…]}]. Body-blanked text, so bodies cannot match. */
export function parseAddColumns(sql) {
  const out = [];
  for (const stmt of topLevelStatements(sql)) {
    const at = stmt.match(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)/i);
    if (!at || !/\sadd\s/i.test(stmt.slice(at.index))) continue;
    const columns = [...stmt.matchAll(/\sadd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1].toLowerCase())
      .filter((name) => !ADD_KEYWORDS.test(name));
    if (columns.length) out.push({ table: at[2].toLowerCase(), columns });
  }
  return out;
}

/**
 * The migration's `record_history_config` statements: [{kind:'insert'|'update', tables:Set, text}].
 * The tables of an insert come from its VALUES tuples (the registry's table_name is the 2nd field); an
 * update names its rows via `table_name = '…'`. `text` is kept so a classification check can look for the
 * column inside it. Body-blanked text: a body cannot forge a registry statement.
 */
export function parseRegistryStatements(sql) {
  const out = [];
  for (const stmt of topLevelStatements(sql)) {
    const ins = stmt.match(/insert\s+into\s+(?:public\.)?record_history_config(?:\s*\([^)]*\))?\s*values([\s\S]*)/i);
    if (ins) {
      const tables = new Set([...ins[1].matchAll(/\(\s*'[^']*'\s*,\s*'([^']+)'/g)].map((t) => t[1].toLowerCase()));
      out.push({ kind: 'insert', tables, text: ins[1] });
      continue;
    }
    const upd = stmt.match(/update\s+(?:public\.)?record_history_config([\s\S]*)/i);
    if (upd) {
      const tables = new Set([...upd[1].matchAll(/table_name\s*=\s*'([^']+)'/g)].map((t) => t[1].toLowerCase()));
      out.push({ kind: 'update', tables, text: upd[1] });
    }
  }
  return out;
}

/** Tables a set of migrations REGISTERS (insert rows): the tracked-table list, read from the migrations. */
export function trackedTables(files) {
  const tracked = new Set();
  for (const file of files) {
    for (const stmt of parseRegistryStatements(file.sql)) {
      if (stmt.kind === 'insert') for (const t of stmt.tables) tracked.add(t);
    }
  }
  return tracked;
}

/** The pronames a branch registers for a table: any registry statement naming the table and the column. */
export function classifiesColumn(registryStatements, table, column) {
  const word = new RegExp(`\\b${column}\\b`);
  return registryStatements.some((s) => s.tables.has(table) && (s.text.includes(`'${column}'`) || word.test(s.text)));
}

/** The pronames on the AC-LA-014 allowlist (`insert into la_fn_allow values ('name', 'kind', 'why')`). */
export function parseLaAllow(sql) {
  const allow = new Set();
  for (const stmt of topLevelStatements(sql)) {
    const ins = stmt.match(/insert\s+into\s+(?:pg_temp\.)?la_fn_allow\s+values([\s\S]*)/i);
    if (!ins) continue;
    for (const t of ins[1].matchAll(/\(\s*'([a-z_][a-z0-9_]*)'\s*,/gi)) allow.add(t[1].toLowerCase());
  }
  return allow;
}

/** Postgres ARE character classes a JS RegExp cannot compile, translated. */
export function posixToJs(source) {
  return source
    .replace(/\[\[:space:\]\]/g, '\\s')
    .replace(/\[\[:alpha:\]\]/g, '[A-Za-z]')
    .replace(/\[\[:upper:\]\]/g, '[A-Z]')
    .replace(/\[\[:lower:\]\]/g, '[a-z]')
    .replace(/\[\[:digit:\]\]/g, '\\d')
    .replace(/\[\[:alnum:\]\]/g, '[A-Za-z0-9]');
}

/**
 * The 2519 source-rights catalogue's pinned sets: only its ROLE-ADMISSION pins (the regex names
 * `actor_holds_job_role('role')` and the pinned array enumerates every function or policy admitting that
 * role) — the pins it derives from one named function's internals are the catalogue's own business, not a
 * register. {functionPins:[{role, regex, pinned:Set}], policyPins:[…]}
 */
export function parseCataloguePins(sql) {
  const functionPins = [];
  const policyPins = [];
  // NB: comment-blanked only, NOT body-blanked — the catalogue's `$re$ … $re$` regex delimiters are
  // indistinguishable from dollar-quote tags, and the catalogue (a pgTAP test) defines no function bodies.
  for (const stmt of blankComments(sql).split(';')) {
    if (!/~\*/i.test(stmt) || !/array\s*\[/i.test(stmt)) continue;
    const re = stmt.match(/\$re\$(.*?)\$re\$/s);
    const from = stmt.match(/from\s+(cat_functions|cat_policies)/i);
    const arr = stmt.match(/array\s*\[([^\]]*)\]/s);
    // the role is read from the catalogue's own regex source: everything between `actor_holds_job_role`
    // and the first quoted token is its whitespace matcher (`[[:space:]]*` and friends). A pin whose first
    // quoted token is not a role key (the catalogue's `([^']+)` list-the-roles pin) is not a role pin.
    const role = re ? re[1].match(/actor_holds_job_role[^']*'([^']+)'/i) : null;
    const roleKey = role && /^[a-z_][a-z_0-9]*$/.test(role[1]) ? role[1].toLowerCase() : null;
    if (!re || !from || !roleKey || !arr) continue;
    const pinned = new Set([...arr[1].matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase()));
    const pin = { role: roleKey, regex: new RegExp(posixToJs(re[1]), 'i'), pinned };
    if (from[1].toLowerCase() === 'cat_functions' && /select\s+proname/i.test(stmt)) functionPins.push(pin);
    else if (from[1].toLowerCase() === 'cat_policies') policyPins.push(pin);
  }
  return { functionPins, policyPins };
}

/** Policies the migration creates or alters: [{name, table, cmd (null on alter — unknowable), body}]. */
export function parsePolicies(sql) {
  const out = [];
  for (const stmt of topLevelStatements(sql)) {
    const c = stmt.match(/create\s+(?:or\s+replace\s+)?policy\s+([a-z_][a-z0-9_]*)\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*(?:as\s+(?:permissive|restrictive)\s+)?(?:for\s+([a-z]+))?([\s\S]*)/i);
    if (c) {
      out.push({ name: c[1].toLowerCase(), table: c[2].toLowerCase(), cmd: (c[3] ?? 'all').toUpperCase(), body: c[4] ?? '' });
      continue;
    }
    const a = stmt.match(/alter\s+policy\s+([a-z_][a-z0-9_]*)\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*([\s\S]*)/i);
    if (a) out.push({ name: a[1].toLowerCase(), table: a[2].toLowerCase(), cmd: null, body: a[3] ?? '' });
  }
  return out;
}

/* ─────────────────────────── the check ─────────────────────────── */

/**
 * files: [{path, status:'A'|'M', sql}] in apply order (migration number first). Returns
 * {requirements, misses, unread} where a requirement is {file, rule, ok, subject, detail} — `detail`
 * carries the fix and the naming gate on a miss — and `unread` names definitions whose body could not
 * be delimited (a hole, reported, never skipped).
 */
export function checkBranch({ headFiles, baseFiles, registers }) {
  const tracked = trackedTables(baseFiles);
  const baseArgs = new Map();
  for (const file of baseFiles) {
    for (const fn of parseFunctions(file.sql).definitions) {
      if (!baseArgs.has(fn.name)) baseArgs.set(fn.name, new Set());
      baseArgs.get(fn.name).add(fn.args);
    }
  }
  const registryStatements = headFiles.flatMap((f) => parseRegistryStatements(f.sql).map((s) => ({ ...s, file: f.path })));
  const requirements = [];
  const unread = [];
  const seenSignatures = new Set();
  const seenPins = new Set();
  const parsedHead = new Map(headFiles.map((f) => [f.path, parseFunctions(f.sql)]));
  const definedNames = new Set([...parsedHead.values()].flatMap((p) => p.definitions.map((fn) => fn.name)));
  const definedSignatures = new Set([...parsedHead.values()].flatMap((p) => p.definitions.map((fn) => signatureOf(fn))));

  const req = (file, rule, ok, subject, detail) => requirements.push({ file, rule, ok, subject, detail });

  for (const file of headFiles) {
    const { definitions, skipped } = parsedHead.get(file.path);
    unread.push(...skipped.map((name) => ({ file: file.path, name })));
    const grants = parseGrants(file.sql);
    const drops = parseDrops(file.sql);
    const policies = parsePolicies(file.sql);

    // change-history: every new column on a tracked table is classified in a registry statement.
    for (const add of parseAddColumns(file.sql)) {
      if (!tracked.has(add.table)) continue;
      for (const column of add.columns) {
        const ok = classifiesColumn(registryStatements, add.table, column);
        req(file.path, 'change-history', ok,
          `${add.table}.${column} is a new column on a tracked table`,
          ok ? null :
            `classify it in record_history_config — e.g. update public.record_history_config set captured = captured || '{"${column}":"text"}'::jsonb where table_name = '${add.table}'; (or flag_cols / omit_cols). Gate: supabase/tests/record_changes_catalog_gate.test.sql`);
      }
    }

    for (const fn of definitions) {
      const signature = signatureOf(fn);
      const isNew = !(baseArgs.get(fn.name)?.has(fn.args) ?? false);
      // trigger carriers run no RPC surface: no denominator, inventory or light-account entry. They are
      // still definers, so the search-path rule keeps applying to them.
      const rpcSurface = !fn.returnsTrigger;

      if (fn.definer) {
        // search-path: every definer the branch defines, new or restated.
        const last = fn.searchPath ? fn.searchPath[fn.searchPath.length - 1] : null;
        req(file.path, 'search-path', last === 'pg_temp',
          `${fn.name} is SECURITY DEFINER with search_path ${fn.searchPath ? '= ' + fn.searchPath.join(', ') : 'unset'}`,
          last === 'pg_temp' ? null :
            `set search_path = <trusted schemas>, pg_temp — pg_temp last, so a hostile temp object cannot shadow a trusted name`);
      }

      // register requirements attach to the FIRST branch migration that introduces the signature.
      if (seenSignatures.has(signature)) continue;
      seenSignatures.add(signature);

      // rights-catalogue: any body the branch writes that admits a pinned role must be in the pinned
      // set — a RESTATEMENT that widens an admission is exactly how PR #2902 went red. A same-body
      // restatement passes, because the catalogue at head already pins the shipped admission.
      for (const pin of registers.functionPins) {
        if (!pin.regex.test(fn.body)) continue;
        const pinKey = `${signature}|${pin.role}`;
        if (seenPins.has(pinKey)) continue;
        seenPins.add(pinKey);
        const ok = pin.pinned.has(fn.name);
        req(file.path, 'rights-catalogue', ok,
          `${fn.name} admits the '${pin.role}' job role`,
          ok ? null :
            `the 2519 source-rights catalogue pins every function admitting '${pin.role}' — add ${fn.name} to that pin's array in ${RIGHTS_CATALOGUE_REL} or its exhaustive assertion goes red`);
      }

      if (!isNew || !rpcSurface) continue;
      const grantsFor = grants.filter((g) => g.name === fn.name && (g.args === null || g.args === fn.args));
      const revokedAuth = grantsFor.some((g) => g.action === 'revoke' && g.roles.has('authenticated'));
      const grantedAuth = grantsFor.some((g) => g.action === 'grant' && g.roles.has('authenticated'));
      const clientCallable = fn.definer && (grantedAuth || !revokedAuth);

      if (fn.definer) {
        // denominator: every new definer, client-callable or internal.
        req(file.path, 'denominator', registers.denominator.has(signature),
          `${signature} is a new SECURITY DEFINER function${clientCallable ? ' executable by the signed-in role' : ' (internal: revoked from authenticated)'}`,
          registers.denominator.has(signature) ? null :
            `add "${signature}" to a scripts/isolation-probe-denominator.d/<feature>.json fragment. Gate: scripts/check-isolation-denominator.mjs`);
        if (clientCallable) {
          const owner = registers.inventoryOwner.get(fn.name);
          req(file.path, 'inventory', Boolean(owner),
            `${fn.name} is a new client-callable SECURITY DEFINER function`,
            owner ? null :
              `add a proname line to a supabase/tests/inventory/anon-executable-definers/<feature>.txt fragment. Gate: supabase/tests/0178_anon_executable_definers.test.sql (AC-ACL-004)`);
          const allowlisted = registers.laAllow.has(fn.name);
          const refusesLight = /assert_not_light/i.test(fn.body);
          req(file.path, 'light-account', allowlisted || refusesLight,
            `${fn.name} is a new client-callable SECURITY DEFINER function`,
            allowlisted || refusesLight ? null :
              `it must refuse a field account by body (perform public.assert_not_light();) or join the AC-LA-014 allowlist in supabase/tests/2711_light_account_boundary_sweep.test.sql`);
        }
      }

    }

    for (const pol of policies) {
      for (const pin of registers.policyPins) {
        if (!pin.regex.test(pol.body)) continue;
        const key = `${pol.table}:${pol.name}`;
        const ok = [...pin.pinned].some((e) => e === key || e.startsWith(`${key}:`));
        req(file.path, 'rights-catalogue', ok,
          `policy ${key}${pol.cmd ? ` (${pol.cmd})` : ''} admits the '${pin.role}' job role`,
          ok ? null :
            `the 2519 source-rights catalogue pins every policy admitting '${pin.role}' — add ${key} to that pin's array in ${RIGHTS_CATALOGUE_REL} or its exhaustive assertion goes red`);
      }
    }

    for (const d of drops) {
      // a re-signature (drop the old overload, create the new one) keeps the name live: the inventory
      // (name-keyed) is covered by any same-name definition, the denominator (signature-keyed) by the
      // same-signature one. Only a drop nothing re-defines makes a register entry stale.
      const nameRedefined = definedNames.has(d.name);
      const sig = d.args !== null ? `${d.name}(${d.args})` : null;
      const sigRedefined = sig !== null && definedSignatures.has(sig);
      const inInventory = registers.inventoryOwner.has(d.name) && !nameRedefined;
      const inDenominator = sig !== null
        ? (registers.denominator.has(sig) && !sigRedefined)
        : ([...registers.denominator].some((e) => e.startsWith(`${d.name}(`)) && !nameRedefined);
      req(file.path, 'drop-register', !inInventory && !inDenominator,
        `${d.name} is dropped by this migration`,
        !inInventory && !inDenominator ? null :
          `${inInventory ? 'an inventory fragment still lists it' : ''}${inInventory && inDenominator ? ' and ' : ''}${inDenominator ? 'a denominator fragment still names it' : ''} — remove the stale entry (a stale register entry is itself a defect), or keep the function`);
    }

    if (file.status === 'A') {
      const rollback = `${path.basename(file.path, '.sql')}_down.sql`;
      req(file.path, 'rollback', registers.rollbackFiles.has(rollback),
        `a rollback file for ${path.basename(file.path)}`,
        registers.rollbackFiles.has(rollback) ? null :
          `add supabase/migrations/rollback/${rollback}`);
    }
  }

  const misses = requirements.filter((r) => !r.ok);
  return { requirements, misses, unread };
}

/* ─────────────────────────── git layer ─────────────────────────── */

function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (!allowFail && r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r;
}

function treeRead(ref, rel) {
  if (ref === WORKTREE) {
    try {
      return fs.readFileSync(path.join(REPO, rel), 'utf8');
    } catch {
      return null;
    }
  }
  const r = git(['show', `${ref}:${rel}`], { allowFail: true });
  return r.status === 0 ? r.stdout : null;
}

function treeList(ref, relDir) {
  if (ref === WORKTREE) {
    try {
      return fs.readdirSync(path.join(REPO, relDir), { withFileTypes: true })
        .filter((e) => e.isFile()).map((e) => `${relDir}/${e.name}`);
    } catch {
      return [];
    }
  }
  const r = git(['ls-tree', '-r', '--name-only', ref, '--', `${relDir}/`], { allowFail: true });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

function mergeBase(a, b) {
  return git(['merge-base', a === WORKTREE ? 'HEAD' : a, b === WORKTREE ? 'HEAD' : b]).stdout.trim();
}

function migrationNumber(p) {
  const n = Number.parseInt(path.basename(p), 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** The migrations the branch adds or changes, in apply order, with their content at `head`. */
function changedMigrations(baseRef, headRef) {
  const mb = mergeBase(baseRef, headRef);
  const diffArgs = ['diff', '--name-status', mb, ...(headRef === WORKTREE ? [] : [headRef]), '--', MIGRATIONS_REL];
  const out = git(diffArgs).stdout.split('\n').filter(Boolean);
  return {
    mergeBase: mb,
    files: out
      .map((line) => ({ status: line[0], path: line.slice(1).trim() }))
      .filter((f) => 'AM'.includes(f.status))
      .filter((f) => f.path.startsWith(`${MIGRATIONS_REL}/`) && !f.path.includes('/rollback/') && f.path.endsWith('.sql'))
      .map((f) => ({ ...f, sql: treeRead(headRef, f.path) ?? '' }))
      .sort((a, b) => migrationNumber(a.path) - migrationNumber(b.path) || a.path.localeCompare(b.path)),
  };
}

/** Files at `baseRef` whose text matches `pattern` (forward migrations only). */
function baseFilesMatching(baseRef, pattern) {
  const r = git(['grep', '-l', '-i', '-E', pattern, baseRef, '--', MIGRATIONS_REL], { allowFail: true });
  if (r.status !== 0) return []; // git grep: 1 = no matches
  // grepping a tree-ish prefixes every hit with `<treeish>:` — strip it back to the repo-relative path
  const prefix = `${baseRef}:`;
  return r.stdout.split('\n')
    .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p))
    .filter((p) => p.startsWith(`${MIGRATIONS_REL}/`) && !p.includes('/rollback/') && p.endsWith('.sql'));
}

/** The base's registry rows and function signatures, read from the migrations at `baseRef`. */
function collectBase(baseRef) {
  const registryFiles = baseFilesMatching(baseRef, 'record_history_config');
  const baseFiles = registryFiles.map((p) => ({ path: p, sql: treeRead(baseRef, p) ?? '' }));
  const tracked = trackedTables(baseFiles);
  const functionFiles = baseFilesMatching(baseRef, 'create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function');
  for (const p of functionFiles) baseFiles.push({ path: p, sql: treeRead(baseRef, p) ?? '' });
  return { baseFiles, tracked };
}

function collectRegisters(headRef) {
  const inventoryOwner = new Map();
  for (const f of treeList(headRef, INVENTORY_REL).filter((f) => f.endsWith('.txt'))) {
    for (const name of parseFragment(treeRead(headRef, f) ?? '', path.basename(f))) {
      if (!inventoryOwner.has(name)) inventoryOwner.set(name, path.basename(f));
    }
  }
  const denominator = new Set();
  for (const f of treeList(headRef, DENOMINATOR_REL).filter((f) => f.endsWith('.json'))) {
    let parsed;
    try {
      parsed = JSON.parse(treeRead(headRef, f) ?? '{}');
    } catch {
      console.error(`⚠ ${f} is not valid JSON; its denominator entries are unreadable`);
      continue;
    }
    for (const e of parsed.definer_functions ?? []) {
      const n = normaliseSignatureEntry(e);
      if (n) denominator.add(n);
    }
  }
  const laAllow = parseLaAllow(treeRead(headRef, LA_SWEEP_REL) ?? '');
  const { functionPins, policyPins } = parseCataloguePins(treeRead(headRef, RIGHTS_CATALOGUE_REL) ?? '');
  const rollbackFiles = new Set(treeList(headRef, ROLLBACK_REL).map((f) => path.basename(f)));
  return { inventoryOwner, denominator, laAllow, functionPins, policyPins, rollbackFiles };
}

/* ─────────────────────────── CLI ─────────────────────────── */

const RULE_WIDTH = 15;

function printReport(baseRef, headRef, { mergeBase: mb, files }, result) {
  const headName = headRef === WORKTREE ? 'the working tree' : headRef;
  console.log(`check-migration-registers — migrations a branch adds or changes: base ${baseRef} (merge-base ${mb.slice(0, 9)}) → head ${headName}`);
  if (!files.length) {
    console.log('no migrations added or changed — nothing to register.');
  }
  for (const file of files) {
    const reqs = result.requirements.filter((r) => r.file === file.path);
    if (!reqs.length) continue;
    console.log(`${path.basename(file.path)} (${file.status === 'A' ? 'added' : 'changed'})`);
    for (const r of reqs) {
      console.log(`  ${r.ok ? '✓' : '✗'} ${r.rule.padEnd(RULE_WIDTH)} ${r.subject}`);
      if (!r.ok) for (const line of r.detail.split('\n')) console.log(`      ${line}`);
    }
  }
  for (const u of result.unread) {
    console.log(`⚠ unread definition ${u.name} in ${path.basename(u.file)} — its body is not dollar-quoted, so its rules could not be read`);
  }
  console.log(`check-migration-registers: ${result.misses.length} miss${result.misses.length === 1 ? '' : 'es'}, ${result.requirements.length} requirement${result.requirements.length === 1 ? '' : 's'} checked across ${files.length} migration${files.length === 1 ? '' : 's'}.`);
  if (result.misses.length) process.exit(1);
  if (!result.misses.length && !files.length) return;
  console.log('check-migration-registers: OK — every registration the branch needs is present.');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  let base = 'origin/dev';
  let head = 'HEAD';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base') base = args[++i];
    else if (args[i] === '--head') {
      i += 1;
      head = args[i] === 'worktree' ? WORKTREE : args[i];
    }
  }
  const changed = changedMigrations(base, head);
  const { baseFiles } = collectBase(base === WORKTREE ? 'HEAD' : base);
  const registers = collectRegisters(head === WORKTREE ? WORKTREE : head);
  const result = checkBranch({ headFiles: changed.files, baseFiles, registers });
  printReport(base, head, changed, result);
}

/* ─────────────────────────── self-test ─────────────────────────── */

/** One compact world: a base with a tracked registry and two shipped definers; registers with their entries. */
function fixtures() {
  const baseRegistry = `insert into public.record_history_config (entity_type, table_name, captured, flag_cols, omit_cols) values
('work_order', 'work_orders', '{"title":"text"}', '{}', '{id,org_id}'),
('widget', 'widgets', '{"name":"text"}', '{}', '{id,org_id}');`;
  const baseFunctions = `create function public.pinned_admit() returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.actor_holds_job_role('planner');
end $$;

create function public.legacy_fn() returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
end $$;

create function public.existing_helper() returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  null;
end $$;`;
  const baseFiles = [
    { path: 'supabase/migrations/0001_base_registry.sql', status: 'A', sql: baseRegistry },
    { path: 'supabase/migrations/0002_base_functions.sql', status: 'A', sql: baseFunctions },
  ];
  const base = { path: 'supabase/migrations/0000_base.sql', status: 'A', sql: `${baseRegistry}\n${baseFunctions}` };
  const inventory = {
    'base.txt': ['pinned_admit', 'legacy_fn', 'existing_helper'].join('\n'),
    'branch.txt': ['new_writer  # new_writer(uuid): the widget page cancel button', 'cancel_it'].join('\n'),
  };
  const denominator = {
    'base.json': { tables: [], definer_functions: ['pinned_admit()', 'legacy_fn()', 'existing_helper()'] },
    'branch.json': { tables: [], definer_functions: ['new_writer(uuid)', 'cancel_it(text)'] },
  };
  const laSweep = `insert into pg_temp.la_fn_allow values
  ('allowlisted_gate', 'helper', 'a scalar gate the shell reads');`;
  const catalogue = `select is(array(select proname from cat_functions where prosrc ~* $re$actor_holds_job_role[[:space:]]*\\([[:space:]]*'planner'$re$ order by proname),
 array['guard_one','pinned_admit'],
 'AC-X no other direct Planner function admission');
select is(array(select tablename||':'||policyname||':'||cmd from cat_policies
 where coalesce(qual,'')||coalesce(with_check,'') ~* $re$actor_holds_job_role[[:space:]]*\\([[:space:]]*'equipment_officer'$re$ order by tablename,policyname,cmd),
 array['equipment_assets:equipment_officer_insert:INSERT'],
 'AC-Y only the asset-register insert admits Officer');`;
  const makeRegisters = ({ inventory: inv = inventory, denominator: den = denominator, catalog = catalogue } = {}) => {
    const inventoryOwner = new Map();
    for (const [f, text] of Object.entries(inv)) for (const name of parseFragment(text, f)) inventoryOwner.set(name, f);
    const denominatorSet = new Set();
    for (const json of Object.values(den)) for (const e of json.definer_functions) denominatorSet.add(normaliseSignatureEntry(e));
    const pins = parseCataloguePins(catalog);
    return { inventoryOwner, denominator: denominatorSet, laAllow: parseLaAllow(laSweep), functionPins: pins.functionPins, policyPins: pins.policyPins, rollbackFiles: new Set(['2901_feature_down.sql']) };
  };
  const headClean = `-- 2901_feature.sql — the branch's one migration. Rollback: rollback/2901_feature_down.sql
alter table public.work_orders add column cancel_reason text
  check (cancel_reason is null or char_length(cancel_reason) between 3 and 500);
update public.record_history_config set captured = captured || '{"cancel_reason":"text"}'::jsonb
 where table_name = 'work_orders' and not (captured ? 'cancel_reason');

create function public.new_writer(p_id uuid) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
  return p_id;
end $$;
revoke all on function public.new_writer(uuid) from public, anon;
grant execute on function public.new_writer(uuid) to authenticated, service_role;

drop function public.gone_function(text);`;
  const headFiles = (sql = headClean) => [{ path: 'supabase/migrations/2901_feature.sql', status: 'A', sql }];
  return { base, baseFiles, makeRegisters, headFiles, headClean, inventory, denominator, catalogue };
}

function runBranch({ base, baseFiles, headFiles, registers }) {
  return checkBranch({ headFiles: headFiles(), baseFiles: [...baseFiles, base], registers });
}

function expect(cond, message) {
  if (!cond) throw new Error(`self-test FAIL: ${message}`);
}

function missOf(result, rule, needle) {
  return result.misses.find((m) => m.rule === rule && m.subject.includes(needle));
}

function selfTest() {
  const fx = fixtures();

  // 0 — the clean branch: every requirement checks, nothing fires.
  const clean = runBranch({ ...fx, registers: fx.makeRegisters() });
  expect(clean.misses.length === 0, `the clean branch must be clean, got: ${JSON.stringify(clean.misses)}`);
  expect(clean.requirements.some((r) => r.rule === 'change-history' && r.ok && r.subject.includes('work_orders.cancel_reason')),
    'the clean branch must show the classified column as a checked requirement');
  expect(clean.unread.length === 0, 'the clean branch has no unread definitions');

  // 1 — change-history: drop the classification statement, the miss is named.
  const p1 = fx.headClean.replace(/update public\.record_history_config[\s\S]*?not \(captured \? 'cancel_reason'\);/, "update public.record_history_config set captured = captured || '{}'::jsonb where table_name = 'widgets';");
  const r1 = runBranch({ ...fx, headFiles: () => fx.headFiles(p1), registers: fx.makeRegisters() });
  expect(missOf(r1, 'change-history', 'work_orders.cancel_reason'), 'an unclassified new column on a tracked table is named');
  expect(missOf(r1, 'change-history', 'work_orders.cancel_reason').detail.includes('record_changes_catalog_gate'), 'the miss names its gate');
  // a column on an untracked table is nobody's register.
  const r1b = runBranch({ ...fx, headFiles: () => fx.headFiles(`${fx.headClean}\nalter table public.things add column w int;`), registers: fx.makeRegisters() });
  expect(!r1b.misses.some((m) => m.subject.includes('things.w')), 'a column on an untracked table raises no change-history requirement');

  // 2 — inventory: a new client-callable definer without a fragment line is named.
  const inv2 = { ...fx.inventory, 'branch.txt': 'cancel_it' };
  const r2 = runBranch({ ...fx, registers: fx.makeRegisters({ inventory: inv2 }) });
  expect(missOf(r2, 'inventory', 'new_writer'), 'a new client-callable definer without an inventory line is named');
  expect(missOf(r2, 'inventory', 'new_writer').detail.includes('0178'), 'the inventory miss names its sweep');

  // 3 — denominator: a stale or wrong signature is named.
  const den3 = { ...fx.denominator, 'branch.json': { tables: [], definer_functions: ['new_writer(text)', 'cancel_it(text)'] } };
  const r3 = runBranch({ ...fx, registers: fx.makeRegisters({ denominator: den3 }) });
  expect(missOf(r3, 'denominator', 'new_writer(uuid)'), 'a denominator entry without the exact signature is named');

  // 4 — light-account: no assert_not_light and not allowlisted is named.
  const p4 = fx.headClean.replace('  perform public.assert_not_light();\n', '');
  const r4 = runBranch({ ...fx, headFiles: () => fx.headFiles(p4), registers: fx.makeRegisters() });
  expect(missOf(r4, 'light-account', 'new_writer'), 'a new client-callable definer that does not refuse a field account is named');
  expect(missOf(r4, 'light-account', 'new_writer').detail.includes('AC-LA-014'), 'the light-account miss names the sweep');
  // 4b — the allowlist accepts instead of the body guard.
  const p4b = p4.replace('public.new_writer', 'public.allowlisted_gate').replaceAll('new_writer(', 'allowlisted_gate(').replace('allowlisted_gate  #', 'new_writer  #');
  const inv4b = { ...fx.inventory, 'branch.txt': 'allowlisted_gate\ncancel_it' };
  const den4b = { ...fx.denominator, 'branch.json': { tables: [], definer_functions: ['allowlisted_gate(uuid)', 'cancel_it(text)'] } };
  const r4b = runBranch({ ...fx, headFiles: () => fx.headFiles(p4b), registers: fx.makeRegisters({ inventory: inv4b, denominator: den4b }) });
  expect(!r4b.misses.some((m) => m.rule === 'light-account'), 'an allowlisted definer satisfies the light-account rule without the body guard');

  // 5 — an internal definer (revoked from authenticated) needs the denominator but not the client registers.
  const p5 = `${fx.headClean}\n\ncreate function public.internal_probe() returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  null;
end $$;
revoke all on function public.internal_probe() from public, anon, authenticated;
grant execute on function public.internal_probe() to service_role;`;
  const r5 = runBranch({ ...fx, headFiles: () => fx.headFiles(p5), registers: fx.makeRegisters() });
  expect(!r5.misses.some((m) => m.rule === 'inventory' && m.subject.includes('internal_probe')), 'an internal definer needs no inventory line');
  expect(!r5.misses.some((m) => m.rule === 'light-account' && m.subject.includes('internal_probe')), 'an internal definer needs no light-account entry');
  const den5 = { base: fx.denominator['base.json'], 'branch.json': { tables: [], definer_functions: ['new_writer(uuid)', 'cancel_it(text)'] } };
  const r5b = runBranch({ ...fx, headFiles: () => fx.headFiles(p5), registers: fx.makeRegisters({ denominator: den5 }) });
  expect(missOf(r5b, 'denominator', 'internal_probe()'), 'an internal definer still needs its denominator entry');

  // 6 — a re-signatured function (name exists at base with other args) re-opens its registers: the
  // name-keyed inventory still passes, the signature-keyed denominator does not.
  const p6 = fx.headClean.replace('public.new_writer(p_id uuid)', 'public.legacy_fn(p_key text)').replaceAll('new_writer(uuid)', 'legacy_fn(text)').replace("begin\n  perform public.assert_not_light();", "begin\n  perform public.assert_not_light();");
  const r6 = runBranch({ ...fx, headFiles: () => fx.headFiles(p6), registers: fx.makeRegisters() });
  expect(!r6.misses.some((m) => m.rule === 'inventory' && m.subject.includes('legacy_fn')), 'the name-keyed inventory still covers a re-signatured name');
  expect(missOf(r6, 'denominator', 'legacy_fn(text)'), 'a re-signatured definer needs its new exact signature in the denominator');

  // 7 — drop-register: a dropped function still named in a register is named.
  const inv7 = { ...fx.inventory, 'branch.txt': 'gone_function\nnew_writer\ncancel_it' };
  const r7 = runBranch({ ...fx, registers: fx.makeRegisters({ inventory: inv7 }) });
  expect(missOf(r7, 'drop-register', 'gone_function'), 'a dropped function still listed in an inventory fragment is named');
  const den7 = { ...fx.denominator, 'branch.json': { tables: [], definer_functions: ['gone_function(text)', 'new_writer(uuid)'] } };
  const r7b = runBranch({ ...fx, registers: fx.makeRegisters({ denominator: den7 }) });
  expect(missOf(r7b, 'drop-register', 'gone_function'), 'a dropped function still named in a denominator fragment is named');
  // 7c — a re-signature (drop the old overload, create the new one) keeps the name live: no stale-entry miss.
  const p7c = `${fx.headClean}\n\ndrop function public.existing_helper();\n\ncreate function public.existing_helper(p_key text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
end $$;
grant execute on function public.existing_helper(text) to authenticated, service_role;`;
  const den7c = { ...fx.denominator, 'base.json': { tables: [], definer_functions: ['legacy_fn()', 'pinned_admit()'] } };
  const r7c = runBranch({ ...fx, headFiles: () => fx.headFiles(p7c), registers: fx.makeRegisters({ denominator: den7c }) });
  expect(!r7c.misses.some((m) => m.rule === 'drop-register' && m.subject.includes('existing_helper')),
    'a drop the same branch re-signatures raises no stale-entry miss while its registers moved with it (migration 2660\'s shape)');
  // 7d — but the OLD signature's denominator entry, kept while nothing defines it, is stale.
  const den7d = { ...fx.denominator, 'base.json': { tables: [], definer_functions: ['existing_helper()', 'legacy_fn()', 'pinned_admit()'] } };
  const r7d = runBranch({ ...fx, headFiles: () => fx.headFiles(p7c), registers: fx.makeRegisters({ denominator: den7d }) });
  expect(missOf(r7d, 'drop-register', 'existing_helper'), 'a dropped signature still in a denominator fragment is named');

  // 8 — search-path: a definer whose search_path does not end with pg_temp is named; so is an unset one.
  const p8 = fx.headClean.replace('set search_path = public, pg_temp', 'set search_path = pg_catalog, public');
  const r8 = runBranch({ ...fx, headFiles: () => fx.headFiles(p8), registers: fx.makeRegisters() });
  expect(missOf(r8, 'search-path', 'new_writer'), 'a definer whose search_path does not end with pg_temp is named');
  const p8b = fx.headClean.replace('set search_path = public, pg_temp ', '');
  const r8b = runBranch({ ...fx, headFiles: () => fx.headFiles(p8b), registers: fx.makeRegisters() });
  expect(missOf(r8b, 'search-path', 'new_writer'), 'a definer with no search_path at all is named');

  // 9 — rollback: an added migration without its down file is named; a changed one is not asked.
  const reg9 = fx.makeRegisters();
  reg9.rollbackFiles = new Set();
  const r9 = runBranch({ ...fx, registers: reg9 });
  expect(missOf(r9, 'rollback', 'rollback file for 2901_feature.sql'), 'an added migration without a rollback file is named');
  const r9b = checkBranch({ headFiles: [{ path: 'supabase/migrations/2901_feature.sql', status: 'M', sql: fx.headClean }], baseFiles: [...fx.baseFiles, fx.base], registers: fx.makeRegisters() });
  expect(!r9b.misses.some((m) => m.rule === 'rollback'), 'a changed migration is not asked for a rollback file');

  // 10 — rights-catalogue: a body admitting a pinned role without being pinned is named, for functions
  // and policies; the same body with the pin added is clean; an unpinned role raises nothing.
  const p10 = `${fx.headClean}\n\ncreate function public.planner_admit_two() returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select public.actor_holds_job_role('planner') $$;`;
  const r10 = runBranch({ ...fx, headFiles: () => fx.headFiles(p10), registers: fx.makeRegisters() });
  expect(missOf(r10, 'rights-catalogue', 'planner_admit_two'), 'a function admitting a pinned role without a pin is named');
  const cat10b = fx.catalogue.replace("array['guard_one','pinned_admit']", "array['guard_one','pinned_admit','planner_admit_two']");
  const r10b = runBranch({ ...fx, headFiles: () => fx.headFiles(p10), registers: fx.makeRegisters({ catalog: cat10b }) });
  expect(!r10b.misses.some((m) => m.rule === 'rights-catalogue'), 'the same body is clean once the catalogue pins it');
  const p10c = `${fx.headClean}\n\nalter policy widgets_update on public.widgets
  using (org_id = public.auth_org_id() and public.actor_holds_job_role('equipment_officer'));`;
  const r10c = runBranch({ ...fx, headFiles: () => fx.headFiles(p10c), registers: fx.makeRegisters() });
  expect(missOf(r10c, 'rights-catalogue', 'policy widgets:widgets_update'), 'a policy admitting a pinned role without a pin is named');
  const cat10d = fx.catalogue.replace("array['equipment_assets:equipment_officer_insert:INSERT']", "array['equipment_assets:equipment_officer_insert:INSERT','widgets:widgets_update:UPDATE']");
  const r10d = runBranch({ ...fx, headFiles: () => fx.headFiles(p10c), registers: fx.makeRegisters({ catalog: cat10d }) });
  expect(!r10d.misses.some((m) => m.rule === 'rights-catalogue'), 'an altered policy (cmd unknowable) matches its pinned table:policy prefix');
  const p10e = `${fx.headClean}\n\ncreate function public.finance_admit() returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select public.actor_holds_job_role('finance') $$;`;
  const r10e = runBranch({ ...fx, headFiles: () => fx.headFiles(p10e), registers: fx.makeRegisters() });
  expect(!r10e.misses.some((m) => m.rule === 'rights-catalogue'), 'a role the catalogue does not pin raises no requirement');

  // 11 — trigger-returning functions: no client registers, but the search-path rule keeps applying.
  const p11 = `${fx.headClean}\n\ncreate function public.trig_probe() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return new;
end $$;`;
  const r11 = runBranch({ ...fx, headFiles: () => fx.headFiles(p11), registers: fx.makeRegisters() });
  expect(missOf(r11, 'search-path', 'trig_probe'), 'a trigger-returning definer is still held to the search-path rule');
  expect(!r11.misses.some((m) => m.rule === 'denominator' && m.subject.includes('trig_probe')), 'a trigger-returning function needs no denominator entry');
  expect(!r11.misses.some((m) => m.rule === 'inventory' && m.subject.includes('trig_probe')), 'a trigger-returning function needs no inventory line');

  // 12 — a same-signature restatement re-opens no client registers, and its admission stays pinned.
  const p12 = `${fx.headClean}\n\ncreate or replace function public.pinned_admit() returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.actor_holds_job_role('planner');
end $$;`;
  const r12 = runBranch({ ...fx, headFiles: () => fx.headFiles(p12), registers: fx.makeRegisters() });
  expect(!r12.misses.length, `a same-signature restatement of a registered function re-opens nothing: ${JSON.stringify(r12.misses)}`);

  // 13 — an unread (non-dollar-quoted) definition is reported, never silently skipped.
  const p13 = `${fx.headClean}\n\ncreate function public.string_body() returns void language plpgsql security definer as 'begin null; end';`;
  const r13 = runBranch({ ...fx, headFiles: () => fx.headFiles(p13), registers: fx.makeRegisters() });
  expect(r13.unread.some((u) => u.name === 'string_body'), 'a non-dollar-quoted definition is reported as unread');

  console.log(`check-migration-registers self-test OK (${clean.requirements.length} requirements on the clean branch, 13 planted defects each reddened)`);
  process.exit(0);
}

const isRunAsMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isRunAsMain) {
  try {
    main();
  } catch (e) {
    console.error(`check-migration-registers: ${e.message}`);
    console.error('the base ref must be readable (fetch origin dev first, or pass --base <ref>); --head may be a ref or `worktree`.');
    process.exit(2);
  }
}
