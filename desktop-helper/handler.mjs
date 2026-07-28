#!/usr/bin/env node
// clickuptasks:// URL scheme dispatcher. Invoked fresh on every URL open —
// no persistent process, no event loop. A hand-built .app on macOS (see
// install-mac.mjs) has no NSApplicationDelegate, so LaunchServices falls
// back to plain argv delivery: each click is a brand-new launch of this
// script with the clicked URL as argv[2], not an event handed to a
// long-running app. Same shape on Windows via a registry command. That
// means no tray icon, no single-instance plugin, no daemon — the whole
// job is: figure out resume-vs-create, cd into the repo, pop a terminal.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, platform } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".clickuptasks-helper.json");
const ID_RE = /^[A-Za-z0-9_-]+$/;

function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); }
  catch { return {}; }
}

function looksLikeRepo(repoPath) {
  return !!repoPath && existsSync(join(repoPath, "mcp", "server.mjs"));
}

// --- URL parsing ----------------------------------------------------------

// clickuptasks://work?task=<id>  or  clickuptasks://work?client=<id>[&project=<id>]
// Every id is validated here, before it ever touches a shell string —
// malformed input is dropped rather than reaching openTerminal.
function parseUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const task = u.searchParams.get("task");
  const client = u.searchParams.get("client");
  const project = u.searchParams.get("project");
  for (const id of [task, client, project]) {
    if (id !== null && !ID_RE.test(id)) return null;
  }
  if (task) return { kind: "task", task };
  if (client) return { kind: "client", client, project: project || null };
  return null;
}

// Prompt is built purely from validated ids — the clickuptasks MCP tools
// (get_task / list_client_tasks) fetch the human-readable details live, so
// no free-text title/name ever needs to cross the URL.
function buildSession(parsed) {
  if (parsed.kind === "task") {
    return {
      name: `cut-t-${parsed.task}`,
      prompt: `Look up and start working on ClickUpTasks task ${parsed.task} using the clickuptasks MCP tools. Read its full history first — description, checklist, and every comment — since work on this task may already be in progress; pick up from there instead of starting over. Then continue the work.`,
    };
  }
  const { client, project } = parsed;
  if (project) {
    return {
      name: `cut-c-${client}-p-${project}`,
      prompt: `Work through the open tasks for ClickUpTasks client ${client}, project ${project}, using the clickuptasks MCP tools — start with list_client_tasks.`,
    };
  }
  return {
    name: `cut-c-${client}`,
    prompt: `Work through the open tasks for ClickUpTasks client ${client} using the clickuptasks MCP tools — start with list_client_tasks.`,
  };
}

// --- session existence check ------------------------------------------

// claude --resume <name> does NOT auto-create — given a name that doesn't
// exist it opens an interactive session picker instead of failing cleanly
// (confirmed live against the real CLI). So the decision has to be made up
// front: does a session with this custom title, in this repo, already
// exist? Claude Code's own project-dir naming truncates+hashes long/nested
// paths rather than a simple "/"->"-" swap, so don't try to reproduce that
// — scan every project dir's session files for a matching customTitle+cwd
// pair instead. Slower, but correct regardless of the sanitization details.
function readHead(path, maxBytes = 65536) {
  try {
    const s = readFileSync(path, "utf8");
    return s.length > maxBytes ? s.slice(0, maxBytes) : s;
  } catch { return ""; }
}

function scanDirForSession(dir, repoPath, name) {
  if (!existsSync(dir)) return false;
  const titleNeedle = `"customTitle":${JSON.stringify(name)}`;
  const cwdNeedle = `"cwd":${JSON.stringify(repoPath)}`;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    const head = readHead(join(dir, f));
    if (head.includes(titleNeedle) && head.includes(cwdNeedle)) return true;
  }
  return false;
}

function sessionExists(repoPath, name) {
  const root = join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return false;
  // Fast path: the common (non-truncated) sanitization.
  if (scanDirForSession(join(root, repoPath.replace(/[/\\]/g, "-")), repoPath, name)) return true;
  // Fallback: scan every project dir rather than reproducing the
  // truncate+hash algorithm Claude Code uses for long/nested paths.
  for (const d of readdirSync(root)) {
    if (scanDirForSession(join(root, d), repoPath, name)) return true;
  }
  return false;
}

// --- terminal spawn (ported from the old Tauri helper's terminal.rs —
// macOS path already confirmed working there; Windows path written the
// same careful way, isolating all quoting inside a temp script file rather
// than fighting wt.exe's argv parsing) ------------------------------------

function shellQuotePosix(s) {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
function escapeForAppleScript(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function openTerminalMac(repoPath, claudeArgs) {
  const claudeCmd = `claude ${claudeArgs.map(shellQuotePosix).join(" ")}`;
  const shellCmd = `cd ${shellQuotePosix(repoPath)} && ${claudeCmd}`;
  const osa = `tell application "Terminal" to do script "${escapeForAppleScript(shellCmd)}"`;
  spawn("osascript", ["-e", osa], { detached: true, stdio: "ignore" }).unref();
}

// .cmd files double a literal quote to escape it, not backslash-escape.
function dq(s) { return s.replace(/"/g, '""'); }

function openTerminalWindows(repoPath, label, claudeArgs) {
  const scriptPath = join(tmpdir(), `clickuptasks-launch-${label}.cmd`);
  const argLine = claudeArgs.map((a) => `"${dq(a)}"`).join(" ");
  writeFileSync(scriptPath, `@echo off\r\ncd /d "${dq(repoPath)}"\r\nclaude ${argLine}\r\n`);

  const wt = spawn("wt.exe", ["-d", repoPath, "cmd", "/k", scriptPath], { detached: true, stdio: "ignore" });
  wt.on("error", () => {
    spawn("cmd.exe", ["/K", scriptPath], { detached: true, stdio: "ignore" }).unref();
  });
  wt.unref();
}

function openTerminal(repoPath, label, claudeArgs) {
  if (platform() === "darwin") return openTerminalMac(repoPath, claudeArgs);
  if (platform() === "win32") return openTerminalWindows(repoPath, label, claudeArgs);
  console.error("clickuptasks helper: only macOS and Windows are supported.");
  process.exit(1);
}

// handler.mjs itself has no controlling terminal (LaunchServices/Explorer
// launched it headlessly) — a bare console.error is invisible to the user.
// Pop a terminal that just shows the problem instead of failing silently.
function showErrorInTerminal(cwdHint, message) {
  const cwd = cwdHint && existsSync(cwdHint) ? cwdHint : homedir();
  if (platform() === "darwin") {
    const shellCmd = `echo ${shellQuotePosix(message)}; read -p "Press enter to close "`;
    const osa = `tell application "Terminal" to do script "${escapeForAppleScript(`cd ${shellQuotePosix(cwd)} && ${shellCmd}`)}"`;
    spawn("osascript", ["-e", osa], { detached: true, stdio: "ignore" }).unref();
  } else if (platform() === "win32") {
    const scriptPath = join(tmpdir(), "clickuptasks-launch-error.cmd");
    writeFileSync(scriptPath, `@echo off\r\ncd /d "${dq(cwd)}"\r\necho ${dq(message)}\r\npause\r\n`);
    spawn("cmd.exe", ["/K", scriptPath], { detached: true, stdio: "ignore" }).unref();
  } else {
    console.error(message);
  }
}

// --- entrypoint -------------------------------------------------------

const rawUrl = process.argv[2];
if (!rawUrl) {
  console.error("clickuptasks helper: no URL argument received.");
  process.exit(1);
}

const parsed = parseUrl(rawUrl);
if (!parsed) {
  showErrorInTerminal(null, `ClickUpTasks helper: couldn't parse "${rawUrl}" (missing/invalid task or client id).`);
  process.exit(1);
}

const cfg = loadConfig();
const repoPath = cfg.repoPath;
if (!looksLikeRepo(repoPath)) {
  showErrorInTerminal(
    null,
    `ClickUpTasks helper: no valid repo path configured (checked for mcp/server.mjs under "${repoPath || "(unset)"}"). ` +
      `Run "node install-mac.mjs" or "node install-windows.mjs" from your clickuptasks checkout's desktop-helper/ folder to fix this.`
  );
  process.exit(1);
}

const { name, prompt } = buildSession(parsed);
const resuming = sessionExists(repoPath, name);
const claudeArgs = resuming ? ["--resume", name, prompt] : ["-n", name, prompt];

openTerminal(repoPath, name, claudeArgs);
