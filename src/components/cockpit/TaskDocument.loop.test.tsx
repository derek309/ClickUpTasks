import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The document line must load once when a task opens, not over and over.
// Derek, 2026-09-11: an open task asked for its document link about three times
// a second and "keeps creating a new one". Rendered here inside a parent that
// takes onPresence the way TaskDrawer does (a new function every render, state
// set from it), with the server faked and every request counted.

const calls: string[] = [];
vi.mock("@/lib/supabase", () => ({
  authedFetch: async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ live: true, copyable: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
}));
const doc = { id: "tdoc_1", taskId: "t_1", title: "", body: "<p>Hi</p>", draftDirty: false, version: 1, status: "with_client", approvedAt: null, approvedVersion: null, updatedAt: "2026-09-11T19:00:00Z" };
vi.mock("@/lib/db", () => ({
  fetchTaskDocument: async () => ({ ...doc }),
  fetchTaskDocumentVersions: async () => [],
  fetchTaskDocumentFiles: async () => [],
  fetchTaskDocumentCheckpoints: async () => [],
  fetchTaskDocumentComments: async () => [],
  rowToTaskDocument: (r: any) => r,
  signedUrlForFile: async () => null,
}));
vi.mock("./RichTextEditor", () => ({ RichTextEditor: () => null }));

const { TaskDocument } = await import("./TaskDocument");
const { DraftEmail } = await import("./DraftEmail");

// The document and draft email lines side by side, keyed as in TaskDrawer.
function Drawer({ task, docKey, emailKey }: { task: any; docKey: string; emailKey: string }) {
  const [presence, setPresence] = useState({ taskId: task.id, exists: false });
  return (
    <div data-exists={String(presence.exists)}>
      {/* Siblings that come and go as the document loads, like the drawer's chips. */}
      <p key={presence.exists ? "loaded" : "loading"}>{presence.exists ? "Loaded" : "Loading"}</p>
      <TaskDocument key={docKey} task={task} onPatch={() => {}} pushToast={() => {}} canAdmin startNonce={0}
        onPresence={(exists) => setPresence((p) => (p.taskId === task.id && p.exists === exists ? p : { taskId: task.id, exists }))} />
      <DraftEmail key={emailKey} task={task} onPatch={() => {}} toEmail={null} openNonce={0} pushToast={() => {}} />
      {presence.exists ? null : <button>+ Client document</button>}
    </div>
  );
}

describe("TaskDocument", () => {
  it("loads the document once for an open task", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const task = { id: "t_1", title: "Task", status: "waiting", comments: [{ id: "c1" }], attachments: [], draftEmail: null };
    // TaskDrawer's keys. Both lines keyed task.id (as first shipped) fails this:
    // a keyed sibling changing pushes React into matching by key, the shared key
    // loses a fiber, and a new document line mounts on every render.
    await act(async () => { root.render(<Drawer task={task} docKey={`doc-${task.id}`} emailKey={`email-${task.id}`} />); });
    for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    const linkCalls = calls.filter((u) => u.endsWith("/link")).length;
    const rows = Array.from(host.querySelectorAll("button")).filter((b) => b.textContent === "Open").length;
    expect({ rows, linkCalls }).toEqual({ rows: 1, linkCalls: 1 });
    await act(async () => root.unmount());
  });
});
