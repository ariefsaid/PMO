import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  generateCodexAgentToml,
  parseClaudeAgent,
  syncAgentSurfaces,
} from './sync-agent-surfaces.mjs';

const withTempRoot = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-surface-sync-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const write = (root, rel, contents) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
};

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const sampleClaudeAgent = `---
name: release-engineer
description: Package a completed issue.
tools: Read, Bash
model: sonnet
---
You are the release engineer.

- Commit trailer: \`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\`.
`;

test('parseClaudeAgent extracts frontmatter and body', () => {
  const parsed = parseClaudeAgent(sampleClaudeAgent, '.claude/agents/release-engineer.md');

  assert.equal(parsed.name, 'release-engineer');
  assert.equal(parsed.description, 'Package a completed issue.');
  assert.equal(parsed.body.includes('You are the release engineer.'), true);
  assert.equal(parsed.body.includes('---'), false);
});

test('generateCodexAgentToml wraps Claude agent content verbatim as Codex TOML', () => {
  const toml = generateCodexAgentToml(parseClaudeAgent(sampleClaudeAgent, 'agent.md'));

  assert.match(toml, /^name = "release-engineer"/m);
  assert.match(toml, /^description = "Package a completed issue\."/m);
  assert.match(toml, /^developer_instructions = '''/m);
  // The body is carried VERBATIM — only the frontmatter→TOML structure is transformed.
  // The commit trailer is a fixed project convention (CLAUDE.md) and must survive unchanged.
  assert.match(toml, /Co-Authored-By: Claude Opus 4\.8 \(1M context\)/);
});

test('check mode reports missing, drifted, and stale Codex agents without writing', () =>
  withTempRoot((root) => {
    write(root, '.claude/agents/release-engineer.md', sampleClaudeAgent);
    write(root, '.claude/agents/spec-reviewer.md', `---
name: spec-reviewer
description: Review against spec.
---
Spec body.
`);
    write(root, '.codex/agents/release-engineer.toml', 'name = "wrong"\n');
    write(root, '.codex/agents/stale.toml', 'name = "stale"\n');

    const result = syncAgentSurfaces({ root, write: false });

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.agentFindings.map((finding) => `${finding.kind}:${finding.path}`).sort(),
      [
        'drift:.codex/agents/release-engineer.toml',
        'missing:.codex/agents/spec-reviewer.toml',
        'stale:.codex/agents/stale.toml',
      ],
    );
    assert.equal(read(root, '.codex/agents/release-engineer.toml'), 'name = "wrong"\n');
  }));

test('write mode regenerates Codex agents, removes stale files, and mirrors Pi agents when .pi exists', () =>
  withTempRoot((root) => {
    write(root, '.claude/agents/release-engineer.md', sampleClaudeAgent);
    write(root, '.codex/agents/stale.toml', 'name = "stale"\n');
    fs.mkdirSync(path.join(root, '.pi'), { recursive: true });
    write(root, '.pi/agents/stale.md', 'stale\n');

    const result = syncAgentSurfaces({ root, write: true });

    assert.equal(result.ok, true);
    assert.match(read(root, '.codex/agents/release-engineer.toml'), /name = "release-engineer"/);
    assert.equal(fs.existsSync(path.join(root, '.codex/agents/stale.toml')), false);
    assert.equal(read(root, '.pi/agents/release-engineer.md'), sampleClaudeAgent);
    assert.equal(fs.existsSync(path.join(root, '.pi/agents/stale.md')), false);
  }));

test('write mode mirrors ignored skills to Codex and optional Pi skill directories', () =>
  withTempRoot((root) => {
    write(root, '.claude/skills/grill-with-docs/SKILL.md', '# Grill\n');
    write(root, '.claude/skills/grill-with-docs/references/r.md', 'ref\n');
    fs.mkdirSync(path.join(root, '.pi'), { recursive: true });

    const result = syncAgentSurfaces({
      root,
      write: true,
      includeAgents: false,
      includeSkills: true,
    });

    assert.equal(result.ok, true);
    assert.equal(read(root, '.agents/skills/grill-with-docs/SKILL.md'), '# Grill\n');
    assert.equal(read(root, '.agents/skills/grill-with-docs/references/r.md'), 'ref\n');
    assert.equal(read(root, '.pi/skills/grill-with-docs/SKILL.md'), '# Grill\n');
  }));
