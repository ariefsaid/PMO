import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIVE_PROJECT_STATUSES } from './dashboardConstants';

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const migrationSuffix = '_executive_at_risk_active_delivery.sql';

function readSqlStatuses(): string[] {
  const migrationName = readdirSync(migrationDirectory).find((name) => name.endsWith(migrationSuffix));
  if (!migrationName) throw new Error(`No SQL migration found ending in ${migrationSuffix}`);

  const migration = readFileSync(join(migrationDirectory, migrationName), 'utf8');
  const helper = migration.match(
    /create\s+or\s+replace\s+function\s+public\.active_delivery_project_statuses\s*\(\)[\s\S]*?as\s+\$\$([\s\S]*?)\$\$;/i,
  );
  if (!helper) throw new Error('active_delivery_project_statuses() SQL body was not found');

  const arrayBody = helper[1].match(/select\s+array\s*\[([\s\S]*?)\]\s*::\s*text\s*\[\s*\]/i)?.[1];
  if (!arrayBody) throw new Error('active_delivery_project_statuses() array body is missing or malformed');

  const values = Array.from(arrayBody.matchAll(/'((?:''|[^'])*)'/g), (match) => match[1].replaceAll("''", "'"));
  const residue = arrayBody.replace(/'((?:''|[^'])*)'/g, '').replace(/[\s,]/g, '');
  if (values.length === 0 || residue.length > 0) {
    throw new Error('active_delivery_project_statuses() must contain only a non-empty text array');
  }

  return values;
}

describe('SQL / TypeScript active delivery taxonomy parity', () => {
  it('AC-986-002: ACTIVE_PROJECT_STATUSES equals active_delivery_project_statuses()', () => {
    expect(readSqlStatuses().sort()).toEqual(Array.from(ACTIVE_PROJECT_STATUSES).sort());
  });
});
