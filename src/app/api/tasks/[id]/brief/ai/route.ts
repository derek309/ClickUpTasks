import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { aiRateLimit, GEMINI_URL, geminiHeaders } from "@/lib/ai";
import { htmlToText } from "@/lib/data";
import { sanitizeDocHtml } from "@/lib/docHtml";
import { NO_STORE, teamBriefAccess } from "@/lib/briefServer";
import { BRIEF_TEMPLATES, scrubContacts } from "@/lib/brief";

// Write it with AI: drafts a task's project instructions for an outside person
// (a Fiverr designer) from the task, its approved client document and the
// client's notes. Returns HTML for the teammate to read and edit; it saves
// nothing. The instructions leave the building, so the prompt forbids contact
// details and scrubContacts takes out any the model writes anyway.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamBriefAccess(req, id);
  if (!access.ok) return access.res;
  const limited = await aiRateLimit(access.user.id);
  if (limited) return limited;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "AI drafting isn't configured yet (missing GEMINI_API_KEY)." }, 501);

  const payload = await req.json().catch(() => ({})) as { template?: unknown; prompt?: unknown };
  const template = BRIEF_TEMPLATES.find((t) => t.id === payload.template) ?? BRIEF_TEMPLATES[0];
  const instruction = typeof payload.prompt === "string" ? payload.prompt.trim().slice(0, 1000) : "";

  const task = access.task;
  const [{ data: taskRow }, { data: client }, { data: doc }, { data: notes }] = await Promise.all([
    supabaseAdmin.from("tasks").select("description").eq("id", task.id).maybeSingle(),
    supabaseAdmin.from("clients").select("name").eq("id", task.client_id).maybeSingle(),
    supabaseAdmin.from("task_documents").select("id, body, approved_version").eq("task_id", task.id).eq("kind", "doc").is("deleted_at", null).maybeSingle(),
    supabaseAdmin.from("client_notes").select("type, body, project_id").eq("client_id", task.client_id)
      .neq("type", "ai_summary").order("created_at", { ascending: false }).limit(20),
  ]);
  // The client document the client approved, else the last one sent, else the draft.
  let docText = "";
  if (doc) {
    const { data: v } = await supabaseAdmin.from("task_document_versions").select("body, version").eq("document_id", doc.id as string)
      .order("version", { ascending: false }).limit(10);
    const approved = (v ?? []).find((x) => x.version === doc.approved_version);
    docText = htmlToText((approved?.body ?? v?.[0]?.body ?? doc.body ?? "") as string).trim();
  }
  const noteLines = (notes ?? []).filter((n) => !n.project_id || n.project_id === task.project_id).slice(0, 8)
    .map((n) => `- ${clip(String(n.body ?? "").replace(/\s+/g, " "), 300)}`).join("\n") || "(none)";
  const description = htmlToText((taskRow?.description as string | null) ?? "").trim();
  const headings = [...template.html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);

  const prompt = [
    "You write project instructions for an outside freelancer (for example a designer hired on Fiverr) on behalf of a small marketing agency.",
    "The freelancer has never met the client. Write only what they need to do the job well: what to make, sizes and formats, what must be on it, the look and feel, and what to send back.",
    "NEVER include any phone number, email address, street address of a person, the client's contact name, prices the agency charges, or anything about other work. If the business's own shop address must be printed on the design, write it; otherwise leave addresses out.",
    "Never invent facts. Where something the freelancer needs is unknown, write a short line in square brackets saying what to fill in, like [size to confirm].",
    "Do not use any dash characters. Use commas or periods instead.",
    "Respond with HTML only, no markdown and no code fences, using only these tags: h2, p, ul, ol, li, strong, em.",
    headings.length ? `Use these h2 headings, in this order: ${headings.join(", ")}.` : "Choose clear h2 headings.",
    "",
    instruction ? `The teammate's instruction: "${instruction}"` : "",
    `Business: ${(client?.name as string | undefined) ?? "a client"}`,
    `Task: ${task.title}`,
    description ? `Task description:\n${clip(description, 4000)}` : "No task description.",
    docText ? `The client's approved content for this job (use its wording where it belongs on the design):\n${clip(docText, 6000)}` : "",
    "Internal notes about the client (background only, do not quote contact details):",
    noteLines,
  ].filter(Boolean).join("\n");

  try {
    const res = await fetch(GEMINI_URL, { method: "POST", headers: geminiHeaders(apiKey), body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    if (!res.ok) return json({ error: `The AI could not write it (${res.status}). Try again.` }, 502);
    const out = await res.json();
    const raw: string | undefined = out?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw?.trim()) return json({ error: "The AI returned nothing. Try again." }, 502);
    const html = sanitizeDocHtml(scrubContacts(raw.replace(/^```(?:html)?\s*|\s*```$/g, "")));
    if (!htmlToText(html).trim()) return json({ error: "The AI returned nothing usable. Try again." }, 502);
    return json({ html });
  } catch {
    return json({ error: "Could not reach the AI. Try again." }, 502);
  }
}
