// SERVER-ONLY. Stores GoHighLevel Private Integration tokens per sub-account
// (locationId -> token). Tokens never touch the browser.
//
// Storage tiers, in read order:
//   1. `ghl_tokens` table in Supabase (via service role) — survives serverless
//      deploys (Vercel), where the filesystem is ephemeral. See supabase/upgrade.sql.
//   2. Local gitignored file `.ghl-tokens.json` — dev fallback, also written as
//      a best-effort cache so local dev works without the service key.
//   3. Env: GHL_TOKENS (JSON map) / GHL_TOKEN (single shared token) — emergency
//      override for deploys before the table exists.
import fs from "fs";
import path from "path";
import { supabaseAdmin, adminConfigured } from "./supabaseAdmin";

const FILE = path.join(process.cwd(), ".ghl-tokens.json");

function readFile(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeFileMap(map: Record<string, string>) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
  } catch {
    /* read-only FS (serverless) — DB is the source of truth there */
  }
}

function readEnv(): Record<string, string> {
  try {
    return JSON.parse(process.env.GHL_TOKENS || "{}");
  } catch {
    return {};
  }
}

async function readDb(): Promise<Record<string, string>> {
  if (!adminConfigured) return {};
  const { data, error } = await supabaseAdmin.from("ghl_tokens").select("location_id, token");
  if (error || !data) return {}; // table may not exist yet — fall through to file/env
  return Object.fromEntries(data.map((r) => [r.location_id as string, r.token as string]));
}

export async function writeToken(locationId: string, token: string): Promise<void> {
  if (adminConfigured) {
    const { error } = await supabaseAdmin.from("ghl_tokens").upsert({ location_id: locationId, token });
    if (error) console.error("[ghlTokens] DB write failed:", error.message);
  }
  const map = readFile();
  map[locationId] = token;
  writeFileMap(map);
}

export async function tokenForLocation(locationId: string): Promise<string | null> {
  const db = await readDb();
  if (db[locationId]) return db[locationId];
  const file = readFile();
  if (file[locationId]) return file[locationId];
  const env = readEnv();
  if (env[locationId]) return env[locationId];
  return process.env.GHL_TOKEN || null;
}

export async function configuredLocations(): Promise<string[]> {
  const db = await readDb();
  return Array.from(new Set([...Object.keys(db), ...Object.keys(readFile()), ...Object.keys(readEnv())]));
}
