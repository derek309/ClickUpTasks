// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/core.mjs";
import { parseThreadInput, messageText, replySubject } from "../../mcp/inboxThread.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// get_email_thread and draft_email_reply (2026-10-09): a Claude chat handed an
// Inbox link reads the conversation and leaves a reply in Drafts. Supabase is
// faked; these check what is read, who may read it, and what is written.

let writes: { method: string; url: string; body: any }[] = [];
let reads: string[] = [];
function fake(answers: { table: string; rows: unknown }[]) {
  writes = []; reads = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method && init.method !== "GET") writes.push({ method: init.method, url: String(url), body: init.body ? JSON.parse(init.body) : null });
    else reads.push(String(url));
    const path = String(url).split("/rest/v1/")[1] ?? "";
    const hit = answers.find((a) => path.startsWith(a.table));
    return { ok: true, status: 200, text: async () => JSON.stringify(hit ? hit.rows : []) } as any;
  }));
}
async function connect(opts: Record<string, unknown> = {}) {
  const server = createServer({ url: "https://db.invalid", key: "test", memberId: "u_derek", ...opts });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const call = async (c: Client, name: string, args: Record<string, unknown>) => ((await c.callTool({ name, arguments: args })) as any).content[0].text as string;
afterEach(() => vi.unstubAllGlobals());

const gmRows = [
  { id: "m1", contact_id: "ct_1", client_id: "c_1", task_id: null, channel: "email", direction: "inbound", subject: "Website changes", created_at: "2026-10-01T10:00:00Z", created_by: null,
    gmail_thread_id: "18f2a", mailbox_member_id: "u_derek", peer_name: "Pam Macias", peer_address: "pam@example.com", cc: ["jo@example.com"], attachments: [{ name: "logo.png" }],
    body: "<p>Can you change the header?</p><p>Thanks &amp; regards</p>" },
  { id: "m2", contact_id: "ct_1", client_id: "c_1", task_id: "t_1", channel: "email", direction: "outbound", subject: "Re: Website changes", created_at: "2026-10-02T10:00:00Z", created_by: "u_derek",
    gmail_thread_id: "18f2a", mailbox_member_id: "u_derek", peer_name: "Pam Macias", peer_address: "pam@example.com", cc: [], attachments: [],
    body: "Sure, on it.\n\nOn Wed, 1 Oct 2026 at 10:00, Pam Macias <pam@example.com> wrote:\n> Can you change the header?" },
];
const task = { id: "t_1", title: "Pam header change", status: "in_progress", client_id: "c_1", deleted_at: null, is_private: false, assignee_id: "u_derek" };

describe("parseThreadInput", () => {
  it("reads the app's link, encoded or not, and a bare key", () => {
    expect(parseThreadInput("https://clickuptasks.vercel.app/?view=mail&thread=gm%3A18f2a")).toMatchObject({ kind: "gm", id: "18f2a", key: "gm:18f2a" });
    expect(parseThreadInput("https://x.app/?view=mail&thread=gm:18f2a&foo=1")?.key).toBe("gm:18f2a");
    expect(parseThreadInput("https://x.app/?view=mail&thread=ghl%253Aabc")?.key).toBe("ghl:abc");
    expect(parseThreadInput(" chat:t_9 ")?.key).toBe("chat:t_9");
    expect(parseThreadInput("msg:m1")).toBeNull();
    expect(parseThreadInput("https://x.app/?view=mail")).toBeNull();
  });
  it("text helpers", () => {
    expect(messageText("Hi\n\nOn Mon, 1 Sep 2026 at 14:32, D <d@x.com> wrote:\n> old")).toBe("Hi");
    expect(messageText("<p>A &amp; B</p><p>C</p>")).toBe("A & B\nC");
    expect(replySubject("Re: X")).toBe("Re: X");
    expect(replySubject("X")).toBe("Re: X");
  });
});

describe("get_email_thread", () => {
  it("returns subject, people, linked task and messages oldest first without quotes", async () => {
    fake([
      { table: "messages", rows: gmRows },
      { table: "inbox_task_links", rows: [] },
      { table: "profiles", rows: [{ member_id: "u_derek", name: "Derek Fox" }] },
      { table: "tasks", rows: [task] },
    ]);
    const text = await call(await connect(), "get_email_thread", { thread: "https://clickuptasks.vercel.app/?view=mail&thread=gm%3A18f2a" });
    expect(text).toContain("Subject: Website changes");
    expect(text).toContain("Pam Macias <pam@example.com>");
    expect(text).toContain("jo@example.com");
    expect(text).toContain("[t_1] Pam header change");
    expect(text).toContain("Attachments: logo.png");
    expect(text).toContain("Thanks & regards");
    expect(text.indexOf("change the header")).toBeLessThan(text.indexOf("Sure, on it."));
    expect(text).not.toContain("> Can you");
    expect(writes).toHaveLength(0);
  });
  it("reads only your own mailbox when you are not an admin", async () => {
    fake([{ table: "messages", rows: [] }]);
    const text = await call(await connect({ memberId: "u_va", role: "va", visibleClients: new Set(["c_1"]) }), "get_email_thread", { thread: "gm:18f2a" });
    expect(text).toContain("No conversation gm:18f2a");
    expect(reads.find((u) => u.includes("/messages?"))).toContain("mailbox_member_id=eq.u_va");
  });
  it("refuses a GoHighLevel conversation assigned to someone else", async () => {
    fake([
      { table: "messages", rows: [{ ...gmRows[0], gmail_thread_id: null, ghl_conversation_id: "cv1", channel: "sms" }] },
      { table: "ghl_conversations", rows: [{ id: "cv1", assigned_member_id: "u_other" }] },
    ]);
    const text = await call(await connect({ memberId: "u_va", role: "va", visibleClients: new Set(["c_1"]) }), "get_email_thread", { thread: "ghl:cv1" });
    expect(text).toContain("No conversation ghl:cv1");
  });
  it("says so for something that is not a conversation", async () => {
    fake([]);
    expect(await call(await connect(), "get_email_thread", { thread: "hello" })).toContain("not an Inbox conversation");
  });
  it("reads a task's portal chat only when the task is visible", async () => {
    fake([{ table: "tasks", rows: [{ ...task, client_id: "c_9" }] }, { table: "messages", rows: [] }]);
    const text = await call(await connect({ memberId: "u_va", role: "va", visibleClients: new Set(["c_1"]) }), "get_email_thread", { thread: "chat:t_1" });
    expect(text).toContain("No conversation chat:t_1");
  });
});

describe("draft_email_reply", () => {
  it("puts a Re: reply in the mailbox owner's Drafts with the thread key, and sends nothing", async () => {
    fake([
      { table: "messages", rows: gmRows },
      { table: "profiles", rows: [{ member_id: "u_derek", name: "Derek Fox" }] },
      { table: "inbox_prefs", rows: [{ prefs: { queuedDrafts: [] } }] },
    ]);
    const text = await call(await connect({ memberId: "u_claude" }), "draft_email_reply", { thread: "gm:18f2a", body: "Done, take a look." });
    expect(text).toContain("Nothing was sent");
    const w = writes.find((x) => x.url.includes("inbox_prefs"));
    expect(w?.url).toContain("member_id=eq.u_derek");
    expect(w?.body.prefs.queuedDrafts[0]).toMatchObject({ kind: "email", to: "pam@example.com", contactId: "ct_1", subject: "Re: Website changes", body: "Done, take a look.", by: "Claude", threadKey: "gm:18f2a", replyToMessageId: "m1" });
    expect(writes.every((x) => !x.url.includes("send"))).toBe(true);
  });
  it("answers a GoHighLevel text conversation with a text", async () => {
    fake([
      { table: "messages", rows: [{ ...gmRows[0], gmail_thread_id: null, ghl_conversation_id: "cv1", channel: "sms", subject: null, peer_address: "+15555550100" }] },
      { table: "ghl_conversations", rows: [{ id: "cv1", assigned_member_id: null }] },
      { table: "profiles", rows: [{ member_id: "u_derek", name: "Derek Fox" }] },
      { table: "inbox_prefs", rows: [] },
    ]);
    await call(await connect(), "draft_email_reply", { thread: "ghl:cv1", body: "Yes" });
    const w = writes.find((x) => x.url.includes("inbox_prefs"));
    expect(w?.method).toBe("POST");
    expect(w?.body.prefs.queuedDrafts[0]).toMatchObject({ kind: "text", to: "+15555550100", threadKey: "ghl:cv1" });
    expect(w?.body.prefs.queuedDrafts[0].subject).toBeUndefined();
  });
});
