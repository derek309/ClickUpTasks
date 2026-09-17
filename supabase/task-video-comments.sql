-- ClickUpTasks: a comment on a video review remembers the moment it was left at.
--
-- Derek, 2026-09-17: the client watches, pauses where something is wrong, and
-- comments there. Slice 2 of docs/video-review-plan.md; slice 1
-- (supabase/task-video-reviews.sql) must already be in.
--
-- A pin has always been a SPOT: which version file, and x and y across it
-- (supabase/task-image-reviews.sql). A video has nothing useful to point at in a
-- moving picture, so a video pin is a MOMENT instead: pin_t, the second it was
-- paused at, and no x or y at all. The check below says exactly that, so a pin is
-- either a spot or a moment, never both and never neither. Nothing already stored
-- changes: every existing pin has pin_t null and keeps its spot.
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships commenting on a video.

alter table task_document_comments add column if not exists pin_t numeric;

alter table task_document_comments drop constraint if exists task_document_comments_pin_check;
alter table task_document_comments add constraint task_document_comments_pin_check check (
  (pin_file_id is null and pin_x is null and pin_y is null and pin_number is null and pin_t is null)
  or (pin_file_id is not null and pin_number > 0 and (
        (pin_t is null and pin_x between 0 and 1 and pin_y between 0 and 1)
     or (pin_t >= 0 and pin_x is null and pin_y is null)
  ))
);

-- Comments come back in time order on a video, so the rail reads down the video.
create index if not exists task_document_comments_pin_t
  on task_document_comments (document_id, pin_file_id, pin_t) where pin_t is not null;

-- Read back: pin_t should be listed, the check should show both arms, and the
-- last count should be 0 (no stored pin breaks the new rule).
select column_name, data_type from information_schema.columns
  where table_name = 'task_document_comments' and column_name = 'pin_t';
select pg_get_constraintdef(oid) from pg_constraint where conname = 'task_document_comments_pin_check';
select count(*) as pins_breaking_the_rule from task_document_comments
  where pin_file_id is not null
    and not ((pin_t is null and pin_x between 0 and 1 and pin_y between 0 and 1)
          or (pin_t >= 0 and pin_x is null and pin_y is null));
