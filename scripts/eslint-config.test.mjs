// The scripts ESLint config must go red on a planted defect and green on clean code,
// and must lint .mjs files at all (a config that matches nothing also "passes").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ESLint } = createRequire(path.join(here, '..', 'pmo-portal', 'package.json'))('eslint');

async function lint(code) {
  const eslint = new ESLint({ cwd: here, overrideConfigFile: path.join(here, 'eslint.config.mjs') });
  const [result] = await eslint.lintText(code, { filePath: path.join(here, 'probe.mjs') });
  return result.messages;
}

test('an undefined identifier in a script is reported', async () => {
  const messages = await lint('console.log(notDeclaredAnywhere);\n');
  assert.deepEqual(messages.map((m) => m.ruleId), ['no-undef']);
});

test('clean node script with node globals passes', async () => {
  assert.deepEqual(await lint("import fs from 'node:fs';\nconsole.log(process.argv, fs.existsSync('x'));\n"), []);
});
