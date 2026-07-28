#!/usr/bin/env node
// One-time Windows setup: registers clickuptasks:// under HKEY_CURRENT_USER
// (no admin/elevation needed) pointing directly at this Node binary + this
// folder's handler.mjs, and saves the repo path handler.mjs reads at
// runtime. Safe to re-run — overwrites, not appends.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const here = dirname(fileURLToPath(import.meta.url));
const handlerPath = join(here, "handler.mjs");
const nodePath = process.execPath;
const CONFIG_PATH = join(homedir(), ".clickuptasks-helper.json");

function looksLikeRepo(p) {
  return !!p && existsSync(join(p, "mcp", "server.mjs"));
}
function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

async function main() {
  if (process.platform !== "win32") {
    console.error("This installer is for Windows only — use install-mac.mjs on macOS.");
    process.exit(1);
  }

  const existing = loadConfig().repoPath;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Path to your clickuptasks repo checkout${existing ? ` [${existing}]` : ""}: `)).trim();
  rl.close();
  const repoPath = resolve(answer || existing || "");
  if (!looksLikeRepo(repoPath)) {
    console.warn(`Warning: ${join(repoPath, "mcp", "server.mjs")} not found — this doesn't look like the clickuptasks repo. Saving anyway; re-run this script to fix it.`);
  }
  writeFileSync(CONFIG_PATH, JSON.stringify({ repoPath }, null, 2));

  const command = `"${nodePath}" "${handlerPath}" "%1"`;
  execFileSync("reg", ["add", "HKCU\\Software\\Classes\\clickuptasks", "/ve", "/d", "URL:ClickUpTasks Protocol", "/f"]);
  execFileSync("reg", ["add", "HKCU\\Software\\Classes\\clickuptasks", "/v", "URL Protocol", "/d", "", "/f"]);
  execFileSync("reg", ["add", "HKCU\\Software\\Classes\\clickuptasks\\shell\\open\\command", "/ve", "/d", command, "/f"]);

  console.log("Registered clickuptasks:// for this Windows user (HKEY_CURRENT_USER — no admin needed).");
  console.log(`Repo path saved: ${repoPath}`);
  console.log(`Verify: reg query "HKCU\\Software\\Classes\\clickuptasks\\shell\\open\\command"`);
  console.log(`Test it: Win+R -> clickuptasks:work?task=verify123 -> Enter — should pop a terminal running claude.`);
}

main();
