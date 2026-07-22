// Builds claude-cli://open deep links — Anthropic's documented URL scheme
// (https://code.claude.com/docs/en/deep-links.md), registered by Claude
// Desktop, for opening a Claude Code session pre-seeded with a prompt and a
// working directory. Replaces an earlier custom Tauri "desktop helper" app
// that duplicated this; the URL scheme does the same job natively,
// cross-platform, with nothing for this repo to build or maintain.
//
// Always opens a NEW terminal session — the scheme has no resume/focus verb
// and no way to detect or target an already-running session for the same
// folder, so there's nothing this app can do to bring an existing session
// forward instead of starting another one. That's a Claude Desktop
// limitation, not something fixable here.
//
// The repo path is a per-machine local filesystem path, so it can't live in
// the DB — set once in the API Tokens panel's "Work with Claude" section
// (ApiTokensPanel.tsx), read here directly. No prompt() — if it's unset,
// the link just omits cwd rather than blocking the click.
export const CLAUDE_REPO_PATH_KEY = "cut_claudeRepoPath";

export function getClaudeRepoPath(): string {
  try {
    return localStorage.getItem(CLAUDE_REPO_PATH_KEY) || "";
  } catch {
    return "";
  }
}

export function claudeCodeUrl(prompt: string): string {
  const cwd = getClaudeRepoPath();
  const params = new URLSearchParams({ q: prompt });
  if (cwd) params.set("cwd", cwd);
  return `claude-cli://open?${params.toString()}`;
}
