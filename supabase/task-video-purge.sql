-- ClickUpTasks: a video's file is cleared 30 days after its review is approved.
--
-- Derek, 2026-09-17: video is the first thing the app stores that is big enough
-- to be worth not keeping. Slice 4 of docs/video-review-plan.md. The review, its
-- versions, its comments and its history all stay forever; only the video file
-- itself goes, and the page then says so.
--
-- cleared_at, and NOT removed_at, which the plan first said. removed_at already
-- means "taken off the review": sharedVersionFiles drops any version holding a
-- removed file, so reusing it would make the whole version disappear from the
-- client's list, taking the context for its comments with it. The two facts are
-- different and need different columns:
--   removed_at   someone took this file off the review
--   cleared_at   the file's bytes were deleted to save storage; the version is
--                still a version and its comments still point at it
--
-- Run once in the Supabase SQL editor (project fiuikmynexwdewnazuab), BEFORE the
-- deploy that ships the purge.

alter table task_document_files add column if not exists cleared_at timestamptz;

-- The sweep looks for approved video reviews and their files; both sides of that
-- walk want an index.
create index if not exists task_document_files_video_live
  on task_document_files (document_id) where purpose = 'video' and cleared_at is null and removed_at is null;

-- Read back: the column, and how much video is stored right now (the number the
-- purge exists to hold down).
select column_name, data_type from information_schema.columns
  where table_name = 'task_document_files' and column_name = 'cleared_at';
select count(*) as videos_stored,
       round(coalesce(sum(size_bytes), 0) / 1048576.0, 1) as megabytes
  from task_document_files where purpose = 'video' and cleared_at is null and removed_at is null;
