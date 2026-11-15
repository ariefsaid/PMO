/**
 * pmo-org.mjs — `pmo org add` and organization readiness (#2257, FR-ONB-011..016).
 *
 * Adds an organization to the shared project via the server-side edge function
 * `operator-org`, whose single create call sets plan, features and state. Node 22 standard library only.
 */

// Operator RPCs `pmo rpc` refuses by name: the command line adds an organisation only through `pmo org add`, whose single
// create call sets plan, features and state. Changing an existing organisation is app-only (#2280).
export const OPERATOR_ORG_RPCS = Object.freeze([
  'operator_create_org',
  'operator_create_org_with_setup',
  'operator_set_org_lifecycle_state',
  'operator_set_org_plan',
  'operator_toggle_feature',
]);

const REQUIRED_FLAGS = [
  ['name', '--name'],
  ['admin-email', '--admin-email'],
  ['admin-name', '--admin-name'],
  ['currency', '--currency'],
  ['locale', '--locale'],
  ['timezone', '--timezone'],
  ['plan', '--plan'],
];

/**
 * Pure classifier evaluating organization readiness (FR-ONB-016).
 * Healthy only when exists, explicit plan_id, admins.active + admins.pending >= 1, stage_config_count >= 1.
 * Failed names: organization, plan, admin, stage-config.
 *
 * @param {object} status
 * @returns {{ healthy: boolean, failed: string[] }}
 */
export function classifyOrgReadiness(status) {
  const failed = [];
  if (!status?.exists) failed.push('organization');
  if (status?.plan_id == null) failed.push('plan');
  const activeAdmins = Number(status?.admins?.active ?? 0);
  const pendingAdmins = Number(status?.admins?.pending ?? 0);
  if (activeAdmins + pendingAdmins < 1) failed.push('admin');
  const stageCount = Number(status?.stage_config_count ?? 0);
  if (stageCount < 1) failed.push('stage-config');

  return {
    healthy: failed.length === 0,
    failed,
  };
}

/**
 * Handle `pmo org add` execution (FR-ONB-011..015).
 */
export async function orgAdd(ctx, positionals, flags, api, { usage, CliError, Printed }) {
  const sub = positionals[0];
  if (sub !== 'add') {
    throw usage(`Unknown org command '${sub ?? ''}'. Use 'pmo org add'.`);
  }

  // Validate required flags (FR-ONB-011)
  for (const [key, flag] of REQUIRED_FLAGS) {
    if (!flags[key]) {
      throw usage(`Missing required flag ${flag}`);
    }
  }

  const state = flags.state ?? 'live';
  if (!['live', 'demo', 'test'].includes(state)) {
    throw usage(`--state must be 'live', 'demo' or 'test': got '${flags.state}'`);
  }

  // Parse repeatable --feature <key>=on|off
  const rawFeatures = Array.isArray(flags.feature) ? flags.feature : flags.feature ? [flags.feature] : [];
  const features = [];
  for (const item of rawFeatures) {
    const eq = item.indexOf('=');
    if (eq <= 0) throw usage(`--feature must be <key>=on|off: got '${item}'`);
    const key = item.slice(0, eq);
    const val = item.slice(eq + 1);
    if (val !== 'on' && val !== 'off') {
      throw usage(`--feature value must be 'on' or 'off': got '${item}'`);
    }
    features.push({ key, enabled: val === 'on' });
  }

  // Dry run (FR-ONB-012)
  if (!flags.confirm) {
    const featureList = features.map((f) => `${f.key}=${f.enabled ? 'on' : 'off'}`).join(', ');
    const steps = [
      `1. Call operator-org action "create" for "${flags.name}" (Admin: ${flags['admin-email']} / ${flags['admin-name']}, plan: ${flags.plan}, currency: ${flags.currency}, locale: ${flags.locale}${flags['number-locale'] ? `/${flags['number-locale']}` : ''}, timezone: ${flags.timezone}); the organization, its plan, its features${featureList ? ` (${featureList})` : ' (none specified)'} and state "${state}" are set together or not at all`,
      `2. Read organization status via operator-org action "status"`,
      `3. Check the plan, features and state match what was asked, and classify readiness`,
    ];
    return new Printed(`${steps.join('\n')}\n\nDry run. Add --confirm to run.\n`);
  }

  // Confirmed execution (FR-ONB-013, FR-ONB-014, FR-ONB-015)
  // Step 1: one create call; the server creates the organization and sets plan, features and state in one transaction.
  const createPayload = {
    action: 'create',
    name: flags.name,
    admin_email: flags['admin-email'],
    admin_full_name: flags['admin-name'],
    default_currency: flags.currency,
    default_locale: flags.locale,
    ...(flags['number-locale'] ? { default_number_locale: flags['number-locale'] } : {}),
    default_timezone: flags.timezone,
    plan_id: flags.plan,
    features: features.map((f) => ({ key: f.key, enabled: f.enabled })),
    lifecycle_state: state,
  };
  const createRes = await api.operatorOrg(createPayload);
  const orgId = createRes.org_id;
  const created = Boolean(createRes.created);
  ctx.stdout.write(`Organization ${created ? 'created' : 'already exists'}: ${orgId}\n`);

  // Step 2: status. An existing organization is never changed from here; a difference is reported and the run stops.
  const status = await api.operatorOrg({ action: 'status', org_id: orgId });
  if (!status?.exists) {
    ctx.stderr.write('Organization readiness failed: organization\n');
    throw new CliError('Organization readiness failed: organization', {
      exit: 1,
      code: 'unhealthy_org',
      details: { failed: ['organization'] },
    });
  }
  if (status.lifecycle_state === 'live' && state !== 'live') {
    throw new CliError('This organization is live; its state cannot be changed.', {
      exit: 1,
      code: 'live_org_terminal',
    });
  }
  if (status.plan_id != null && status.plan_id !== flags.plan) {
    throw new CliError(
      `Organization already has plan '${status.plan_id}', which differs from '--plan ${flags.plan}'. Changing a plan is not this command's job.`,
      { exit: 1, code: 'plan_conflict' },
    );
  }
  const have = new Map((status.features ?? []).map((f) => [f.key, f.enabled]));
  const differing = [
    ...features.filter((f) => have.get(f.key) !== f.enabled).map((f) => `feature ${f.key}`),
    ...(status.lifecycle_state !== state ? ['state'] : []),
  ];
  if (differing.length > 0) {
    throw new CliError(
      `Organization already exists with a different ${differing.join(', ')}. Changing an existing organization is done in the app.`,
      { exit: 1, code: 'org_differs', details: { differing } },
    );
  }

  const readiness = classifyOrgReadiness(status);
  if (!readiness.healthy) {
    const failedNames = readiness.failed.join(', ');
    ctx.stderr.write(`Organization readiness failed: ${failedNames}\n`);
    throw new CliError(`Organization readiness failed: ${failedNames}`, {
      exit: 1,
      code: 'unhealthy_org',
      details: { failed: readiness.failed },
    });
  }

  const activeAdmins = status.admins?.active ?? 0;
  const pendingAdmins = status.admins?.pending ?? 0;
  return new Printed(
    `Organization: ${orgId}\n` +
    `Plan: ${flags.plan}\n` +
    `Admin: ${activeAdmins} active, ${pendingAdmins} pending\n` +
    `State: ${state}\n`,
  );
}
