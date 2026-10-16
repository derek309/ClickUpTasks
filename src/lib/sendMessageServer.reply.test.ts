import { describe, it, expect, vi, beforeEach } from "vitest";

// A reply goes to whoever wrote the email it answers, not the client's main
// contact: on Matthew Whitman's task, answering Russell's email went to
// Matthew (Justin, 2026-10-07). Supabase and Gmail are stubs; the routing in
// sendMessageServer.ts is real.
const rows: Record<string, Record<string, unknown>> = {
  "clients:cl_matt": { linked_contact_id: null, ghl_location_id: "loc_1" },
  "contacts:matt": { id: "matt", email: "matthew@whitman.com", phone: null, ghl_contact_id: "g_matt", client_id: "c_agency" },
  "clients:c_agency": { ghl_location_id: "loc_1" },
  "profiles:u_justin": { email: "justin@clickuplocal.com", name: "Justin", email_signature: "" },
  "messages:m_russell": { client_id: "cl_matt", channel: "email", peer_address: "Russell@Whitman.com", peer_name: "Russell Lathrop", gmail_message_id: null, rfc822_message_id: null },
  "messages:m_other_client": { client_id: "cl_someone_else", channel: "email", peer_address: "stranger@example.com", peer_name: "Stranger" },
  "messages:m_ours": { client_id: "cl_matt", channel: "email", peer_address: "derek@clickuplocal.com", peer_name: "Derek" },
  // Someone who is not a contact: no client, only the task it is on (Chelsea
  // Proctor on Brian Goodell's task, 2026-10-16).
  "messages:m_chelsea": { client_id: null, task_id: "t_1", channel: "email", peer_address: "cproctor@usatventures.com", peer_name: "Proctor, Chelsea", gmail_message_id: null, rfc822_message_id: null },
  "tasks:t_1": { client_id: "cl_matt" },
  "messages:m_stray": { client_id: null, task_id: "t_other", channel: "email", peer_address: "someone@elsewhere.com", peer_name: "Someone" },
  "tasks:t_other": { client_id: "cl_someone_else" },
  "messages:m_loose": { client_id: null, task_id: null, channel: "email", peer_address: "loose@elsewhere.com", peer_name: "Loose" },
};
const inserts: Record<string, unknown>[] = [];
function query(table: string) {
  let key = "";
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (col: string, v: string) => { key = `${table}:${v}`; void col; return q; };
  q.maybeSingle = async () => ({ data: rows[key] ?? null, error: null });
  q.insert = async (payload: Record<string, unknown>) => { inserts.push(payload); return { error: null }; };
  return q;
}
vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: { from: (t: string) => query(t) } }));
const sent: { to: string }[] = [];
vi.mock("./googleMail", () => ({
  googleConfigured: true,
  sendGmailAs: async (_from: string, m: { to: string }) => { sent.push(m); return { id: "gm_1", threadId: "th_1" }; },
  readReplyHeaders: async () => null,
}));
vi.mock("./ghlTokens", () => ({ tokenForLocation: async () => null }));
vi.mock("./ghlReply", () => ({ ghlReplyFields: async () => ({}) }));
vi.mock("./ghlConversationTask", () => ({ closeAnsweredReplyTask: async () => {} }));

import { replyRecipientFor, sendScheduledMessageNow } from "./sendMessageServer";

const send = (replyToMessageId: string | null, fromEmail = "justin@clickuplocal.com") => sendScheduledMessageNow({
  id: "s_1", clientId: "cl_matt", taskId: "t_1", channel: "email", subject: "Re: Website contact", body: "<p>Hi</p>",
  cc: [], bcc: [], attachments: [], createdBy: "u_justin", replyToMessageId, fromEmail,
});

beforeEach(() => { sent.length = 0; inserts.length = 0; });

describe("who a reply goes to", () => {
  it("is the person who wrote the email being answered", async () => {
    expect(await replyRecipientFor("cl_matt", "m_russell")).toEqual({ email: "russell@whitman.com", name: "Russell Lathrop" });
  });

  it("is nobody special for another client's email, our own address, or no reply", async () => {
    expect(await replyRecipientFor("cl_matt", "m_other_client")).toBeNull();
    expect(await replyRecipientFor("cl_matt", "m_ours")).toBeNull();
    expect(await replyRecipientFor("cl_matt", null)).toBeNull();
  });

  it("sends the reply to Russell and records it went to him", async () => {
    const r = await send("m_russell");
    expect(r.ok).toBe(true);
    expect(sent.map((m) => m.to)).toEqual(["russell@whitman.com"]);
    expect(inserts[0]?.peer_address).toBe("russell@whitman.com");
  });

  it("still sends a new email to the client's main contact", async () => {
    await send(null);
    expect(sent.map((m) => m.to)).toEqual(["matthew@whitman.com"]);
    expect(inserts[0]?.peer_address).toBe("matthew@whitman.com");
  });

  it("is the writer of an email on this client's task, though they are not a contact", async () => {
    expect(await replyRecipientFor("cl_matt", "m_chelsea")).toEqual({ email: "cproctor@usatventures.com", name: "Chelsea Proctor" });
    const r = await send("m_chelsea");
    expect(r.ok).toBe(true);
    expect(sent.map((m) => m.to)).toEqual(["cproctor@usatventures.com"]);
  });

  it("is nobody special for an email with no client on another client's task, or on no task", async () => {
    expect(await replyRecipientFor("cl_matt", "m_stray")).toBeNull();
    expect(await replyRecipientFor("cl_matt", "m_loose")).toBeNull();
  });

  it("never lets a reply to Russell fall back to Matthew through GoHighLevel", async () => {
    const r = await send("m_russell", "someone@gmail.com");
    expect(sent).toEqual([]);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("russell@whitman.com");
  });
});
