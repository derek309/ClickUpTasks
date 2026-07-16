// Builds claude://code/new deep links — Anthropic's own, already-registered
// scheme (Claude Desktop) for opening a Claude Code session pre-seeded with
// a prompt and a working folder. Replaces an earlier custom Tauri "desktop
// helper" app that duplicated this; claude:// does the same job natively,
// cross-platform, with nothing for this repo to build or maintain.
const REPO_PATH_KEY = "cut_claudeRepoPath";

// The repo path is a per-machine local filesystem path, so it can't live in
// the DB — each person who uses this sets their own once (prompted on
// first use), same idea as the desktop helper's old Settings window.
function getRepoPath(): string {
  try {
    let path = localStorage.getItem(REPO_PATH_KEY) || "";
    if (!path) {
      path = window.prompt("Absolute path to your local clickuptasks repo (used to open Claude Code there — you can change this later by clearing your browser storage):", "") || "";
      if (path) localStorage.setItem(REPO_PATH_KEY, path);
    }
    return path;
  } catch {
    return "";
  }
}

export function claudeCodeUrl(prompt: string): string {
  const folder = getRepoPath();
  const params = new URLSearchParams({ q: prompt });
  if (folder) params.set("folder", folder);
  return `claude://code/new?${params.toString()}`;
}
