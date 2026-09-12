import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { TASK_FILES_BUCKET } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";
import { resolveWaitingToken } from "@/lib/waitingToken";
import { UPLOAD_OBJECT_NAME, checkFileName, checkFileSize, checkStoredFile } from "@/lib/taskDocumentFiles";
import { extOf, storageSafeName } from "@/lib/uploadTypes";

// Public, token-gated file upload for /waiting/[token]: a reply's attachments, or
// a new request's. Two calls per file, the same as the client review document's
// files (taskDocumentFiles.ts): "start" checks the name and size and returns a one
// time upload link, the browser sends the file straight to storage, and "confirm"
// checks what actually landed (real size, and no type a browser would run).
//
// Files used to be posted through this route, and a Vercel request body stops
// near 4.5MB, so anything bigger failed while the page promised 25MB and said
// nothing (Derek, 2026-09-11). The allowlist is shared (uploadTypes.ts) and
// excludes anything that executes when a signed URL is opened directly.

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return fail(501, "Not configured");
  const { token } = await params;
  if (!token || token.length < 16) return fail(404, "Not found");
  const limited = await rateLimit(req, token, "upload");
  if (limited) return limited;

  const scope = await resolveWaitingToken(token);
  if (!scope) return fail(404, "Not found");

  const b = (await req.json().catch(() => null)) as { action?: unknown; name?: unknown; size?: unknown; path?: unknown; task_id?: unknown } | null;
  if (!b) return fail(400, "Invalid request.");
  // Omitted when attaching to a brand new request (see ../request/route.ts), which has no task yet.
  const taskId = typeof b.task_id === "string" && b.task_id ? b.task_id : null;

  // Confirm the task belongs to this token's own client (and project, if scoped)
  // before handing out an upload link, the same boundary the respond route enforces.
  if (taskId) {
    const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id, project_id").eq("id", taskId).eq("is_private", false).is("deleted_at", null).maybeSingle();
    if (!task || task.client_id !== scope.clientId || (scope.projectId && task.project_id !== scope.projectId)) return fail(404, "Not found");
  } else if (scope.projectId) {
    // A new request is never available on a project-scoped token (see
    // ../request/route.ts's own refusal), so there's no reason to be here without a task.
    return fail(404, "Not found");
  }

  const folder = `waiting/${scope.clientId}/${taskId ?? "new"}/`;
  const named = checkFileName(b.name);
  if (!named.ok) return fail(named.status, named.error);

  if (b.action === "start") {
    const sized = checkFileSize(b.size);
    if (sized) return fail(sized.status, sized.error);
    const path = `${folder}${randomUUID()}-${storageSafeName(named.name)}`;
    const { data, error } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return fail(500, "Could not start the upload. Please try again.");
    return NextResponse.json({ path, uploadUrl: data.signedUrl });
  }

  if (b.action === "confirm") {
    const path = b.path;
    if (typeof path !== "string" || !path.startsWith(folder) || !UPLOAD_OBJECT_NAME.test(path.slice(folder.length)) || extOf(path) !== extOf(named.name)) {
      return fail(400, "Invalid file.");
    }
    const stored = await checkStoredFile(path);
    if (!stored.ok) return fail(stored.status, stored.error);
    return NextResponse.json({ path, size: stored.size });
  }

  return fail(400, "Invalid request.");
}
