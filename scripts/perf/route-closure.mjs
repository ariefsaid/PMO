#!/usr/bin/env node
// Usage: PMO_DIST_DIR=<dir built with --manifest> node scripts/perf/route-closure.mjs <manifest key> [more keys]
// Prints the static-import closure (requests, raw and gzip bytes) of the given entries (#2099).
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(process.env.PMO_DIST_DIR ?? 'pmo-portal/dist');
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'));
const seen = new Set();
const visit = (key) => { if (seen.has(key) || !manifest[key]) return; seen.add(key); (manifest[key].imports ?? []).forEach(visit); };
const keys = process.argv.slice(2).map((arg) => Object.keys(manifest).find((key) => key === arg || key.endsWith(arg)));
if (keys.some((key) => !key)) { console.error('manifest key not found', process.argv.slice(2)); process.exit(1); }
keys.forEach(visit);
const rows = [...seen].map((key) => { const bytes = readFileSync(join(dist, manifest[key].file)); return { file: manifest[key].file, raw: bytes.length, gz: gzipSync(bytes).length }; });
const own = rows.filter((row) => keys.some((key) => manifest[key].file === row.file));
console.log(JSON.stringify({ requests: rows.length, raw: rows.reduce((n, r) => n + r.raw, 0), gz: rows.reduce((n, r) => n + r.gz, 0), entries: own }, null, 2));
if (process.env.LIST) rows.forEach((r) => console.log(r.file, r.raw, r.gz));
