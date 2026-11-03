// AC-PLN-014 — the module completeness gate's own proof (FR-PLN-015, D13).
//
// Every rule is exercised with a fixture that MUST fail naming the missing artefact, and a fixture that
// MUST pass. The gate's real-repo run is wired into `npm run check:guards` (CI verify); these tests are
// the reason a green real-repo run means something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRoutes,
  parseRail,
  parsePalette,
  parseFeatures,
  parsePlanCatalogue,
  parseAssistant,
  parseKeyMap,
  parseEnforcement,
  check,
} from './check-module-completeness.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

const APP_TSX = `
export const appRouteConfig: RouteObject[] = [
  { path: '/', element: <ExecutiveDashboard /> },
  { path: '/projects', element: <Projects /> },
  { path: '/incidents', element: <FeatureRoute feature="incidents" element={<IncidentsPage />} /> },
  { path: '/views/:viewId', element: <FeatureRoute feature="user_views" element={<UserViewRenderer />} /> },
  { path: '/stock', element: <StockOnHandPage /> },
  { path: '*', element: <NotFoundPage /> },
];
export const AppRoutes = () => <Routes />;
`;

const RAIL_TSX = `
const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard', group: 'Overview' },
  { to: '/sales', text: 'Sales', group: 'CRM', feature: 'crm' },
  { to: '/companies?type=Vendor', text: 'Suppliers', group: 'Delivery', unlessFeature: 'crm' },
  { to: '/stock', text: 'Stock', group: 'Delivery' },
];
`;

const ROUTE_MATCH_TS = `
export const MODULES: ModuleDef[] = [
  { module: 'dashboard', path: '/' },
  { module: 'sales', path: '/sales', feature: 'crm' },
  { module: 'stock', path: '/stock' },
];
`;

const FEATURES_TS = `
export const FEATURE_KEYS = [
  'incidents',
  'crm',
  'stock',
  'revenue',
] as const;
export const CORE_FEATURES = [
  'projects',
  'dashboard',
] as const;
`;

const CATALOGUE_SQL = `
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in ('incidents', 'crm', 'stock', 'revenue'));
insert into public.plans (id, name, seat_limit) values
  ('starter', 'Starter', 10),
  ('enterprise', 'Enterprise', null);
with plan_tiers(plan_id, tier) as (
  values ('starter'::text, 1), ('enterprise'::text, 2)
), feature_tiers(feature_key, minimum_tier) as (
  values ('incidents'::text, 1), ('crm', 1), ('stock', 2), ('revenue', 2)
)
insert into public.plan_features (plan_id, feature_key, enabled)
select p.plan_id, f.feature_key, p.tier >= f.minimum_tier
  from plan_tiers p cross join feature_tiers f;
`;

const READ_ENTITIES_TS = `
export const AGENT_ENTITY_TABLES = {
  procurements: { table: 'procurements' },
  stock_items: { table: 'stock_items' },
} as const;
`;

const WHITELIST_TS = `
export const ENTITY_WHITELIST: Readonly<Record<WhitelistedEntity, Entry>> =
  Object.freeze({
    projects: { table: 'projects' },
    incidents: { table: 'incidents' },
  });
`;

const ACTIONS_TS = `
export const queryEntityAction: Action = {
  name: 'query_entity',
  inputSchema: { type: 'object' },
  run: async () => {},
};
export const queryStockAction: Action = { name: 'query_stock', inputSchema: {}, run: async () => {} };
const notATool = { name: 'right_tool' };
`;

const FEATURE_SWITCHES_TS = `
export const ENTITY_FEATURE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  stock_items: 'stock',
  incidents: 'incidents',
});
export const TOOL_FEATURE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  query_stock: 'stock',
});
`;

const ENFORCEMENT_SQL = `
create or replace function public.assert_feature_on(p_org_id uuid, p_key text) returns void
language plpgsql as $$ begin raise exception 'feature_off' using detail = p_key; end $$;

create or replace function public.create_stock_item(p_org uuid) returns uuid
language plpgsql security definer as $$
begin
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  insert into public.stock_items default values returning id;
end $$;

do $$
begin
  for r in (
    select p.* from pg_policies p
      join (values
        ('stock_items','stock'),
        ('vendor_withholding_slips','procurement')
      ) as m(tablename, feature_key) on true
  ) loop
    execute 'create policy x on public.stock_items using (true) and public.org_feature_enabled(public.auth_org_id(), ''stock'')';
  end loop;
end $$;
`;

const LATER_OK_SQL = `
create or replace function public.create_stock_item(p_org uuid) returns uuid
language plpgsql security definer as $$
begin
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  insert into public.stock_items default values returning id;
end $$;
create policy write_stock on public.stock_items for insert
  with check (public.org_feature_enabled(public.auth_org_id(), 'stock'));
`;

const LATER_BAD_SQL = `
create or replace function public.create_stock_item(p_org uuid) returns uuid
language plpgsql security definer as $$
begin
  insert into public.stock_items default values returning id;
end $$;
create policy write_stock on public.stock_items for insert with check (true);
`;

function baseInput(overrides = {}) {
  return {
    routes: parseRoutes(APP_TSX),
    rail: parseRail(RAIL_TSX),
    palette: parsePalette(ROUTE_MATCH_TS),
    features: parseFeatures(FEATURES_TS),
    catalogue: parsePlanCatalogue([{ name: '0531_plan_catalogue.sql', sql: CATALOGUE_SQL }]),
    coreRoutes: { '/': 'dashboard', '/projects': 'projects' },
    coreNav: { '/': 'dashboard' },
    corePalette: { '/': 'dashboard' },
    assistant: parseAssistant([
      { name: 'readEntities.ts', text: READ_ENTITIES_TS },
      { name: 'types.ts', text: WHITELIST_TS },
      { name: 'actions.ts', text: ACTIONS_TS },
    ]),
    keyMap: parseKeyMap(new Map([['featureSwitches.ts', FEATURE_SWITCHES_TS]])),
    migrations: [],
    allowlist: [],
    ...overrides,
  };
}

const has = (errors, needle) => errors.some((e) => e.includes(needle));

// ── discovery ──────────────────────────────────────────────────────────────────────────────────

test('parsers discover route, nav, palette and registry entries from source text', () => {
  const routes = parseRoutes(APP_TSX);
  assert.deepEqual(
    routes.map((r) => [r.path, r.feature ?? null]),
    [['/', null], ['/projects', null], ['/incidents', 'incidents'], ['/views/:viewId', 'user_views'], ['/stock', null], ['*', null]],
  );
  const rail = parseRail(RAIL_TSX);
  assert.deepEqual(rail.map((r) => r.to), ['/', '/sales', '/companies?type=Vendor', '/stock']);
  assert.equal(rail[1].feature, 'crm');
  assert.equal(rail[2].unlessFeature, 'crm');
  assert.deepEqual(parseFeatures(FEATURES_TS), { keys: ['incidents', 'crm', 'stock', 'revenue'], core: ['projects', 'dashboard'] });
  assert.deepEqual(parsePalette(ROUTE_MATCH_TS).map((m) => m.path), ['/', '/sales', '/stock']);
});

test('parseAssistant discovers entities and only real tool definitions (inputSchema files)', () => {
  const inventory = parseAssistant([
    { name: 'readEntities.ts', text: READ_ENTITIES_TS },
    { name: 'types.ts', text: WHITELIST_TS },
    { name: 'actions.ts', text: ACTIONS_TS },
  ]);
  assert.deepEqual([...inventory.entities].sort(), ['incidents', 'procurements', 'projects', 'stock_items']);
  assert.deepEqual([...inventory.tools].sort(), ['query_entity', 'query_stock']);
});

// ── rule 1–3: routes, nav, palette ─────────────────────────────────────────────────────────────

test('AC-PLN-014 a route with no switch key and no core marking fails, naming the route', () => {
  const errors = check(baseInput());
  assert.ok(has(errors, 'route /stock:'), `expected a /stock route gap, got:\n${errors.join('\n')}`);
  assert.ok(!has(errors, 'route /incidents:'), 'a FeatureRoute-wrapped route passes');
  assert.ok(!has(errors, 'route /:'), 'a core-marked route passes');
});

test('AC-PLN-014 an unknown switch key fails naming the key', () => {
  const routes = [{ path: '/x', feature: 'not_a_key' }, ...parseRoutes(APP_TSX)];
  assert.ok(has(check(baseInput({ routes })), 'switch key not_a_key'));
});

test('AC-PLN-014 a stale core marking fails', () => {
  const errors = check(baseInput({ coreRoutes: { ...baseInput().coreRoutes, '/gone': 'dashboard' } }));
  assert.ok(has(errors, 'stale core route /gone'));
});

test('nav and palette gaps fail; an unlessFeature item is not a gap', () => {
  const errors = check(baseInput());
  assert.ok(has(errors, 'nav /stock:'));
  assert.ok(!has(errors, 'nav /companies?type=Vendor:'), 'unlessFeature is a declared key');
  assert.ok(has(errors, 'palette /stock:'));
});

test('a palette entry drifting from its gated Rail twin fails naming both', () => {
  const palette = [{ path: '/sales', feature: null }, { path: '/', feature: null }];
  const errors = check(baseInput({ palette, corePalette: { '/': 'dashboard' } }));
  assert.ok(has(errors, 'palette /sales:'), errors.join('\n'));
});

// ── rule 4–5: registry and plan catalogue ──────────────────────────────────────────────────────

test('a switch key missing from the DB catalogue fails naming the key', () => {
  const features = { keys: ['incidents', 'crm', 'stock', 'revenue', 'brand_new'], core: ['projects', 'dashboard'] };
  const errors = check(baseInput({ features }));
  assert.ok(has(errors, 'brand_new'), errors.join('\n'));
});

test('a missing plan_features row fails naming plan and key', () => {
  const catalogue = parsePlanCatalogue([{ name: '0531_plan_catalogue.sql', sql: CATALOGUE_SQL }]);
  catalogue.coverage.delete('enterprise\u0000stock');
  const errors = check(baseInput({ catalogue }));
  assert.ok(has(errors, 'plan enterprise: no plan_features row for switch key stock'), errors.join('\n'));
});

test('a plan row for an unknown key or a core key fails', () => {
  const catalogue = parsePlanCatalogue([{ name: '0531_plan_catalogue.sql', sql: CATALOGUE_SQL }]);
  catalogue.coverage.add('starter\u0000ghost_key');
  catalogue.coverage.add('starter\u0000projects');
  const errors = check(baseInput({ catalogue }));
  assert.ok(has(errors, 'ghost_key'), errors.join('\n'));
  assert.ok(has(errors, 'projects'), errors.join('\n'));
});

test('explicit plan_features inserts extend the matrix', () => {
  const sql = `${CATALOGUE_SQL}
insert into public.plan_features (plan_id, feature_key, enabled) values
  ('starter', 'revenue', true);`;
  const catalogue = parsePlanCatalogue([{ name: '0600_add_revenue.sql', sql }]);
  assert.ok(catalogue.coverage.has('starter\u0000revenue'));
});

// ── rule 6: assistant read paths ───────────────────────────────────────────────────────────────

test('every switch key needs an assistant read path; missing ones fail naming the key', () => {
  const errors = check(baseInput());
  assert.ok(has(errors, 'switch key crm: no assistant read path'), errors.join('\n'));
  assert.ok(has(errors, 'switch key revenue: no assistant read path'), errors.join('\n'));
  assert.ok(!has(errors, 'switch key stock: no assistant read path'), 'stock has an entity + tool');
});

test('a mapped entity/tool absent from the assistant inventory fails', () => {
  const keyMap = {
    entity: new Map([['stock_items', 'stock'], ['ghost_entity', 'stock'], ['incidents', 'incidents']]),
    tool: new Map([['query_stock', 'stock']]),
  };
  assert.ok(has(check(baseInput({ keyMap })), 'ghost_entity'));
});

test('parseKeyMap reads the S4 featureSwitches shape and the legacy fallback is explicit', () => {
  const map = parseKeyMap(new Map([['featureSwitches.ts', FEATURE_SWITCHES_TS]]));
  assert.equal(map.entity.get('stock_items'), 'stock');
  assert.equal(map.tool.get('query_stock'), 'stock');
  const legacy = parseKeyMap(new Map());
  assert.ok(legacy.entity.size > 0 && legacy.tool.size > 0, 'legacy map is the pre-S4 fallback');
});

// ── rule 7: enforcement recreation ─────────────────────────────────────────────────────────────

test('parseEnforcement extracts gated functions and tables from the S2 migration', () => {
  const parsed = parseEnforcement(ENFORCEMENT_SQL);
  assert.equal(parsed.functions.get('create_stock_item'), 'stock');
  assert.equal(parsed.tables.get('stock_items'), 'stock');
  assert.equal(parsed.tables.get('vendor_withholding_slips'), 'procurement');
});

test('a later migration recreating a gated function without the gate fails naming file, function and key', () => {
  const migrations = [
    { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
    { name: '0600_stock_write.sql', sql: LATER_BAD_SQL },
  ];
  const errors = check(baseInput({ migrations }));
  assert.ok(has(errors, '0600_stock_write.sql'), errors.join('\n'));
  assert.ok(has(errors, 'create_stock_item'), errors.join('\n'));
  assert.ok(has(errors, 'stock'), errors.join('\n'));
  assert.ok(has(errors, 'write_stock'), errors.join('\n'));
});

test('a later migration that keeps the gate passes; an allowlisted exception suppresses and goes stale', () => {
  const migrations = [
    { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
    { name: '0600_stock_write.sql', sql: LATER_OK_SQL },
  ];
  assert.deepEqual(check(baseInput({ migrations })), []);

  const allowed = check(baseInput({
    migrations: [
      { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
      { name: '0600_stock_write.sql', sql: LATER_BAD_SQL },
    ],
    allowlist: [
      { ids: ['enforcement:0600_stock_write.sql:create_stock_item', 'enforcement:0600_stock_write.sql:write_stock'], reason: 'test', restore: 'test' },
    ],
  }));
  assert.deepEqual(allowed, []);

  const stale = check(baseInput({
    migrations: [
      { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
      { name: '0600_stock_write.sql', sql: LATER_OK_SQL },
    ],
    allowlist: [{ ids: 'enforcement:0600_stock_write.sql:create_stock_item', reason: 'test', restore: 'test' }],
  }));
  assert.ok(has(stale, 'stale allowlist entry'), stale.join('\n'));
});

test('a stale allowlist entry fails — the list cannot decay into everything', () => {
  const errors = check(baseInput({ allowlist: [{ ids: ['route:/ghost'], reason: 'x', restore: 'y' }] }));
  assert.ok(has(errors, 'stale allowlist entry: route:/ghost'), errors.join('\n'));
});

test('a prefix allowlist id suppresses its gaps and still goes stale when the gaps close', () => {
  const base = baseInput({ allowlist: [{ ids: 'route:/stock*', reason: 'x', restore: 'y' }] });
  assert.ok(!has(check(base), 'route /stock:'), 'the prefix entry suppresses /stock');
  const moved = parseRoutes(APP_TSX).map((r) => (r.path === '/stock' ? { ...r, path: '/warehouse' } : r));
  assert.ok(has(check({ ...base, routes: moved }), 'stale allowlist entry: route:/stock*'), 'no gap left → stale');
});
