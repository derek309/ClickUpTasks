-- ClickUpTasks — AI relationship summary (Gemini). Run once.
-- Cached on the client row so opening the task drawer never triggers a paid
-- API call by itself — only clicking "Regenerate" in the AI tab does.
alter table clients add column if not exists ai_summary text;
alter table clients add column if not exists ai_summary_at timestamptz;
