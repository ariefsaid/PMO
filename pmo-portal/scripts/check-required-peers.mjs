#!/usr/bin/env node
// check-required-peers.mjs — CI guard for the legacy-peer-deps blind spot (I-2).
//
// pmo-portal installs with `legacy-peer-deps=true` (see .npmrc) because
// @agent-native/core declares an OPTIONAL peer `react-router@>=8` that conflicts
// with the react-router@7 that react-router-dom@7 transitively pulls in. Modern
// npm still ERESOLVEs on it because react-router@7 IS present in the tree, so
// the flag must stay.
//
// Side effect of legacy-peer-deps: it silences ALL peer mismatches — required
// AND optional — so a future change that drops an unsatisfied REQUIRED peer
// would install cleanly and break at runtime instead of failing install. This
// script re-asserts the contract that matters: every REQUIRED (non-optional)
// peer of every DIRECT dependency is satisfied by the installed tree. OPTIONAL
// peers (the react-router@>=8 case) are intentionally tolerated.
//
// Exit 0 = OK; exit 1 = an unsatisfied required peer (blocks CI); exit 2 = the
// script itself is misconfigured (semver not resolvable).
//
// Scope: DIRECT deps only. The transitive react-router@7/8 mismatch inside
// @agent-native/core is the framework's own (tolerated) concern; checking
// transitive peers here would re-introduce exactly the noise this guard avoids.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "package.json"));

let semver;
try {
  semver = require("semver");
} catch {
  console.error(
    "[check-required-peers] semver is not resolvable from pmo-portal — run via `npm run check:peers` from pmo-portal/.",
  );
  process.exit(2);
}

const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const directDeps = { ...(rootPkg.dependencies ?? {}), ...(rootPkg.devDependencies ?? {}) };

/** Resolve a package's package.json from the project root, or null if absent. */
function readInstalledPkg(name) {
  try {
    return require(`${name}/package.json`);
  } catch {
    return null;
  }
}

const problems = [];
let checkedPeers = 0;

for (const dep of Object.keys(directDeps)) {
  const depPkg = readInstalledPkg(dep);
  if (!depPkg) continue; // not installed (optional/OS-specific) — `npm ci` gates install.

  const peers = depPkg.peerDependencies ?? {};
  const optionalPeers = new Set(
    Object.entries(depPkg.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta?.optional === true)
      .map(([name]) => name),
  );

  for (const [peer, range] of Object.entries(peers)) {
    if (optionalPeers.has(peer)) continue; // tolerate optional peers (react-router@>=8)
    checkedPeers += 1;

    const peerPkg = readInstalledPkg(peer);
    if (!peerPkg) {
      problems.push(`${dep} requires peer "${peer}@${range}" but it is NOT installed.`);
      continue;
    }
    let satisfied;
    try {
      satisfied = semver.satisfies(peerPkg.version, range);
    } catch {
      problems.push(`${dep} declares an unparseable peer range "${peer}@${range}".`);
      continue;
    }
    if (!satisfied) {
      problems.push(`${dep} requires peer "${peer}@${range}" but found ${peerPkg.version}.`);
    }
  }
}

if (problems.length) {
  console.error(
    "[check-required-peers] unsatisfied REQUIRED peers (legacy-peer-deps would silently hide these):",
  );
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(
  `[check-required-peers] OK — ${checkedPeers} required peer(s) across ${Object.keys(directDeps).length} direct deps satisfied.`,
);
