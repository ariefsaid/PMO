-- 0037_dashboard_payload_shape.test.sql — payload shape: avg_gross_margin removed, new keys present
-- AC-1103 / FR-SPD-004
-- Note: cast to jsonb for the ? (key exists) operator since the RPC returns json type.
begin;
select plan(6);

-- Seed Executive JWT
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1103: avg_gross_margin key must NOT be present (OBS-SPD-002 removed)
select ok(
  not (get_executive_dashboard()::jsonb ? 'avg_gross_margin'),
  'AC-1103: avg_gross_margin removed from payload (FR-SPD-004)'
);

-- AC-1103: five new keys must be present
select ok(
  get_executive_dashboard()::jsonb ? 'on_hand_margin',
  'AC-1103: on_hand_margin key present (FR-SPD-004)'
);

select ok(
  get_executive_dashboard()::jsonb ? 'on_hand_value',
  'AC-1103: on_hand_value key present (FR-SPD-004)'
);

select ok(
  get_executive_dashboard()::jsonb ? 'pipeline_weighted_value',
  'AC-1103: pipeline_weighted_value key present (FR-SPD-004)'
);

select ok(
  get_executive_dashboard()::jsonb ? 'pipeline_projected_margin',
  'AC-1103: pipeline_projected_margin key present (FR-SPD-004)'
);

select ok(
  get_executive_dashboard()::jsonb ? 'pipeline_total_value',
  'AC-1103: pipeline_total_value key present (FR-SPD-004)'
);

reset role;
select * from finish();
rollback;
