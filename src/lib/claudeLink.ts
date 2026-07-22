// Builds claude://code/new deep links — Anthropic's own, already-registered
// scheme (Claude Desktop) for opening a Claude Code session pre-seeded with
// a prompt and a working folder. Replaces an earlier custom Tauri "desktop
// helper" app that duplicated this; claude:// does the same job natively,
// cross-platform, with nothing for this repo to build or maintain.
//
// The repo path is a per-machine local filesystem path, so it can't live in
// the DB — set once in the API Tokens panel's "Work with Claude" section
// (ApiTokensPanel.tsx), read here directly. No prompt() — if it's unset,
// the link just omits folder rather than blocking the click.
export const CLAUDE_REPO_PATH_KEY = "cut_claudeRepoPath";

export function getClaudeRepoPath(): string {
  try {
    return localStorage.getItem(CLAUDE_REPO_PATH_KEY) || "";
  } catch {
    return "";
  }
}

export function claudeCodeUrl(prompt: string): string {
  const folder = getClaudeRepoPath();
  const params = new URLSearchParams({ q: prompt });
  if (folder) params.set("folder", folder);
  return `claude://code/new?${params.toString()}`;
}
