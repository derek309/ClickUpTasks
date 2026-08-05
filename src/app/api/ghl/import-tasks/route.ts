import { NextRequest, NextResponse } from "next/server";
import { tokenForLocation } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";
import { isGhlContactVisible } from "@/lib/extensionApi";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Read-only fetch of a contact's native GoHighLevel tasks (created directly
// in GHL, not pushed from here) — the "pull" counterpart to
// ../task/route.ts's push. The caller (Cockpit.tsx importGhlTasks) creates
// the local rows itself, deduped against ghlTaskId, so a task already linked
// stays linked rather than being duplicated on a second import.

const GHL = "https://services.leadconnectorhq.com";

// Cheap tag strip — GHL task bodies are simple HTML (<p>, <a>, the odd
// inline style), not full documents; a real parser would be overkill here.
function stripHtml(html: string): string {
  return html
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get("locationId");
  const ghlContactId = searchParams.get("ghlContactId");
  if (!locationId || !ghlContactId) return NextResponse.json({ error: "Missing locationId or ghlContactId." }, { status: 400 });

  // Both ids are caller-supplied, so requireUser alone let any signed-in VA
  // read the full task list (titles + bodies) off any sub-account's contact.
  // Same gate as ../task/route.ts; admins pass through unrestricted.
  if (!(await isGhlContactVisible(caller, ghlContactId)))
    return NextResponse.json({ error: "Unknown or inaccessible contact." }, { status: 403 });

  const token = await tokenForLocation(locationId);
  if (!token) return NextResponse.json({ error: "No GoHighLevel token configured for this sub-account yet." }, { status: 501 });

  try {
    const res = await fetch(`${GHL}/contacts/${ghlContactId}/tasks`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `GoHighLevel API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 });
    }
    const json = await res.json().catch(() => ({}));
    const tasks = ((json?.tasks ?? []) as any[]).map((t) => ({
      ghlTaskId: t.id as string,
      title: (t.title || "Untitled task").slice(0, 200),
      description: stripHtml(t.body || ""),
      due: typeof t.dueDate === "string" ? t.dueDate.slice(0, 10) : null,
      completed: !!t.completed,
    }));
    return NextResponse.json({ tasks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "GoHighLevel request failed." }, { status: 502 });
  }
}
