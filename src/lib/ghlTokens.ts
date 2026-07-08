// SERVER-ONLY. Stores GoHighLevel Private Integration tokens per sub-account
// (locationId -> token) in a gitignored file so they never touch the browser or
// the database. Falls back to env (GHL_TOKENS json / GHL_TOKEN) for deploys.
// NOTE: file storage works in local/single-server dev. For serverless (Vercel)
// we'll move these to an encrypted DB column read via the service role.
import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), ".ghl-tokens.json");

function readFile(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function readEnv(): Record<string, string> {
  try {
    return JSON.parse(process.env.GHL_TOKENS || "{}");
  } catch {
    return {};
  }
}

export function writeToken(locationId: string, token: string) {
  const map = readFile();
  map[locationId] = token;
  fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
}

export function tokenForLocation(locationId: string): string | null {
  const file = readFile();
  if (file[locationId]) return file[locationId];
  const env = readEnv();
  if (env[locationId]) return env[locationId];
  return process.env.GHL_TOKEN || null;
}

export function configuredLocations(): string[] {
  return Array.from(new Set([...Object.keys(readFile()), ...Object.keys(readEnv())]));
}
