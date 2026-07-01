# PMO agent-native foundation

Colocated Nitro sidecar for PMO's agent-native adoption foundation.

## Local setup

1. Use Node 22.22+.
2. Start local Supabase from the repo root:
   ```bash
   supabase start -x studio,realtime,vector
   supabase db reset --yes
   ```
3. Create the dedicated framework role and schema-isolation seam:
   ```bash
   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
     -f scripts/create-agent-native-role.sql
   ```
4. Ensure `.env` points at the local stack and the dedicated role:
   ```dotenv
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=<local anon key>
   SUPABASE_SERVICE_ROLE_KEY=<local service role key>
   DATABASE_URL=postgresql://agent_native_app:agent_native_pw@127.0.0.1:54322/postgres
   PORT=8100
   ```

`DATABASE_URL` must use `agent_native_app`, whose role-level `search_path` is `agent_native, public`.
That is the load-bearing schema-isolation seam; `?schema=` is not honored by the framework's raw DDL path.

## Verify

Run from `pmo/agent-native/`:

```bash
npx tsc --noEmit
npx vitest run test/install-contract.test.ts
npx vitest run test/deputy-context.test.ts
npx vitest run test/deputy-invariant.gate.test.ts
```

## CI canary

`.github/workflows/ci.yml` runs the deputy-invariant gate when files under `pmo/agent-native/**` change.
That job starts local Supabase, resets the DB, installs `pmo/agent-native` dependencies, and runs:

```bash
npx vitest run test/deputy-invariant.gate.test.ts
```
