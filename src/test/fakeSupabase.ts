/* eslint-disable @typescript-eslint/no-explicit-any */

// In-memory stand-in for the slice of supabase-js the public portal code uses.
// Unlike a fake that only records calls, this one actually APPLIES eq/is/not/in
// filters to its rows, so a test can assert "a trashed row never comes back"
// by behaviour rather than by checking which filter strings were sent.
// Writes are recorded, never applied.

export type Row = Record<string, unknown>;

export const tables: Record<string, Row[]> = {};
export const writes: { table: string; op: "insert" | "update"; payload: unknown }[] = [];

export function resetTables(next: Record<string, Row[]>) {
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, structuredClone(next));
  writes.length = 0;
}

function query(table: string) {
  const preds: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" = "select";
  let payload: unknown;
  let single = false;
  let max: number | undefined;
  const b: any = {
    select: () => b,
    insert: (p: unknown) => { op = "insert"; payload = p; return b; },
    update: (p: unknown) => { op = "update"; payload = p; return b; },
    eq: (k: string, v: unknown) => { preds.push((r) => r[k] === v); return b; },
    neq: (k: string, v: unknown) => { preds.push((r) => r[k] !== v); return b; },
    is: (k: string, v: unknown) => { preds.push((r) => (r[k] ?? null) === v); return b; },
    // Only ever called as not(col, "is", null) by the code under test.
    not: (k: string, _op: string, v: unknown) => { preds.push((r) => (r[k] ?? null) !== v); return b; },
    in: (k: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[k])); return b; },
    order: () => b,
    limit: (n: number) => { max = n; return b; },
    maybeSingle: () => { single = true; return b; },
    then: (resolve: (r: { data: unknown; error: null }) => unknown, reject?: (e: unknown) => unknown) => {
      if (op !== "select") {
        writes.push({ table, op, payload });
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
      let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      if (max !== undefined) rows = rows.slice(0, max);
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
    },
  };
  return b;
}

export const fakeSupabaseAdmin = {
  from: query,
  rpc: async () => ({ data: 1, error: null }),
  storage: {
    from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/file" } }),
      upload: async () => ({ error: null }),
      createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://signed.example/upload/${path}`, path, token: "t" }, error: null }),
    }),
  },
};
