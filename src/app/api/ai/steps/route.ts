import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { aiRateLimit } from "@/lib/ai";
import { isClientVisible } from "@/lib/extensionApi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { clientFirstName } from "@/lib/clientFirstName";
import { htmlToText, looksLikeHtml, planSteps, PERSONAL_CLIENT_ID, todayPacific, type Subtask } from "@/lib/data";
import { emailWorthReading } from "@/lib/aiSteps";
import { aiStepsOn, readClientEmail, stepLines, suggestNext, writeClientAsk, type Choice } from "@/lib/aiStepsServer";

/* eslint-disable @typescript-eslint/no-explicit-any */

// AI in steps (Derek, 2026-10-17, ai-help-mockup.html). One route, three asks:
//   email  Claude reads the client's email on a step into a suggested step
//          (or a split into tasks).
//   next   What's next after a Done, filled in.
//   ask    "What we need from <client>" and the email asking for it.
// It reads the task itself, on the server, after checking the caller may see
// its client: nothing the browser sends goes into a prompt but the team's
// names for whose turn. It only RETURNS a suggestion; the app keeps it on
// the step and nothing is saved, given or sent until someone presses a button.

const plain = (s: string | null | undefined) => (looksLikeHtml(s ?? "") ? htmlToText(s ?? "") : (s ?? "")).trim();

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!aiStepsOn()) return NextResponse.json({ off: true });
  const b = await req.json().catch(() => ({}));
  const kind = b.kind === "email" || b.kind === "next" || b.kind === "ask" ? b.kind : null;
  const taskId = typeof b.taskId === "string" ? b.taskId : "";
  const stepId = typeof b.stepId === "string" ? b.stepId : "";
  if (!kind || !taskId || !stepId) return NextResponse.json({ error: "Missing kind, taskId or stepId." }, { status: 400 });
  const choices: Choice[] = (Array.isArray(b.choices) ? b.choices : []).slice(0, 15)
    .filter((c: any) => c && typeof c.key === "string" && typeof c.label === "string")
    .map((c: any) => ({ key: c.key.slice(0, 40), label: c.label.replace(/[\n<>]/g, " ").slice(0, 40) }));

  const { data: t } = await supabaseAdmin.from("tasks").select("id, title, client_id, contact_id, assignee_id, subtasks").eq("id", taskId).maybeSingle();
  const task = t as { id: string; title: string; client_id: string; contact_id: string | null; assignee_id: string | null; subtasks: Subtask[] | null } | null;
  if (!task || task.client_id === PERSONAL_CLIENT_ID) return NextResponse.json({ error: "No such task." }, { status: 404 });
  if (!(await isClientVisible(caller, task.client_id))) return NextResponse.json({ error: "Unknown or inaccessible task." }, { status: 403 });
  const steps = planSteps(task.subtasks ?? []);
  const step = (task.subtasks ?? []).find((x) => x.id === stepId);
  if (!step) return NextResponse.json({ error: "No such step." }, { status: 404 });

  const limited = await aiRateLimit(caller.id);
  if (limited) return limited;

  const [{ data: client }, { data: contact }, { data: me }] = await Promise.all([
    supabaseAdmin.from("clients").select("name").eq("id", task.client_id).maybeSingle(),
    task.contact_id ? supabaseAdmin.from("contacts").select("name, company").eq("id", task.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    supabaseAdmin.from("profiles").select("name").eq("id", caller.id).maybeSingle(),
  ]);
  const clientName = (client?.name as string | null) ?? "the client";
  const first = clientFirstName(contact as any, clientName, "the client");
  const label = new Map(choices.map((c) => [c.key, c.label]));
  const nameOf = (id: string | null | undefined) => (id ? label.get(id) ?? "a teammate" : label.get(task.assignee_id ?? "") ?? "the owner");
  const today = todayPacific();
  const current = steps.find((x) => !x.done)?.id ?? null;
  const stepText = stepLines(steps, nameOf, current);

  if (kind === "email") {
    const messageId = typeof b.messageId === "string" ? b.messageId : "";
    const email = step.fromEmails?.find((e) => e.messageId === messageId);
    if (!email) return NextResponse.json({ error: "No such email on the step." }, { status: 404 });
    if (!emailWorthReading(email)) return NextResponse.json({ suggest: { messageId, at: new Date().toISOString(), asks: false, name: "", description: "", items: [], who: null, due: null, why: "", ownWork: false, list: "" } });
    const [{ data: lists }, { data: others }] = await Promise.all([
      supabaseAdmin.from("projects").select("name").eq("client_id", task.client_id).is("deleted_at", null).limit(30),
      supabaseAdmin.from("tasks").select("subtasks").eq("client_id", task.client_id).is("deleted_at", null).order("updated_at", { ascending: false }).limit(40),
    ]);
    // Who did what lately on this client: the signal for whose turn it is.
    const did = new Map<string, string[]>();
    for (const row of (others ?? []) as { subtasks: Subtask[] | null }[]) for (const s of row.subtasks ?? []) {
      if (!s.done || !s.assigneeId || !label.has(s.assigneeId)) continue;
      const l = did.get(s.assigneeId) ?? [];
      if (l.length < 4 && !l.includes(s.title)) l.push(s.title.slice(0, 60));
      did.set(s.assigneeId, l);
    }
    const whoDid = [...did].map(([id, l]) => `${label.get(id)}: ${l.join("; ")}`).join("\n");
    const ownerKey = choices.find((c) => c.key === (caller.memberId ?? task.assignee_id))?.key ?? choices[0]?.key ?? "me";
    const r = await readClientEmail({ email, task: task.title, client: clientName, today, choices, ownerKey, lists: (lists ?? []).map((p: any) => p.name as string).filter((n) => !/^tasks$/i.test(n.trim())), steps: stepText, whoDid });
    if (!r.suggest) return NextResponse.json({ error: r.error ?? "Nothing came back." }, { status: 502 });
    return NextResponse.json({ suggest: r.suggest, usage: r.usage });
  }

  // The last few messages on the task, newest last.
  const { data: msgs } = await supabaseAdmin.from("messages").select("direction, channel, subject, body, created_at").eq("task_id", task.id).order("created_at", { ascending: false }).limit(5);
  const messages = ((msgs ?? []) as any[]).reverse().map((m) => `${m.direction === "inbound" ? first.toUpperCase() : "US"} (${m.channel}, ${String(m.created_at).slice(0, 10)}${m.subject ? `, "${m.subject}"` : ""}): ${plain(m.body).slice(0, 600)}`).join("\n\n");

  if (kind === "next") {
    const r = await suggestNext({ task: task.title, client: `${clientName} (${first})`, today, done: step.title, steps: stepText, messages, choices });
    if (!r.next) return NextResponse.json({ error: r.error ?? "Nothing came back." }, { status: 502 });
    return NextResponse.json({ next: r.next, usage: r.usage });
  }

  const meFirst = ((me?.name as string | null) ?? "").trim().split(/\s+/)[0] || null;
  const r = await writeClientAsk({ task: task.title, step: step.title, first, me: meFirst, today, due: step.due ?? null, notes: plain(step.notes).slice(0, 600), steps: stepText, messages });
  if (!r.ask) return NextResponse.json({ error: r.error ?? "Nothing came back." }, { status: 502 });
  return NextResponse.json({ ask: r.ask, usage: r.usage });
}
