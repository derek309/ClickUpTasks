-- ClickUpTasks: who approved a review, so the team can close one out themselves.
--
-- Derek, 2026-09-17: "sometimes on an image or html or video I need to mark it
-- approve or change the status instead of send for review. Right now I have to
-- hit send for review when I don't want to, and then click out of the email and
-- delete the draft." Two things were wrong. Picking Approved by hand set the
-- status but never set approved_at, so the client's page locked and thanked them
-- while the team's side stayed unlocked: the two disagreed. And there was no way
-- to say a review was approved because the client said so on a call, rather than
-- because they clicked the button.
--
-- approved_by is that difference, and nothing else changes:
--   null      the client approved it themselves, by clicking Approve. Every
--             review approved before today is this, which is what they were.
--   a member  someone on the team closed it out on the client's say so.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships approving by hand.

alter table task_documents add column if not exists approved_by text;

-- Read back: the column, and every review approved so far still reading as the
-- client's own approval (approved_by null), which is what they all were.
select column_name, data_type, is_nullable from information_schema.columns
  where table_name = 'task_documents' and column_name = 'approved_by';
select count(*) as approved_reviews, count(approved_by) as approved_by_the_team
  from task_documents where approved_at is not null;
