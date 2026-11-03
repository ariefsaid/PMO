// AC-PLN-014 — the module completeness gate's own proof (FR-PLN-015, D13).
//
// Every rule has a fixture that MUST fail naming the missing artefact and a fixture that MUST pass.
// The gate's real-repo run is wired into `npm run check:guards` (CI verify); these tests are why a
// green real-repo run means something. `--self-test` proves the same AC in-process (AC-PLN-014).
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

const INTERNAL = '\u0000';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

const APP_TSX = `
export const appRouteConfig: RouteObject[] = [
  { path: '/', element: <ExecutiveDashboard /> },
  { path: '/projects', element: <Projects /> },
  { path: '/incidents', element: <FeatureRoute feature="incidents" element={<IncidentsPage />} /> },
  { path: '/finance/receivables', element: <FinanceAccessRoute><FeatureRoute feature="revenue" element={<ReceivablesPage />} /></FinanceAccessRoute> },
  { path: '/views/:viewId', element: <FeatureRoute feature="crm" element={<UserViewRenderer />} /> },
  { path: '/stock', element: <FeatureRoute feature="stock" element={<StockOnHandPage />} /> },
  { path: '*', element: <NotFoundPage /> },
];
export const AppRoutes = () => <Routes />;
`;

const RAIL_TSX = `
const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard', group: 'Overview' },
  { to: '/sales', text: 'Sales', group: 'CRM', feature: 'crm' },
  { to: '/companies?type=Vendor', text: 'Suppliers', group: 'Delivery', unlessFeature: 'crm' },
  { to: '/stock', text: 'Stock', group: 'Delivery', feature: 'stock' },
];
`;

const ROUTE_MATCH_TS = `
export const MODULES: ModuleDef[] = [
  { module: 'dashboard', path: '/' },
  { module: 'sales', path: '/sales', feature: 'crm' },
  { module: 'stock', path: '/stock', feature: 'stock' },
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
export const AGENT_READ_ENTITIES = [
  'procurements',
  'stock_items',
] as const;
export const AGENT_ENTITY_TABLES = {
  stock_items: { table: 'stock_items' },
} as const;
`;

const WHITELIST_TS = `
export const ENTITY_WHITELIST: Readonly<Record<WhitelistedEntity, Entry>> =
  Object.freeze({
    projects: { table: 'projects' },
    incidents: { table: 'incident_reports' },
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
  procurements: 'crm',
  projects: 'crm',
});
export const TOOL_FEATURE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  query_stock: 'stock',
  query_entity: 'revenue',
});
`;

const ENFORCEMENT_SQL = `
create or replace function public.save_stock() returns void
language plpgsql security definer as $$
begin
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
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
    execute 'create policy x on public.stock_items using (true)';
  end loop;
end $$;
`;

const LATER_OK_SQL = `
create or replace function public.save_stock() returns void
language plpgsql security definer as $$
begin
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
end $$;
create policy write_stock on public.stock_items for insert
  with check (public.org_feature_enabled(public.auth_org_id(), 'stock'));
`;

const LATER_BAD_SQL = `
create or replace function public.save_stock() returns void
language plpgsql security definer as $$
begin
  insert into public.stock_items default values returning id;
end $$;
create policy write_stock on public.stock_items for insert with check (true);
`;

function assistantInventory() {
  return parseAssistant([
    { name: 'readEntities.ts', text: READ_ENTITIES_TS },
    { name: 'viewspec/types.ts', text: WHITELIST_TS },
    { name: 'actions.ts', text: ACTIONS_TS },
  ]);
}

/** A bundle with every rule satisfied (so each test can break exactly one thing). */
function completeInput(overrides = {}) {
  return {
    routes: parseRoutes(APP_TSX),
    rail: parseRail(RAIL_TSX),
    palette: parsePalette(ROUTE_MATCH_TS),
    features: parseFeatures(FEATURES_TS),
    catalogue: parsePlanCatalogue([{ name: '0531_plan_catalogue.sql', sql: CATALOGUE_SQL }]),
    assistant: assistantInventory(),
    keyMap: parseKeyMap(new Map([['featureSwitches.ts', FEATURE_SWITCHES_TS]])),
    migrations: [],
    coreRoutes: { '/': 'dashboard', '/projects': 'projects' },
    coreNav: { '/': 'dashboard' },
    corePalette: { '/': 'dashboard' },
    allowlist: [],
    ...overrides,
  };
}

const has = (errors, needle) => errors.some((error) => error.includes(needle));

test('the complete fixture is green (the baseline every failing case is derived from)', () => {
  assert.deepEqual(check(completeInput()), []);
});

// ── discovery ──────────────────────────────────────────────────────────────────────────────────

test('parsers discover every route, nav, palette and registry entry from source text', () => {
  const routes = parseRoutes(APP_TSX);
  assert.deepEqual(
    routes.map((route) => [route.path, route.feature]),
    [
      ['/', null],
      ['/projects', null],
      ['/incidents', 'incidents'],
      ['/finance/receivables', 'revenue'],
      ['/views/:viewId', 'crm'],
      ['/stock', 'stock'],
      ['*', null],
    ],
  );
  const rail = parseRail(RAIL_TSX);
  assert.deepEqual(rail.map((item) => item.to), ['/', '/sales', '/companies?type=Vendor', '/stock']);
  assert.equal(rail[1].feature, 'crm');
  assert.equal(rail[2].unlessFeature, 'crm');
  assert.deepEqual(parseFeatures(FEATURES_TS), { keys: ['incidents', 'crm', 'stock', 'revenue'], core: ['projects', 'dashboard'] });
  assert.deepEqual(parsePalette(ROUTE_MATCH_TS).map((module) => module.path), ['/', '/sales', '/stock']);
});

test('parseAssistant discovers both entity sources and only inputSchema-backed action names', () => {
  const inventory = assistantInventory();
  assert.deepEqual([...inventory.entities].sort(), ['incidents', 'procurements', 'projects', 'stock_items']);
  assert.deepEqual([...inventory.tools].sort(), ['query_entity', 'query_stock']);
  assert.equal(inventory.tools.has('right_tool'), false, 'a bare `name:` literal in the same file is not a tool');
});

test('parseKeyMap reads the S4 featureSwitches shape and falls back to the explicit legacy map', () => {
  const map = parseKeyMap(new Map([['featureSwitches.ts', FEATURE_SWITCHES_TS]]));
  assert.equal(map.entity.get('stock_items'), 'stock');
  assert.equal(map.tool.get('query_stock'), 'stock');
  const legacy = parseKeyMap(new Map());
  assert.ok(legacy.entity.size > 0 && legacy.tool.size > 0, 'legacy map is the pre-S4 fallback');
});

// ── rule 1–3: routes, nav, palette ─────────────────────────────────────────────────────────────

test('AC-PLN-014 a module with a route but no switch key, no plan row and no read path fails naming all three', () => {
  const catalogue = parsePlanCatalogue([{ name: '0531_plan_catalogue.sql', sql: CATALOGUE_SQL }]);
  catalogue.coverage.delete(`starter${INTERNAL}stock`);
  catalogue.coverage.delete(`enterprise${INTERNAL}stock`);
  const errors = check(completeInput({
    routes: parseRoutes(APP_TSX).map((route) => (route.path === '/stock' ? { ...route, feature: null } : route)),
    catalogue,
    keyMap: {
      entity: new Map([['procurements', 'crm'], ['projects', 'crm'], ['incidents', 'incidents']]),
      tool: new Map([['query_entity', 'revenue']]),
    },
  }));
  assert.ok(has(errors, 'route /stock: no switch key'), `route must be named, got:\n${errors.join('\n')}`);
  assert.ok(has(errors, 'plan starter: no plan_features row for switch key stock'), 'plan row must be named');
  assert.ok(has(errors, 'switch key stock: no assistant read path'), 'read path must be named');
});

test('a FeatureRoute-wrapped route and a core-marked route both pass', () => {
  const errors = check(completeInput());
  assert.ok(!has(errors, 'route /incidents:'), 'a FeatureRoute-wrapped route passes');
  assert.ok(!has(errors, 'route /:'), 'a core-marked route passes');
  assert.ok(!has(errors, 'route /finance/receivables:'), 'a FeatureRoute nested inside another wrapper passes');
});

test('an unknown switch key fails naming the key and the surface', () => {
  const routes = [{ path: '/x', feature: 'not_a_key' }, ...parseRoutes(APP_TSX)];
  const errors = check(completeInput({ routes }));
  assert.ok(has(errors, "route /x uses switch key 'not_a_key'"), errors.join('\n'));
});

test('a stale core marking fails', () => {
  const errors = check(completeInput({ coreRoutes: { ...completeInput().coreRoutes, '/gone': 'dashboard' } }));
  assert.ok(has(errors, 'stale core route /gone'));
});

test('nav and palette gaps fail; an unlessFeature item is a declared key, not a gap', () => {
  const errors = check(completeInput({
    rail: parseRail(RAIL_TSX).map((item) => (item.to === '/stock' ? { ...item, feature: null } : item)),
    palette: parsePalette(ROUTE_MATCH_TS).map((module) => (module.path === '/stock' ? { ...module, feature: null } : module)),
  }));
  assert.ok(has(errors, 'nav /stock:'), errors.join('\n'));
  assert.ok(!has(errors, 'nav /companies?type=Vendor:'), 'unlessFeature is a declared key');
  assert.ok(has(errors, 'palette /stock:'), errors.join('\n'));
});

test('a palette entry drifting from its gated Rail twin fails naming both sides', () => {
  const palette = [{ path: '/', feature: null }, { path: '/sales', feature: null }];
  const errors = check(completeInput({ palette, corePalette: { '/': 'dashboard' } }));
  assert.ok(has(errors, `palette /sales: drift from its Rail item — Rail gates it on 'crm'`), errors.join('\n'));
});

// ── rule 4–5: registry and plan catalogue ──────────────────────────────────────────────────────

test('the DB key CHECK and FEATURE_KEYS must be equal, in both directions', () => {
  const missingFromDb = check(completeInput({
    features: { keys: ['incidents', 'crm', 'stock', 'revenue', 'brand_new'], core: ['projects', 'dashboard'] },
  }));
  assert.ok(has(missingFromDb, 'switch key brand_new: missing from the DB catalogue'), missingFromDb.join('\n'));

  const staleInDb = check(completeInput({ catalogue: { ...completeInput().catalogue, keys: new Set(['incidents', 'crm', 'stock', 'revenue', 'ghost_key']) } }));
  assert.ok(has(staleInDb, 'DB catalogue key ghost_key'), staleInDb.join('\n'));
});

test('a core key in the DB catalogue fails (never gatable)', () => {
  const catalogue = { ...completeInput().catalogue, keys: new Set([...completeInput().catalogue.keys, 'projects']) };
  assert.ok(has(check(completeInput({ catalogue })), 'DB catalogue key projects: is a CORE_FEATURES key'), 'core key in the CHECK is named');
});

test('the tier matrix gives every plan × key a plan_features row', () => {
  const catalogue = parsePlanCatalogue([{ name: '0531_plan_catalogue.sql', sql: CATALOGUE_SQL }]);
  for (const plan of ['starter', 'enterprise']) {
    for (const key of ['incidents', 'crm', 'stock', 'revenue']) {
      assert.ok(catalogue.coverage.has(`${plan}${INTERNAL}${key}`), `${plan}/${key} must be covered`);
    }
  }
});

test('a missing plan_features row fails naming plan and key', () => {
  const catalogue = parsePlanCatalogue([{ name: '0531_plan_catalogue.sql', sql: CATALOGUE_SQL }]);
  catalogue.coverage.delete(`enterprise${INTERNAL}stock`);
  const errors = check(completeInput({ catalogue }));
  assert.ok(has(errors, 'plan enterprise: no plan_features row for switch key stock'), errors.join('\n'));
});

test('a plan row for an unknown plan, an unknown key, or a core key fails', () => {
  const catalogue = parsePlanCatalogue([{ name: '0531_plan_catalogue.sql', sql: CATALOGUE_SQL }]);
  catalogue.coverage.add(`ghost_plan${INTERNAL}stock`);
  catalogue.coverage.add(`starter${INTERNAL}ghost_key`);
  catalogue.coverage.add(`starter${INTERNAL}projects`);
  const errors = check(completeInput({ catalogue }));
  assert.ok(has(errors, "plan_features row names unknown plan 'ghost_plan'"), errors.join('\n'));
  assert.ok(has(errors, "carries key 'ghost_key', which is not a gatable FEATURE_KEYS entry"), errors.join('\n'));
  assert.ok(has(errors, 'core key projects must never have a plan_features row'), errors.join('\n'));
});

test('an explicit plan_features insert extends the matrix', () => {
  const sql = `${CATALOGUE_SQL}
insert into public.plan_features (plan_id, feature_key, enabled) values
  ('starter', 'sso', true);`;
  const catalogue = parsePlanCatalogue([{ name: '0600_add_sso.sql', sql }]);
  assert.ok(catalogue.coverage.has(`starter${INTERNAL}sso`));
});

// ── rule 6: assistant read paths ───────────────────────────────────────────────────────────────

test('every switch key needs an assistant read path; missing ones fail naming the key', () => {
  const keyMap = {
    entity: new Map([['stock_items', 'stock'], ['procurements', 'crm'], ['projects', 'crm']]),
    tool: new Map([['query_stock', 'stock'], ['query_entity', 'revenue']]),
  };
  const errors = check(completeInput({ keyMap }));
  assert.ok(has(errors, 'switch key incidents: no assistant read path'), errors.join('\n'));
  assert.ok(!has(errors, 'switch key stock: no assistant read path'), 'stock still has an entity + a tool');
});

test('a mapped entity/tool absent from the assistant inventory fails', () => {
  const keyMap = {
    entity: new Map([['stock_items', 'stock'], ['ghost_entity', 'stock'], ['incidents', 'incidents'], ['procurements', 'crm'], ['projects', 'crm']]),
    tool: new Map([['query_stock', 'stock'], ['ghost_tool', 'revenue']]),
  };
  const errors = check(completeInput({ keyMap }));
  assert.ok(has(errors, "names entity 'ghost_entity'"), errors.join('\n'));
  assert.ok(has(errors, "names tool 'ghost_tool'"), errors.join('\n'));
});

// ── rule 7: S2 enforcement must survive later migrations (#1783 item 3) ───────────────────────

test('parseEnforcement extracts the gated function and the gated write table', () => {
  const parsed = parseEnforcement(ENFORCEMENT_SQL);
  assert.equal(parsed.functions.get('save_stock'), 'stock');
  assert.equal(parsed.tables.get('stock_items'), 'stock');
  assert.equal(parsed.tables.get('vendor_withholding_slips'), 'procurement');
});

test('a later policy-enforcement migration becomes the baseline for its explicit gated policies', () => {
  const migrations = [
    {
      name: '0534_feature_enforcement.sql',
      sql: `do $$ begin
        for r in (select 1 join (values ('purchase_orders','procurement')) as m(tablename,feature_key) on true)
        loop null; end loop;
      end $$;`,
    },
    {
      name: '0536_recompose_purchase_order.sql',
      sql: 'create policy purchase_orders_insert on public.purchase_orders for insert with check (true);',
    },
    {
      name: '0538_procurement_write_policy_enforcement.sql',
      sql: `create policy purchase_orders_insert on public.purchase_orders for insert
        with check (public.org_feature_enabled(public.auth_org_id(), 'procurement'));`,
    },
  ];
  assert.equal(parseEnforcement(migrations[2].sql).tables.get('purchase_orders'), 'procurement');
  assert.deepEqual(check(completeInput({ migrations })), [], 'a later gated definition closes historical redefinition gaps');

  const laterUngated = [
    ...migrations,
    { name: '0539_rewrite_purchase_order.sql', sql: 'create policy purchase_orders_insert on public.purchase_orders for insert with check (true);' },
  ];
  assert.ok(
    has(check(completeInput({ migrations: laterUngated })), '0539_rewrite_purchase_order.sql recreates write policy purchase_orders_insert'),
    'a policy rewrite after the latest enforcement baseline still fails when it drops the gate',
  );
});

test('a later migration recreating a gated function or write policy without the gate fails', () => {
  const migrations = [
    { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
    { name: '0600_stock_write.sql', sql: LATER_BAD_SQL },
  ];
  const errors = check(completeInput({ migrations }));
  assert.ok(has(errors, '0600_stock_write.sql recreates public.save_stock()'), errors.join('\n'));
  assert.ok(has(errors, "without the 'stock' gate"), errors.join('\n'));
  assert.ok(has(errors, 'recreates write policy write_stock on stock_items'), errors.join('\n'));
});

test('a later migration that keeps the gate passes; a wrong key fails; the exception list is exact', () => {
  const gated = [
    { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
    { name: '0600_stock_write.sql', sql: LATER_OK_SQL },
  ];
  assert.deepEqual(check(completeInput({ migrations: gated })), []);

  const wrongKey = [
    { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
    { name: '0600_stock_write.sql', sql: LATER_OK_SQL.replace("'stock'", "'revenue'") },
  ];
  assert.ok(has(check(completeInput({ migrations: wrongKey })), "without the 'stock' gate"), 'a wrong key is not the gate');

  const allowlisted = check(completeInput({
    migrations: [
      { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
      { name: '0600_stock_write.sql', sql: LATER_BAD_SQL },
    ],
    allowlist: [
      {
        ids: ['enforcement:0600_stock_write.sql:save_stock', 'enforcement:0600_stock_write.sql:write_stock'],
        reason: 'fixture',
        restore: 'fixture',
      },
    ],
  }));
  assert.deepEqual(allowlisted, []);
});

test('the enforcement rule is inert until the S2 migration exists', () => {
  const migrations = [{ name: '0600_stock_write.sql', sql: LATER_BAD_SQL }];
  assert.deepEqual(check(completeInput({ migrations })), [], 'no 0534 on the branch → nothing to enforce yet');
});

// ── rule 7, second half: the gates that exist TODAY (0081), `alter policy`, the raising-only body ──
//
// 0081 gates the write policies of 24 tables long before S2's 0534 exists. The rule must baseline that
// list, treat an `alter policy` rewrite as a recreation, and refuse the non-raising helper inside a
// function body. Each fixture here passes on the pre-fix guard.

const BASELINE_81_SQL = `
do $$
declare feat text;
begin
  for r in (select tablename from pg_policies where tablename in ('timesheet_entries','m365_pkce_states','user_views')) loop
    feat := case r.tablename
      when 'timesheet_entries' then 'timesheets'
      when 'm365_pkce_states' then 'm365_integration'
      when 'user_views'       then 'user_views'
    end;
  end loop;
end $$;`;

const SELECT_POLICY_SQL = 'create policy timesheet_entries_select on timesheet_entries for select using (true);';

/** 0081's baseline + a read policy that already exists, then one later migration to check. */
function withBaseline81(later) {
  return {
    migrations: [
      { name: '0002_rls.sql', sql: SELECT_POLICY_SQL },
      { name: '0081_feature_flag_write_enforcement.sql', sql: BASELINE_81_SQL },
      { name: '0610_rewrite.sql', sql: later },
    ],
  };
}

test('rule 7 baselines 0081 — a gated table that is not in 0534 is still covered', () => {
  const parsed = parseEnforcement(BASELINE_81_SQL);
  assert.equal(parsed.tables.get('timesheet_entries'), 'timesheets');
  assert.equal(parsed.tables.get('m365_pkce_states'), 'm365_integration');
  assert.equal(parsed.tables.get('user_views'), 'user_views');
});

test('an `alter policy` rewrite of a gated write policy without the conjunct fails', () => {
  const errors = check(completeInput(withBaseline81(
    'alter policy timesheet_entries_write on public.timesheet_entries with check (true);',
  )));
  assert.ok(has(errors, 'recreates write policy timesheet_entries_write on timesheet_entries'), errors.join('\n'));
  assert.ok(has(errors, "without the 'timesheets' gate"), errors.join('\n'));
});

test('an `alter policy` that keeps the conjunct passes; a read policy or a role-only alter is not a hole', () => {
  assert.deepEqual(check(completeInput(withBaseline81(
    `alter policy timesheet_entries_write on public.timesheet_entries
       with check (public.org_feature_enabled(public.auth_org_id(), 'timesheets'));`,
  ))), []);
  assert.deepEqual(check(completeInput(withBaseline81(
    'alter policy timesheet_entries_select on public.timesheet_entries using (public.is_active_member());',
  ))), [], '0081 gates WRITE policies; altering a SELECT policy keeps no gate to keep');
  assert.deepEqual(check(completeInput(withBaseline81(
    'alter policy timesheet_entries_write on public.timesheet_entries to authenticated;',
  ))), [], 'a role-only alter leaves the predicate (and its gate) in place');
  assert.deepEqual(check(completeInput(withBaseline81(
    'create policy timesheet_entries_read on public.timesheet_entries for select using (true);',
  ))), [], 'a new read policy on a gated table needs no gate');
  assert.deepEqual(check(completeInput(withBaseline81(
    'create policy timesheet_entries_admin_only on public.timesheet_entries as restrictive for delete using (auth_role() = \'Admin\');',
  ))), [], 'a RESTRICTIVE policy only narrows its permissive twin — the gate lives on that twin');
});

test('a digit-named gated table is not silently skipped by the policy parser', () => {
  const errors = check(completeInput(withBaseline81(
    'create policy write_pkce on public.m365_pkce_states for insert with check (true);',
  )));
  assert.ok(has(errors, 'recreates write policy write_pkce on m365_pkce_states'), errors.join('\n'));
});

test('a function body gated only by the non-raising org_feature_enabled is not gated', () => {
  const migrations = [
    { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
    {
      name: '0600_stock_write.sql',
      sql: `create or replace function public.save_stock() returns void language plpgsql as $$
begin perform public.org_feature_enabled(public.auth_org_id(), 'stock'); end $$;`,
    },
  ];
  const errors = check(completeInput({ migrations }));
  assert.ok(has(errors, "recreates public.save_stock() without the 'stock' gate"), errors.join('\n'));
});

test('the baseline records a function whichever helper form it declares, so a bare recreation still fails', () => {
  const baseline = `create or replace function public.save_stock() returns void language plpgsql as $$
begin perform public.org_feature_enabled(public.auth_org_id(), 'stock'); end $$;`;
  const errors = check(completeInput({
    migrations: [
      { name: '0534_feature_enforcement.sql', sql: baseline },
      { name: '0600_stock_write.sql', sql: 'create or replace function public.save_stock() returns void language plpgsql as $$ begin null; end $$;' },
    ],
  }));
  assert.ok(has(errors, "recreates public.save_stock() without the 'stock' gate"), errors.join('\n'));
});

test('the raising rewrite forms are still caught: raise-exception bodies pass, tagged/quoted bodies are parsed', () => {
  const raising = `create or replace function public.save_stock() returns void language plpgsql as $$
begin raise exception 'feature_off' using detail = 'stock'; end $$;`;
  assert.deepEqual(check(completeInput({
    migrations: [
      { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
      { name: '0600_stock_write.sql', sql: raising },
    ],
  })), [], 'an explicit raise exception feature_off is the gate');

  for (const body of [
    'create or replace function public.save_stock() returns void language plpgsql as $body$\nbegin null; end $body$;',
    "create or replace function public.save_stock() returns void language plpgsql as 'begin null; end';",
  ]) {
    const errors = check(completeInput({
      migrations: [
        { name: '0534_feature_enforcement.sql', sql: ENFORCEMENT_SQL },
        { name: '0600_stock_write.sql', sql: body },
      ],
    }));
    assert.ok(has(errors, 'recreates public.save_stock()'), `body form not parsed: ${body}\n${errors.join('\n')}`);
  }
});

test('a commented-out gate is not a gate on any of the three FE surfaces', () => {
  const app = `export const appRouteConfig: RouteObject[] = [
  { path: '/', element: <ExecutiveDashboard /> },
  { path: '/fixture-module', /* <FeatureRoute feature="stock"> */ element: <FixturePage /> },
];`;
  const rail = `const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard' },
  { to: '/fixture-nav', text: 'Fixture' /* feature: 'stock' */ },
];`;
  const palette = `export const MODULES: ModuleDef[] = [
  { module: 'dashboard', path: '/' },
  { module: 'fixture-module', path: '/fixture-module' /* feature: 'stock' */ },
];`;
  assert.equal(parseRoutes(app).find((route) => route.path === '/fixture-module')?.feature, null);
  assert.equal(parseRail(rail).find((item) => item.to === '/fixture-nav')?.feature, null);
  assert.equal(parsePalette(palette).find((module) => module.path === '/fixture-module')?.feature, null);
});

// ── allowlist ─────────────────────────────────────────────────────────────────────────────────

test('a stale allowlist entry fails — the list cannot decay into everything', () => {
  const errors = check(completeInput({ allowlist: [{ ids: ['route:/ghost'], reason: 'x', restore: 'y' }] }));
  assert.ok(has(errors, 'stale allowlist entry: route:/ghost'), errors.join('\n'));
});

test('an allowlist entry without a restore note fails', () => {
  const errors = check(completeInput({ allowlist: [{ ids: 'route:/stock', reason: 'x' }] }));
  assert.ok(has(errors, 'needs both a reason and a restore note'), errors.join('\n'));
});

test('an allowlist entry suppresses the gaps it names, and only those', () => {
  const errors = check(completeInput({
    routes: parseRoutes(APP_TSX).map((route) => (route.path === '/stock' ? { ...route, feature: null } : route)),
    rail: parseRail(RAIL_TSX).map((item) => (item.to === '/stock' ? { ...item, feature: null } : item)),
    palette: parsePalette(ROUTE_MATCH_TS).map((module) => (module.path === '/stock' ? { ...module, feature: null } : module)),
    keyMap: {
      entity: new Map([['stock_items', 'stock'], ['procurements', 'crm'], ['projects', 'crm']]),
      tool: new Map([['query_stock', 'stock'], ['query_entity', 'revenue']]),
    },
    allowlist: [{ ids: ['route:/stock', 'nav:/stock', 'palette:/stock'], reason: 'x', restore: 'y' }],
  }));
  assert.ok(!has(errors, 'route /stock:'), errors.join('\n'));
  assert.ok(!has(errors, 'nav /stock:'), errors.join('\n'));
  assert.ok(!has(errors, 'palette /stock:'), errors.join('\n'));
  assert.ok(has(errors, 'switch key incidents: no assistant read path'), 'other gaps still fail');
});

test('a prefix allowlist id suppresses its gaps and still goes stale when they close', () => {
  const broken = parseRoutes(APP_TSX).map((route) => (route.path === '/stock' ? { ...route, feature: null } : route));
  const base = completeInput({ routes: broken, allowlist: [{ ids: 'route:/stock*', reason: 'x', restore: 'y' }] });
  assert.ok(!has(check(base), 'route /stock:'), 'the prefix entry suppresses /stock');
  const moved = broken.map((route) => (route.path === '/stock' ? { ...route, path: '/warehouse' } : route));
  assert.ok(has(check({ ...base, routes: moved }), 'stale allowlist entry: route:/stock*'), 'no gap left → stale');
});
