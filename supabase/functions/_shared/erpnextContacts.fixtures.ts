import type { SupabaseClient } from "@supabase/supabase-js";
type Row = Record<string, unknown>;
export function contactDb(seed: Record<string, Row[]> = {}, opts: { failTable?: string } = {}) {
  const rows: Record<string, Row[]> = {
    external_refs: [],
    contacts: [],
    companies: [],
    ...seed,
  };
  const writes: Array<{ table: string; op: string; row: Row }> = [];
  const client = {
    from(table: string) {
      let op = "select";
      let patch: Row = {};
      const filters: Array<[string, unknown]> = [];
      const inFilters: Array<[string, unknown[]]> = [];
      const value = (r: Row, k: string) => k.includes('->>') ? (r[k.split('->>')[0]] as Row)?.[k.split('->>')[1]] : r[k];
      const result = () => {
        const selected = (rows[table] ?? []).filter((r) =>
          filters.every(([k, v]) => value(r, k) === v) && inFilters.every(([k, vs]) => vs.includes(value(r, k)))
        );
        if (op === "insert" && table === "external_sync_watermarks" && patch.watermark_cursor === null) {
          return { data: [] as Row[], error: { message: 'null value in column "watermark_cursor" violates not-null constraint', code: "23502" } };
        }
        if (op !== "select") {
          writes.push({ table, op, row: patch });
          if (op === "insert") (rows[table] ??= []).push({ ...patch });
          else selected.forEach((r) => Object.assign(r, patch));
        }
        if (op === "select" && opts.failTable === table) return { data: [] as Row[], error: { message: "synthetic db fault", code: "XX000" } };
        return { data: selected, error: null as null | { message: string; code: string } };
      };
      const b = {
        select: (_c: string) => b,
        in: (k: string, vs: unknown[]) => { inFilters.push([k, vs]); return b; },
        is: () => b,
        not: () => b,
        contains: () => b,
        order: () => b,
        limit: () => b,
        eq: (k: string, v: unknown) => {
          filters.push([k, v]);
          return b;
        },
        insert: (r: Row) => {
          op = "insert";
          patch = r;
          return b;
        },
        update: (r: Row) => {
          op = "update";
          patch = r;
          return b;
        },
        upsert: (r: Row) => {
          op = "insert";
          patch = r;
          return b;
        },
        maybeSingle: () => {
          const r = result();
          return Promise.resolve({ ...r, data: r.data[0] ?? null });
        },
        then: (resolve: (r: unknown) => void) => resolve(result()),
      };
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, rows, writes };
}
