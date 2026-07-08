import { NextRequest, NextResponse } from "next/server";
import { tokenForLocation } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Push a ClickUpTasks task INTO GoHighLevel as a native task on the contact,
// and keep it in sync. One route, four ops:
//   create   → POST   /contacts/{contactId}/tasks         → returns new ghlTaskId
//   update   → PUT    /contacts/{contactId}/tasks/{taskId} → title/body/due/completed
//   complete → PUT    ... (same as update, just completed=true)
//   delete   → DELETE /contacts/{contactId}/tasks/{taskId}
// The GHL Private Integration token stays server-side (resolved per location).

const GHL = "https://services.leadconnectorhq.com";

// GHL wants an ISO-8601 datetime for dueDate; our tasks carry a yyyy-mm-dd.
// 17:00 UTC = 9/10am Pacific, so tasks land on the right day at a sane hour.
function toGhlDate(due: string | null | undefined): string {
  const day = due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : new Date().toISOString().slice(0, 10);
  return `${day}T17:00:00.000Z`;
}

export async function POST(req: NextRequest) {
  if (!(await requireUser(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const { op, locationId, ghlContactId, ghlTaskId, title, body, due, completed } = b as {
    op: "create" | "update" | "complete" | "delete";
    locationId?: string;
    ghlContactId?: string;
    ghlTaskId?: string;
    title?: string;
    body?: string;
    due?: string | null;
    completed?: boolean;
  };

  if (!op || !locationId || !ghlContactId)
    return NextResponse.json({ error: "Missing op, locationId, or ghlContactId." }, { status: 400 });

  const token = await tokenForLocation(locationId);
  if (!token)
    return NextResponse.json({ error: "No GoHighLevel token configured for this sub-account yet." }, { status: 501 });

  const headers = {
    Authorization: `Bearer ${token}`,
    Version: "2021-07-28",
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  try {
    if (op === "delete") {
      if (!ghlTaskId) return NextResponse.json({ error: "Missing ghlTaskId." }, { status: 400 });
      const res = await fetch(`${GHL}/contacts/${ghlContactId}/tasks/${ghlTaskId}`, { method: "DELETE", headers });
      if (!res.ok && res.status !== 404) return await ghlError(res);
      return NextResponse.json({ ok: true });
    }

    const payload = {
      title: (title || "Untitled task").slice(0, 200),
      body: body || "Created from ClickUpTasks",
      dueDate: toGhlDate(due),
      completed: op === "complete" ? true : !!completed,
    };

    if (op === "create") {
      const res = await fetch(`${GHL}/contacts/${ghlContactId}/tasks`, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!res.ok) return await ghlError(res);
      const json = await res.json().catch(() => ({}));
      const id = json?.task?.id ?? json?.id ?? null;
      if (!id) return NextResponse.json({ error: "GoHighLevel accepted the task but returned no id." }, { status: 502 });
      return NextResponse.json({ ghlTaskId: id });
    }

    // update / complete
    if (!ghlTaskId) return NextResponse.json({ error: "Missing ghlTaskId." }, { status: 400 });
    const res = await fetch(`${GHL}/contacts/${ghlContactId}/tasks/${ghlTaskId}`, { method: "PUT", headers, body: JSON.stringify(payload) });
    if (!res.ok) return await ghlError(res);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "GoHighLevel request failed." }, { status: 502 });
  }
}

async function ghlError(res: Response) {
  const text = await res.text().catch(() => "");
  return NextResponse.json({ error: `GoHighLevel API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 });
}
