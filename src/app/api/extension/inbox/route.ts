import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { inboxKind, latestCommentBy } from "@/lib/extensionInbox";

// The Inboxes Mac app's ClickUpTasks inbox: the caller's own unread mentions,
// comments on their tasks, and client portal chat messages, newest first, each
// with enough to show a row (task, client, who, and the words themselves).
// notifications rows are addressed to one recipient, so filtering on the
// caller's member id is the whole visibility check. See extensionInbox.ts for
// why inbound email and SMS notifications are left out.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!caller.memberId) return NextResponse.json({ error: "This token's account has no roster member id." }, { status: 403 });

  const { data: rows, error } = await supabaseAdmin
    .from("notifications")
    .select("id, text, task_id, client_id, project_id, actor_id, at, created_at")
    .eq("recipient_id", caller.memberId).eq("read", false).eq("kind", "message")
    .order("created_at", { ascending: false }).limit(150);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const wanted = (rows ?? [])
    .map((n) => ({ n, kind: inboxKind(n) }))
    .filter((x): x is { n: typeof x.n; kind: NonNullable<typeof x.kind> } => x.kind !== null)
    .slice(0, 50);
  const unique = (values: (string | null)[]) => Array.from(new Set(values.filter((v): v is string => !!v)));
  const taskIds = unique(wanted.map((x) => x.n.task_id));
  const clientIds = unique(wanted.map((x) => x.n.client_id));
  const actorIds = unique(wanted.map((x) => x.n.actor_id));
  const chatTaskIds = unique(wanted.filter((x) => x.kind === "client_chat").map((x) => x.n.task_id));

  const { data: tasks } = taskIds.length ? await supabaseAdmin.from("tasks").select("id, title, comments").in("id", taskIds) : { data: [] };
  const { data: clients } = clientIds.length ? await supabaseAdmin.from("clients").select("id, name").in("id", clientIds) : { data: [] };
  const { data: actors } = actorIds.length ? await supabaseAdmin.from("profiles").select("member_id, name").in("member_id", actorIds) : { data: [] };
  const { data: chats } = chatTaskIds.length
    ? await supabaseAdmin.from("messages").select("task_id, body, created_at").in("task_id", chatTaskIds)
        .eq("channel", "chat").eq("direction", "inbound").order("created_at", { ascending: false }).limit(200)
    : { data: [] };

  const taskById = new Map((tasks ?? []).map((t: { id: string; title: string; comments: unknown }) => [t.id, t]));
  const clientName = new Map((clients ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
  const actorName = new Map((actors ?? []).map((a: { member_id: string; name: string }) => [a.member_id, a.name]));
  // Newest first, so the first body seen for a task is its latest client message.
  const latestChat = new Map<string, string>();
  for (const m of (chats ?? []) as { task_id: string; body: string }[]) {
    if (!latestChat.has(m.task_id) && m.body?.trim()) latestChat.set(m.task_id, m.body.trim());
  }

  return NextResponse.json({
    items: wanted.map(({ n, kind }) => {
      const task = n.task_id ? taskById.get(n.task_id) : undefined;
      const excerpt = kind === "client_chat"
        ? (n.task_id ? latestChat.get(n.task_id) ?? null : null)
        : latestCommentBy(task?.comments, n.actor_id);
      return {
        id: n.id, kind, text: n.text, taskId: n.task_id, clientId: n.client_id, projectId: n.project_id,
        at: n.at ?? n.created_at, taskTitle: task?.title ?? null,
        clientName: n.client_id ? clientName.get(n.client_id) ?? null : null,
        actorName: n.actor_id ? actorName.get(n.actor_id) ?? null : null,
        excerpt: excerpt ? excerpt.slice(0, 1000) : null,
      };
    }),
  });
}
