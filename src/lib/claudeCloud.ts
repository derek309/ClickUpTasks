// SERVER-ONLY: starting a Claude Code cloud session for a step given to Claude
// (Derek, 2026-10-13: "send it to Claude so we don't have to copy and paste").
// It fires a Claude Code routine the team set up at claude.ai/code/routines,
// whose own instructions say how to work a ClickUpTasks step; the text sent
// here only names the task and the step. Off until CLAUDE_ROUTINE_ID and
// CLAUDE_ROUTINE_TOKEN are set (Vercel). Runs on the plan of whoever made the
// routine, from the same usage as their chats.
// https://code.claude.com/docs/en/routines (API trigger, research preview)
const FIRE = (id: string) => `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(id)}/fire`;

export const claudeCloudReady = () => !!process.env.CLAUDE_ROUTINE_ID && !!process.env.CLAUDE_ROUTINE_TOKEN;

export async function startClaudeCloud(text: string): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const id = process.env.CLAUDE_ROUTINE_ID, token = process.env.CLAUDE_ROUTINE_TOKEN;
  if (!id || !token) return { ok: false, error: "not_set_up" };
  try {
    const res = await fetch(FIRE(id), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "experimental-cc-routine-2026-04-01", "content-type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({})) as { claude_code_session_url?: string; error?: { message?: string } | string };
    if (!res.ok) return { ok: false, error: typeof j.error === "string" ? j.error : j.error?.message || `Claude said ${res.status}` };
    return { ok: true, url: j.claude_code_session_url ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Claude" };
  }
}
