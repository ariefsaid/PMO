import path from 'node:path';

/** Read the proof baselines only for modes that consume them. */
export function loadProofSettings({ root, rulesOnly, fsApi }) {
  if (rulesOnly) return { budget: { targets: {} }, layoutBaseline: {} };

  const readJson = (relativePath) => {
    const file = path.join(root, relativePath);
    return fsApi.existsSync(file) ? JSON.parse(fsApi.readFileSync(file, 'utf8')) : {};
  };
  const budget = readJson('docs/ux/word-budget.json');
  budget.targets ||= {};
  return {
    budget,
    layoutBaseline: readJson('docs/ux/layout-baseline.json'),
  };
}
