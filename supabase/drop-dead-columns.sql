-- ClickUpTasks: columns nothing reads or writes any more (audit 2026-09-29).
--
-- ⚠ Run only AFTER the chore/remove-dead-code deploy is live. Until then the
-- app still writes reviewed_at on every client and project save, and dropping
-- it first would make those saves fail.
--
--   clients.show_growth_plan      gated the Playbook, which was removed
--   clients.does_a2p              the same
--   clients.reviewed_at           the weekly client review, deleted 2026-09-28
--   projects.reviewed_at          the same
--   task_documents.reminder_drafted_at
--                                 the old reminder that staged a draft; the
--                                 reminders now send (review-reminders.sql)
--
-- Checked 2026-09-29: no view, rule or function in the database uses any of
-- them. The data in them is lost for good, which is the point; nothing shows it.
-- Run it in the Supabase SQL editor (project fiuikmynexwdewnazuab), then run
-- the read back at the bottom.

alter table clients drop column if exists show_growth_plan;
alter table clients drop column if exists does_a2p;
alter table clients drop column if exists reviewed_at;
alter table projects drop column if exists reviewed_at;
alter table task_documents drop column if exists reminder_drafted_at;

-- Read back: no rows.
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'clients' and column_name in ('show_growth_plan', 'does_a2p', 'reviewed_at'))
    or (table_name = 'projects' and column_name = 'reviewed_at')
    or (table_name = 'task_documents' and column_name = 'reminder_drafted_at'));
