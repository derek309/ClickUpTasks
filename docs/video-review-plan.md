# Video review: plan

Derek edits videos and wants clients to review them the way they review image
sets and HTML pages: watch, pause, comment where they paused, approve or ask
for changes, version 2 beside version 1. Decided with him 2026-09-17. Nothing
below is built yet.

## Decisions already made

- **Files live in Supabase**, in the existing private `task-files` bucket,
  under the same `doc/<documentId>/…` folder as every other review file. His
  own player, private signed links, no new vendor.
  - Google Drive was rejected: its embedded player will not tell our page
    where the video is paused, so timestamped comments are impossible.
  - Unlisted YouTube and Vimeo would work (their players do report position)
    and cost nothing, but put someone else's player and a shareable link in
    front of a client.
- **The video source stays swappable.** A version points at either a stored
  file or a host's id/URL, so moving to Cloudflare Stream later is a setting
  and a copy job, not a rebuild.
- **720p review copies, not masters.** Warn on upload above ~200MB. Masters
  stay on Derek's Mac.
- **Purge**: a nightly job deletes the video file 30 days after the review is
  approved. The review, its comments and its history stay; the page then says
  the video has been cleared. This is the app's first retention rule that is
  not about trash.
- Storage today: 170MB across 267 files, Supabase Pro (100GB storage, 250GB
  egress a month). 720p runs ~15MB a minute, masters ~100MB. Watching, not
  storing, is the limit: 250GB is roughly 5,500 minutes of 720p viewing.
  Revisit Cloudflare Stream when sustained egress passes ~150GB a month.

## What already helps

- `src/lib/uploadTypes.ts:8-14` already allows `mp4, mov, webm, m4v`, and
  `sharedFileKind` already returns `"video"` (`:30`).
- The browser already uploads straight to Supabase Storage with a signed URL
  (`src/lib/docFileUpload.ts:12-45`, `startDocUpload`/`finishDocUpload` in
  `src/lib/taskDocumentFiles.ts:103-150`), so Vercel's ~4.5MB body limit is
  not in the way.
- `src/lib/reviewKinds.ts` is built to be the single point where a kind is
  added ("a new kind is one line here").
- Deleting a document's stored files already exists:
  `deleteDocStorage(documentId)` (`taskDocumentFiles.ts:166-174`), used by the
  trash sweep (`src/lib/trashCleanupServer.ts`).
- Cron routes and their auth already exist (`src/app/api/cron/purge-trash`,
  `src/lib/cronAuth.ts:13-18`, `Bearer $CRON_SECRET`), declared in
  `vercel.json`.

Note: the client review link is `/doc/<token>`
(`src/app/doc/[token]/page.tsx`). The `/r/` links belong to the separate
`cul-review` WordPress plugin.

## Slices, in build order

Each slice is meant to be shippable on its own. Derek runs every piece of SQL
by hand (MCP writes are blocked), and a push to `main` deploys production.

### Slice 1: a video review exists and plays

- SQL (Derek runs): extend `task_documents_kind_check` and
  `task_document_files_purpose_check` to include `video`
  (`supabase/task-page-reviews.sql:26,29`).
- `src/lib/reviewKinds.ts`: add `video` to `ReviewKind`, `FileKind`,
  `parseKind`, `filePurpose`, and the four label maps (`WHAT`, `TITLE`,
  `NEW_NAME`, `IN_SENTENCE`) plus `commentHint`.
- `src/lib/db.ts:692`: map `purpose === "video"`, which today silently falls
  back to `"file"`.
- Upload: raise the cap for video only (`MAX_SHARED_FILE_BYTES` is 25MB in
  `src/lib/uploadTypes.ts:17`; video needs its own limit, ~500MB, with a
  warning above 200MB in the UI). Branch the `purpose === "image"` guards in
  `startDocUpload` (`:106`, `:130`), let `docFileSignedUrl` sign a video
  (`:220` refuses `page` and unpublished images), and allow the video purpose
  in `src/app/api/tasks/[id]/document/files/route.ts:25`.
- Rendering: a `video` branch in `DocReviewView.tsx:492-540` and in
  `src/components/cockpit/TaskDocument.tsx`, with a plain `<video>` element
  fed by a signed URL. Signed URLs last 300s today
  (`taskDocumentFiles.ts:222`), which is shorter than a video: either extend
  the life for video or refresh the URL while playing.
- Kind lists that must learn about video: `src/lib/data.ts:738,1857,1878,
  1904,1916`, `TaskDrawer.tsx:36,483,967`, `HandoffPage.tsx:24`,
  `reviewService.ts:203`, `ReviewsBoard.tsx:51`.
- Test: upload a 2 minute 720p file to a task, send it, open `/doc/<token>`
  in a private window, watch it play to the end.

### Slice 2: comments carry the moment

- SQL (Derek runs): add `pin_t numeric` (seconds) to
  `task_document_comments` and relax the pin check constraints
  (`supabase/task-image-reviews.sql:50`, `task-page-reviews.sql:34`).
- `src/lib/reviewPins.ts`: carry `t` through `cleanPin`/`cleanAnchor`
  alongside the existing `{fileId,x,y}` shape.
- A `VideoReview` component beside `ImagePinBoard`: pause, comment box, the
  current time captured with the comment, numbered like image pins.
- The comment rail lists in time order; clicking a comment seeks the video.
- Test: leave three comments at different points, reload, check the order and
  that clicking each one seeks.

### Slice 3: the rest of the review flow

- Approve and request changes (`publishFromClient` / `clientPublish`,
  `taskDocumentServer.ts:243-340`) with video versions.
- Version 2 beside version 1, `use_version` / `remove_version`.
- AI naming (`src/lib/reviewAutoName.ts:32,81,91-109`) and the draft email.
- MCP: `mcp/core.mjs:436-437` enums and `src/lib/mcpReviewServices.ts:43`,
  so a video review can be created and fetched from a chat like the others.

### Slice 4: the purge

- New helper beside `deleteDocStorage`: delete video files for reviews
  approved more than 30 days ago, leaving rows and comments; mark the file
  row `removed_at` so the page can say the video has been cleared.
- New cron route beside `src/app/api/cron/purge-trash/route.ts`, using
  `authorizeCron`, declared in `vercel.json`.
- The review page and the task drawer say "video cleared" rather than showing
  a broken player.
- Somewhere in the app, one line showing how much storage video is using.
- Test: set a review's `approved_at` back 31 days by hand, run the cron route
  with the secret, confirm the file is gone, the comments are not, and the
  page explains itself.

## Risks worth naming

- **Signed URL life vs video length.** 300s covers a short clip, not a long
  one. Decide whether to extend for video or refresh mid-playback.
- **iPhone uploads are `.mov` and huge.** The extension allows `mov`, but a
  master from a phone can be several GB. The 200MB warning matters.
- **One live review per task per kind** (`task_documents_one_live_per_task_kind`,
  `task-image-reviews.sql:34`) means one video review per task, same as
  images. Fine, but worth knowing before promising two.
- **No transcoding.** Whatever is uploaded is what the client downloads, so a
  master uploaded by accident is both a storage and a watching cost. That is
  what the warning is for.
