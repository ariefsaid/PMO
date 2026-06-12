#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POSIX = path.posix;

const sortByPath = (items) => [...items].sort((a, b) => a.path.localeCompare(b.path));

const rel = (root, fullPath) => POSIX.join(...path.relative(root, fullPath).split(path.sep));

const readText = (file) => fs.readFileSync(file, 'utf8');

const writeText = (file, contents) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};

const listFiles = (dir, extension) => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (!extension || entry.name.endsWith(extension)))
    .map((entry) => path.join(dir, entry.name))
    .sort();
};

const listTreeFiles = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  };
  visit(dir);
  return out.sort();
};

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const treeSignature = (dir) => {
  const signature = new Map();
  for (const file of listTreeFiles(dir)) {
    signature.set(rel(dir, file), sha256(file));
  }
  return signature;
};

const compareSignatures = ({ sourceDir, targetDir, label }) => {
  const findings = [];
  const source = treeSignature(sourceDir);
  const target = treeSignature(targetDir);
  for (const [file, hash] of source.entries()) {
    const targetPath = POSIX.join(label, file);
    if (!target.has(file)) {
      findings.push({ kind: 'missing', path: targetPath });
    } else if (target.get(file) !== hash) {
      findings.push({ kind: 'drift', path: targetPath });
    }
  }
  for (const file of target.keys()) {
    if (!source.has(file)) {
      findings.push({ kind: 'stale', path: POSIX.join(label, file) });
    }
  }
  return sortByPath(findings);
};

const mirrorDirectory = (sourceDir, targetDir) => {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
};

export const parseClaudeAgent = (contents, filePath = '<memory>') => {
  if (!contents.startsWith('---\n')) {
    throw new Error(`${filePath}: missing YAML frontmatter`);
  }
  const end = contents.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error(`${filePath}: unterminated YAML frontmatter`);
  }

  const frontmatter = contents.slice(4, end);
  const body = contents.slice(end + '\n---\n'.length).trimEnd();
  const fields = {};
  for (const line of frontmatter.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      throw new Error(`${filePath}: unsupported frontmatter line "${line}"`);
    }
    fields[match[1]] = match[2];
  }

  if (!fields.name) throw new Error(`${filePath}: missing "name" frontmatter`);
  if (!fields.description) throw new Error(`${filePath}: missing "description" frontmatter`);

  return {
    name: fields.name,
    description: fields.description,
    body,
  };
};

const tomlBasicString = (value) => JSON.stringify(value);

const tomlMultilineLiteral = (value) => {
  if (value.includes("'''")) {
    throw new Error("Cannot encode TOML literal string containing '''");
  }
  return `'''\n${value}'''`;
};

export const generateCodexAgentToml = (agent) => {
  return [
    `name = ${tomlBasicString(agent.name)}`,
    `description = ${tomlBasicString(agent.description)}`,
    `developer_instructions = ${tomlMultilineLiteral(agent.body)}`,
    '',
  ].join('\n');
};

const expectedCodexAgents = (root) => {
  const claudeDir = path.join(root, '.claude/agents');
  const expected = new Map();
  for (const file of listFiles(claudeDir, '.md')) {
    const agent = parseClaudeAgent(readText(file), rel(root, file));
    expected.set(`${agent.name}.toml`, generateCodexAgentToml(agent));
  }
  return expected;
};

const syncCodexAgents = ({ root, writeMode }) => {
  const codexDir = path.join(root, '.codex/agents');
  const expected = expectedCodexAgents(root);
  const findings = [];

  if (writeMode) {
    fs.mkdirSync(codexDir, { recursive: true });
    for (const file of listFiles(codexDir, '.toml')) {
      const name = path.basename(file);
      if (!expected.has(name)) fs.rmSync(file);
    }
    for (const [name, contents] of expected.entries()) {
      writeText(path.join(codexDir, name), contents);
    }
    return findings;
  }

  const existing = new Map(listFiles(codexDir, '.toml').map((file) => [path.basename(file), file]));
  for (const [name, contents] of expected.entries()) {
    const displayPath = `.codex/agents/${name}`;
    if (!existing.has(name)) {
      findings.push({ kind: 'missing', path: displayPath });
    } else if (readText(existing.get(name)) !== contents) {
      findings.push({ kind: 'drift', path: displayPath });
    }
  }
  for (const name of existing.keys()) {
    if (!expected.has(name)) findings.push({ kind: 'stale', path: `.codex/agents/${name}` });
  }
  return sortByPath(findings);
};

const syncPiAgents = ({ root, writeMode }) => {
  const piDir = path.join(root, '.pi');
  if (!fs.existsSync(piDir)) return [];

  const sourceDir = path.join(root, '.claude/agents');
  const targetDir = path.join(root, '.pi/agents');
  if (writeMode) {
    mirrorDirectory(sourceDir, targetDir);
    return [];
  }
  return compareSignatures({ sourceDir, targetDir, label: '.pi/agents' });
};

const syncSkills = ({ root, writeMode }) => {
  const sourceDir = path.join(root, '.claude/skills');
  if (!fs.existsSync(sourceDir)) return [];

  const findings = [];
  const targets = [path.join(root, '.agents/skills')];
  if (fs.existsSync(path.join(root, '.pi'))) {
    targets.push(path.join(root, '.pi/skills'));
  }

  for (const targetDir of targets) {
    if (writeMode) {
      mirrorDirectory(sourceDir, targetDir);
      continue;
    }
    if (!fs.existsSync(targetDir)) continue;
    findings.push(
      ...compareSignatures({
        sourceDir,
        targetDir,
        label: rel(root, targetDir),
      }),
    );
  }
  return sortByPath(findings);
};

export const syncAgentSurfaces = ({
  root = process.cwd(),
  write: writeMode = false,
  includeAgents = true,
  includeSkills = true,
} = {}) => {
  const agentFindings = includeAgents
    ? [
        ...syncCodexAgents({ root, writeMode }),
        ...syncPiAgents({ root, writeMode }),
      ]
    : [];
  const skillFindings = includeSkills ? syncSkills({ root, writeMode }) : [];
  return {
    ok: agentFindings.length === 0 && skillFindings.length === 0,
    agentFindings: sortByPath(agentFindings),
    skillFindings: sortByPath(skillFindings),
  };
};

const parseArgs = (argv) => {
  const options = {
    root: process.cwd(),
    write: false,
    includeAgents: true,
    includeSkills: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      options.write = false;
    } else if (arg === '--write') {
      options.write = true;
    } else if (arg === '--agents-only') {
      options.includeAgents = true;
      options.includeSkills = false;
    } else if (arg === '--skills-only') {
      options.includeAgents = false;
      options.includeSkills = true;
    } else if (arg === '--root') {
      options.root = path.resolve(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

const printHelp = () => {
  console.log(`Usage: node scripts/sync-agent-surfaces.mjs [--check|--write] [--agents-only|--skills-only] [--root <path>]

Mirrors project agent/skill surfaces with .claude as source of truth.

Modes:
  --check       Report drift and exit non-zero when tracked mirrors differ. Default.
  --write       Regenerate mirrors.

Scopes:
  --agents-only Sync .claude/agents -> .codex/agents and optional .pi/agents.
  --skills-only Sync .claude/skills -> .agents/skills and optional .pi/skills.
`);
};

const printResult = (result, writeMode) => {
  const verb = writeMode ? 'sync' : 'check';
  if (result.ok) {
    console.log(`agent surface ${verb}: ok`);
    return;
  }
  console.error(`agent surface ${verb}: drift found`);
  for (const finding of [...result.agentFindings, ...result.skillFindings]) {
    console.error(`- ${finding.kind}: ${finding.path}`);
  }
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      process.exit(0);
    }
    const result = syncAgentSurfaces(options);
    printResult(result, options.write);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
