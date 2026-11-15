// Flat ESLint config for the repo scripts (scripts/*.mjs). The app config only lints pmo-portal/,
// so these were never linted. Run from pmo-portal/:  npm run lint:scripts
// Packages resolve from pmo-portal/node_modules; no dependency is added.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(path.join(here, '..', 'pmo-portal', 'package.json'));
const js = requireFromApp('@eslint/js');
const globals = requireFromApp('globals');

export default [
  {
    // wf/jtbd-consumers.mjs is an Orca workflow DSL definition (top-level `phase`/`agent`/`return`), not runnable ESM.
    ignores: ['**/node_modules/**', 'wf/jtbd-consumers.mjs'],
  },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // These files hand functions to page.evaluate(), so they run in the browser as well as Node.
    files: ['perf/cpu-profile.mjs', 'perf/lighthouse-flow.mjs', 'ux-proof.mjs', 'ux-proof-metrics.mjs', 'measure-screens.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
