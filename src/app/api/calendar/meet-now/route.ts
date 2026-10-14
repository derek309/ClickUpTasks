import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser, canCallerMessageClient } from "@/lib/serverAuth";
import { teamTaskAccess } from "@/lib/taskDocumentServer";
import { resolveContact } from "@/lib/sendMessageServer";
import { upsertConversationTask } from "@/lib/ghlConversationTask";
import { calendarConfigured, createGoogleMeeting } from "@/lib/googleCalendar";
import { stepsOnMeetNow } from "@/lib/stepsServer";
import { cleanMeetingLink, liveMeeting, meetNowTimes, type MeetNowMeeting } from "@/lib/meetNow";
import { clientFirstName } from "@/lib/clientFirstName";
import { isReplyTask, titleCase, type Subtask } from "@/lib/data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// POST { clientId, taskId?, stepId?, link? }: Meet now (Derek, 2026-10-14:
// "when a client says let's meet, start a meeting right away and send them the
// link"). Makes the meeting, starting now for 30 minutes, then puts "Meet with
// <first>" (current, holding the link) and "Add the meeting transcript" on
// the task, as a booked meeting has them. On Google, the client is a guest
// and Google emails them the calendar invite with the link (Derek,
// 2026-10-14); the sheet then only offers to text the link too. Otherwise
// nothing is sent here: the sheet offers the link by email or text, with Send.
//
// The meeting: a Google Calendar event on your own calendar with a Google
// Meet link and the client as a guest, when Google lets us (the calendar.events
// scope in Google Admin). Otherwise your own meeting link from Settings (Zoom
// personal room or Meet), on a calendar event when Google lets us make one.
// With neither, { needLink: true } and the sheet asks for your link once.
//
// From the client page (no taskId) it goes on their open Conversation task,
// renamed "Meeting with <Name>" as a booking does, or a new one in their
// Tasks list. A meeting started in the last half hour that is still open is
// given back instead of a second one.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const b = (await req.json().catch(() => ({}))) as { clientId?: string; taskId?: string; stepId?: string; link?: string };
  const clientId = typeof b.clientId === "string" ? b.clientId : "";
  const taskIdIn = typeof b.taskId === "string" && b.taskId ? b.taskId : null;
  if (!clientId) return NextResponse.json({ error: "Which client?" }, { status: 400 });

  let caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (taskIdIn) {
    const access = await teamTaskAccess(req, taskIdIn);
    if (!access.ok) return access.res;
    caller = access.user;
  }
  const blocked = await canCallerMessageClient(caller, clientId);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

  const contact = await resolveContact(clientId);
  if (!contact) return NextResponse.json({ error: "This client isn't linked to a contact yet, so there is nobody to send the link to." }, { status: 400 });
  const [{ data: contactRow }, { data: client }, { data: me }] = await Promise.all([
    supabaseAdmin.from("contacts").select("name, company").eq("id", contact.id).maybeSingle(),
    supabaseAdmin.from("clients").select("name").eq("id", clientId).maybeSingle(),
    supabaseAdmin.from("profiles").select("email, name").eq("id", caller.id).maybeSingle(),
  ]);
  const clientName = String((client as any)?.name ?? "");
  const first = clientFirstName(contactRow as any, clientName, "them");
  const fullName = titleCase(String((contactRow as any)?.name ?? "").trim() || clientName || "Client");

  // The task it goes on: the one given, else the client's open Conversation task.
  let taskId = taskIdIn;
  type TaskRow = { id: string; title: string; priority: string | null; client_id: string; subtasks: Subtask[] | null };
  let task: TaskRow | null = null;
  if (taskId) {
    const { data } = await supabaseAdmin.from("tasks").select("id, title, priority, client_id, subtasks").eq("id", taskId).maybeSingle();
    task = data as TaskRow | null;
    if (!task || task.client_id !== clientId) return NextResponse.json({ error: "That task isn't this client's." }, { status: 400 });
  } else {
    const { data } = await supabaseAdmin.from("tasks").select("id, title, priority, client_id, subtasks")
      .eq("contact_id", contact.id).eq("priority", "conversation").neq("status", "done").limit(1);
    task = ((data ?? [])[0] as TaskRow | undefined) ?? null;
  }
  // Pressed twice: the meeting already going is the one to send.
  const going = liveMeeting(task?.subtasks, Date.now());
  if (task && going && Date.now() - Date.parse(going.start) < 30 * 60_000) {
    return NextResponse.json({ ok: true, url: going.url, via: going.via, calendar: false, again: true, taskId: task.id, first });
  }

  // The meeting itself.
  const myEmail = String((me as any)?.email ?? caller.email ?? "").trim().toLowerCase();
  const myFirst = String((me as any)?.name ?? "").trim().split(" ")[0];
  const { start, end } = meetNowTimes(Date.now());
  const title = `${fullName}${myFirst ? ` and ${myFirst}` : ""}`;
  const guest = contact.email ? { email: contact.email, name: fullName } : null;
  const onGoogle = calendarConfigured && myEmail.endsWith("@clickuplocal.com");
  let meeting: MeetNowMeeting | null = null;
  let calendar = false;
  // Google emailed them its calendar invite: the address it went to.
  let invited: string | null = null;
  let googleRefused = !onGoogle;
  if (onGoogle) {
    const g = await createGoogleMeeting(myEmail, { title, start, end, guest, link: null });
    if (g.ok) { meeting = { url: g.url, start, end, via: "meet" }; calendar = true; invited = g.invited; }
    else { googleRefused = g.refused; if (!g.refused) console.error("[meet-now] Google Meet failed", g.error); }
  }
  if (!meeting) {
    let saved: string | null = null;
    if (!b.link && caller.memberId) {
      const { data: prefs } = await supabaseAdmin.from("inbox_prefs").select("prefs").eq("member_id", caller.memberId).maybeSingle();
      saved = ((prefs as any)?.prefs?.meetingLink as string | undefined) ?? null;
    }
    const link = cleanMeetingLink(b.link ?? saved);
    if (b.link && !link) return NextResponse.json({ error: "That isn't a link. Paste the whole address, like https://zoom.us/j/1234567890." }, { status: 400 });
    if (!link) return NextResponse.json({ needLink: true, google: !googleRefused });
    meeting = { url: link, start, end, via: "link" };
    // On your calendar too, with your link, when Google lets us.
    if (onGoogle && !googleRefused) {
      const g = await createGoogleMeeting(myEmail, { title, start, end, guest, link });
      calendar = g.ok;
      if (g.ok) invited = g.invited;
    }
  }

  let renamed: string | null = null;
  // The task: a Reply task becomes the meeting's, as a booking renames it, so
  // sending the link doesn't close it as answered; none open, a new one.
  if (!task) {
    if (!contact.ghlContactId) return NextResponse.json({ error: "This client isn't linked to GoHighLevel yet." }, { status: 400 });
    taskId = await upsertConversationTask({ id: contact.id, name: fullName, client_id: clientId }, contact.ghlContactId, { title: `Meeting with ${fullName}` });
    if (!taskId) return NextResponse.json({ error: "The meeting is on, but its task couldn't be made.", url: meeting.url, via: meeting.via, calendar, invited }, { status: 500 });
  } else if (isReplyTask(task)) {
    renamed = `Meeting with ${fullName}`;
    await supabaseAdmin.from("tasks").update({ title: renamed, updated_by: null }).eq("id", task.id);
  }

  // The link as a link on the task, held by the meeting's step.
  const att = { id: "a_" + randomUUID().replace(/-/g, "").slice(0, 12), name: "Meeting link", kind: "link", size: "", url: meeting.url };
  const { error: attErr } = await supabaseAdmin.rpc("append_task_attachments", { task_id: taskId, items: [att] });
  if (attErr) console.error("[meet-now] link attach failed", attErr);
  const stepId = await stepsOnMeetNow(taskId!, { first, attachmentId: att.id, meeting, fromStepId: typeof b.stepId === "string" ? b.stepId : null });
  return NextResponse.json({ ok: true, url: meeting.url, via: meeting.via, calendar, invited, taskId, stepId, first, ...(renamed ? { title: renamed } : {}) });
}
