// Local throwaway bed context; never print credentials.
import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const parse = (text) => Object.fromEntries(text.split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
  const i = line.indexOf('=');
  return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')];
}));
const bed = parse(readFileSync(resolve(root, '.env.odoo.local'), 'utf8'));
const supabase = parse(execFileSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const context = { odooUrl: `http://127.0.0.1:${bed.ODOO_PORT || '8069'}`, odooDatabase: bed.ODOO_DB, odooKey: bed.ODOO_API_KEY, supabaseUrl: supabase.API_URL, serviceRoleKey: supabase.SERVICE_ROLE_KEY };
if (Object.values(context).some((value) => !value)) throw new Error('Missing required local bed context fields');
const path = resolve(homedir(), '.pmo-odoo-bed-context.json');
writeFileSync(path, JSON.stringify(context), { mode: 0o600 });
chmodSync(path, 0o600);
console.log(`${path}: ${Object.keys(context).join(', ')}`);
