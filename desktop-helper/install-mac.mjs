#!/usr/bin/env node
// One-time macOS setup: builds an AppleScript applet (via osacompile, part
// of every macOS install — no Xcode, no Tauri) that claims the
// clickuptasks:// URL scheme, and saves the repo path handler.mjs reads at
// runtime. Safe to re-run — overwrites, not appends.
//
// Why an AppleScript applet and not a bare shell-script .app: macOS
// delivers a URL-scheme open as a GetURL Apple Event to a real app runtime
// (NSApplication's event loop), not as a plain argv[1] — confirmed by
// direct testing (a bare shell-script executable receives nothing when
// launched via `open`/NSWorkspace, even though it works fine when run
// directly). An osacompile-built applet has a real `on open location`
// handler that macOS's Apple Event delivery actually reaches.
//
// IMPORTANT — macOS Gatekeeper: a locally-built, ad-hoc-signed app (this
// one) isn't launchable via LaunchServices/NSWorkspace out of the box on
// current macOS — `spctl -a` reports "rejected: no usable signature" even
// though the URL-scheme claim itself registers correctly. This is Apple's
// normal policy for any unsigned local tool (same as any homebrew Mac app
// without a paid Developer ID), not specific to this helper. It needs a
// one-time manual approval — this script prints exactly what to do.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const here = dirname(fileURLToPath(import.meta.url));
const handlerPath = join(here, "handler.mjs");
const nodePath = process.execPath; // absolute path to THIS node binary — no PATH lookup at launch time, since a GUI launch's PATH is stripped down
const CONFIG_PATH = join(homedir(), ".clickuptasks-helper.json");
const APP_DIR = join(homedir(), "Applications", "ClickUpTasksHelper.app");
// Deliberately distinct from any earlier prototype's bundle id — an old,
// deleted Tauri prototype of this same helper left a stale Launch Services
// entry behind (pointing at a path that no longer exists) under
// com.clickuplocal.clickuptasks-helper, which silently shadowed a rebuild
// under that same identifier. A fresh identifier sidesteps stale LS state
// entirely instead of fighting the cache.
const BUNDLE_ID = "com.clickuplocal.cut-work-with-claude";

function looksLikeRepo(p) {
  return !!p && existsSync(join(p, "mcp", "server.mjs"));
}
function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

async function main() {
  if (process.platform !== "darwin") {
    console.error("This installer is for macOS only — use install-windows.mjs on Windows.");
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

  // 1. Compile a minimal AppleScript applet with a real open-location handler.
  rmSync(APP_DIR, { recursive: true, force: true });
  const scriptDir = mkdtempSync(join(tmpdir(), "cut-helper-"));
  const scriptPath = join(scriptDir, "handler.applescript");
  writeFileSync(
    scriptPath,
    `on open location this_URL
  do shell script ${appleScriptQuote(nodePath)} & " " & ${appleScriptQuote(handlerPath)} & " " & quoted form of this_URL
end open location
`
  );
  const compile = spawnSync("osacompile", ["-o", APP_DIR, scriptPath]);
  rmSync(scriptDir, { recursive: true, force: true });
  if (compile.status !== 0) {
    console.error(`osacompile failed: ${compile.stderr?.toString() || compile.error?.message}`);
    process.exit(1);
  }

  // 2. Patch the generated Info.plist: declare the clickuptasks:// scheme,
  // set our own bundle id, hide from Dock, and drop osacompile's legacy
  // Carbon-era keys (LSRequiresCarbon / LSMinimumSystemVersionByArchitecture
  // are anachronistic on current macOS and not needed here).
  const plist = join(APP_DIR, "Contents", "Info.plist");
  const pb = (args) => execFileSync("/usr/libexec/PlistBuddy", ["-c", args, plist]);
  try { pb("Delete :CFBundleIdentifier"); } catch {}
  pb(`Add :CFBundleIdentifier string ${BUNDLE_ID}`);
  pb("Add :CFBundleURLTypes array");
  pb("Add :CFBundleURLTypes:0 dict");
  pb(`Add :CFBundleURLTypes:0:CFBundleURLName string ${BUNDLE_ID}`);
  pb("Add :CFBundleURLTypes:0:CFBundleURLSchemes array");
  pb("Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string clickuptasks");
  pb("Add :LSUIElement bool true");
  try { pb("Delete :LSRequiresCarbon"); } catch {}
  try { pb("Delete :LSMinimumSystemVersionByArchitecture"); } catch {}

  // 3. Re-sign (patching Info.plist invalidates osacompile's original
  // signature) and register with Launch Services immediately.
  execFileSync("codesign", ["--force", "--deep", "-s", "-", APP_DIR]);
  const lsregister =
    "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister";
  try {
    execFileSync(lsregister, ["-f", APP_DIR]);
  } catch (e) {
    console.warn(`Warning: lsregister failed (${e.message}) — try opening the app once manually to force registration.`);
  }
  // Explicitly claim the scheme as default handler, in case something else
  // (or a stale registration) also claims it.
  spawnSync("osascript", [
    "-l", "JavaScript", "-e",
    `ObjC.import("CoreServices"); $.LSSetDefaultHandlerForURLScheme($("clickuptasks"), $(${JSON.stringify(BUNDLE_ID)}));`,
  ]);

  console.log(`Installed ${APP_DIR}`);
  console.log(`Repo path saved: ${repoPath}`);
  console.log("");
  console.log("Test it: open \"clickuptasks://work?task=verify123\" — should pop a new");
  console.log("Terminal window running claude.");
  console.log("");
  console.log("If nothing happens: this is a locally-built app with no paid Apple");
  console.log("Developer ID, so macOS Gatekeeper may block it on some Macs the same way");
  console.log("it would any other homebrew tool. Fix: in Finder, go to ~/Applications,");
  console.log("right-click ClickUpTasksHelper -> Open, click \"Open\" on the warning");
  console.log("dialog (or check System Settings -> Privacy & Security for a blocked-app");
  console.log("notice near the bottom and click \"Open Anyway\"), then try the test link");
  console.log("again.");
}

function appleScriptQuote(s) {
  return `quoted form of ${JSON.stringify(s)}`;
}

main();
