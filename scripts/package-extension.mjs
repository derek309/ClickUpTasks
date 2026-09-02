// Rebuild the Clipper zip the app hands out, from the source in this repo.
//
// The zip in public/ was made by hand in July and never again. The source went
// on to 1.9.2 while the download stayed at 1.4.0, so anyone installing from
// Settings got a build five versions old — including, for six weeks, every
// person told to "reload the extension" to pick up a fix that had never been
// in their copy.
//
// Wired into `npm run build`, so the thing being served cannot drift from the
// thing in the repo again.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "chrome-extension");
const out = join(root, "public", "clickuptasks-gmail-extension.zip");

const version = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8")).version;

mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });

// Tests ship nothing to a browser, and the OS's own clutter should not travel.
execFileSync("zip", ["-r", "-q", out, ".", "-x", "*.test.js", "-x", ".DS_Store", "-x", "__MACOSX/*"], { cwd: src });

console.log(`[extension] packaged ${version}`);
