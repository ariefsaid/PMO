# Agent cost measurement — post-deploy queries

Run these against the **prod** Supabase (SQL editor) once migration `0084` is live and the edge
functions are deployed, to answer empirically: **is prompt caching paying off, what does a real
conversation cost, and is DeepInfra latency acceptable** (the throughput-vs-privacy trade). Source
tables: `agent_usage` (one row per model call — prompt/completion/cached/reasoning tokens, cost,
action, run_id) + `agent_runs` (status + timing). Each query is self-contained (mobile-friendly).

All windows are `last 30 days` — adjust the `interval` as needed. `action` splits interactive `chat`
from `compose` (view builder) and `automation` (fired jobs).

---

## Q1 — Cache economics + token shape, per model (+ overall). THE headline.

```sql
select
  coalesce(model, '— ALL —')  as model,
  coalesce(action, 'all')     as action,
  count(*)                    as calls,
  sum(prompt_tokens)          as in_tok,
  sum(completion_tokens)      as out_tok,
  round(100.0 * sum(prompt_tokens)
        / nullif(sum(prompt_tokens + completion_tokens), 0), 1)          as input_pct,
  round(100.0 * sum(cached_tokens)
        / nullif(sum(prompt_tokens), 0), 1)                              as cache_hit_pct,
  round(100.0 * sum(reasoning_tokens)
        / nullif(sum(completion_tokens), 0), 1)                          as reasoning_pct,
  round(sum(cost)::numeric, 5)                                           as total_cost,
  round((sum(cost) / nullif(count(*), 0))::numeric, 6)                   as cost_per_call
from agent_usage
where created_at >= now() - interval '30 days'
group by grouping sets ((model, action), ())
order by model nulls last, action;
```

**Read it:**
- `cache_hit_pct` is the number that matters. **~0%** → caching is NOT working (cold prefix from low
  traffic, or routing landed on a non-caching backend — check the provider). **60–90%** → the shared
  static prefix is being reused; the cost lever is live.
- `input_pct` should sit ~90%+ (confirms the input-dominated shape the whole program targets).
- `reasoning_pct` = how much of the output is thinking vs answer.

## Q2 — Cost + latency **per run** (the real per-conversation numbers), split by status.

```sql
with runs as (
  select
    u.run_id,
    r.status,
    count(*)                    as rounds,
    sum(u.prompt_tokens)        as in_tok,
    sum(u.cached_tokens)        as cached_tok,
    sum(u.cost)                 as run_cost,
    extract(epoch from (r.updated_at - r.created_at)) as run_secs
  from agent_usage u
  join agent_runs r on r.id = u.run_id
  where u.created_at >= now() - interval '30 days'
    and u.run_id is not null
  group by u.run_id, r.status, r.updated_at, r.created_at
)
select
  status,
  count(*)                                                                as runs,
  round(avg(rounds), 1)                                                   as avg_rounds,
  round(avg(run_cost)::numeric, 5)                                        as avg_cost,
  round(percentile_cont(0.50) within group (order by run_cost)::numeric, 5) as p50_cost,
  round(percentile_cont(0.95) within group (order by run_cost)::numeric, 5) as p95_cost,
  round(max(run_cost)::numeric, 5)                                        as max_cost,
  round(100.0 * sum(cached_tok) / nullif(sum(in_tok), 0), 1)             as cache_hit_pct,
  round(percentile_cont(0.50) within group (order by run_secs)::numeric, 1) as p50_secs,
  round(percentile_cont(0.95) within group (order by run_secs)::numeric, 1) as p95_secs
from runs
group by status
order by runs desc;
```

**Read it:**
- Grouping by `status` isolates the honest numbers — look at the **`completed`** row for real
  cost/run (`p50_cost`/`p95_cost`), not the average across errored/trivial runs (the bias you flagged
  earlier). `avg_rounds` shows whether these are real multi-round conversations.
- `p95_secs` = end-to-end run wall-clock → the **DeepInfra-latency decision input**. ⚠ Caveat: it
  includes any user think-time on a `needs-approval`/`ask_user` pause; for pure model latency the
  finer signal is the `[agent-chat] round=… model_ms=…` line in the edge-function logs.

## Q3 — Daily trend: does caching **warm up** as traffic grows?

```sql
select
  date_trunc('day', created_at)::date  as day,
  count(*)                             as calls,
  round(100.0 * sum(cached_tokens) / nullif(sum(prompt_tokens), 0), 1)   as cache_hit_pct,
  round(sum(cost)::numeric, 4)                                           as cost,
  round((sum(cost) / nullif(sum(prompt_tokens + completion_tokens), 0) * 1e6)::numeric, 4)
                                                                         as cost_per_mtok
from agent_usage
where created_at >= now() - interval '30 days'
group by 1
order by 1 desc;
```

**Read it:** the "warmth = traffic" hypothesis — on higher-`calls` days `cache_hit_pct` should rise
and `cost_per_mtok` (effective blended $/Mtok) should fall. If cache stays 0% even on busy days →
routing/provider problem, not a warmth problem.

---

## Decision rule (throughput vs privacy)

After a representative window:
- **cache_hit_pct healthy (≥ ~60%) AND p95_secs acceptable** → keep the privacy-first no-train pin as-is.
- **p95_secs too slow** (DeepInfra ~17 tps is the known cost of no-train) → set `AGENT_PROVIDER_SORT=throughput`
  (stays inside the no-train `only` allow-list, just picks the fastest of them) — secret only, no redeploy.
- **cache_hit_pct ~0% despite traffic** → routing isn't landing on a caching backend; check the resolved
  provider and the `only` slugs (all 7 verified 2026-07-10).
