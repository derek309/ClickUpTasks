// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// A text goes from one of our numbers in the contact's own sub account, with
// that account's token (Derek, 2026-10-15). GoHighLevel is never called: fetch
// is a fake that answers the numbers list and records the send.

vi.mock("@/lib/supabaseAdmin", async () => ({
  supabaseAdmin: (await import("@/test/fakeSupabase")).fakeSupabaseAdmin,
  adminConfigured: true,
}));
const admin = { id: "auth_derek", memberId: "u_derek", email: "d@example.com", role: "admin", canSendMessages: true };
let caller: typeof admin | null = admin;
vi.mock("@/lib/serverAuth", () => ({ requireUser: async () => caller }));
const TOKENS: Record<string, string> = { loc_agency: "tok_agency", loc_directory: "tok_directory" };
vi.mock("@/lib/ghlTokens", () => ({
  configuredLocations: async () => Object.keys(TOKENS),
  tokenForLocation: async (loc: string) => TOKENS[loc] ?? null,
}));

const { resetTables } = await import("@/test/fakeSupabase");
const { POST } = await import("./route");
const { GET } = await import("../numbers/route");
const { clearTextNumberCache } = await import("@/lib/ghlNumbers");

const NUMBERS: Record<string, unknown[]> = {
  loc_agency: [
    { phoneNumber: "+15305550101", friendlyName: null, isDefaultNumber: true, capabilities: { sms: true, voice: true } },
    { phoneNumber: "+15305550109", friendlyName: "Fax line", isDefaultNumber: false, capabilities: { sms: false, voice: false, fax: true } },
  ],
  loc_directory: [
    { phoneNumber: "+15303620990", friendlyName: "+15303620990", isDefaultNumber: true, capabilities: { sms: true } },
    { phoneNumber: "+15303620991", friendlyName: null, isDefaultNumber: false, capabilities: { sms: true }, linkedUser: "ghl_u_derek" },
  ],
};
const NAMES: Record<string, string> = { loc_agency: "ClickUpLocal", loc_directory: "ClickUpLocal Directory" };

let sent: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  caller = admin;
  sent = [];
  clearTextNumberCache();
  resetTables({
    contacts: [{ id: "ct_jeannie", ghl_contact_id: "ghl_jeannie", client_id: "c_directory" }],
    clients: [{ id: "c_directory", name: "Directory", ghl_location_id: "loc_directory" }, { id: "c_agency", name: "Agency", ghl_location_id: "loc_agency" }],
    profiles: [{ id: "auth_derek", name: "Derek Fox", ghl_user_id: "ghl_u_derek" }],
    messages: [
      { id: "m1", contact_id: "ct_jeannie", channel: "sms", direction: "outbound", created_at: "2026-10-14T19:12:03Z", our_number: "+15303620991" },
      { id: "m2", contact_id: "ct_jeannie", channel: "sms", direction: "inbound", created_at: "2026-10-15T21:41:08Z", our_number: null },
    ],
  });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    const loc = Object.keys(TOKENS).find((l) => auth === `Bearer ${TOKENS[l]}`);
    const m = url.match(/phone-system\/numbers\/location\/([^?]+)/);
    if (m) return Response.json({ numbers: m[1] === loc ? NUMBERS[m[1]] : [] });
    const l = url.match(/\/locations\/([^/?]+)$/);
    if (l) return Response.json({ location: { name: NAMES[l[1]] } });
    if (url.endsWith("/conversations/messages")) {
      sent.push({ url, auth, body: JSON.parse(String(init?.body)) });
      return Response.json({ messageId: "ghl_msg_1", conversationId: "conv_1" });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const sendText = (extra: Record<string, unknown> = {}) => POST(new NextRequest("http://localhost/api/ghl/message", {
  method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" },
  body: JSON.stringify({ clientId: "cl_jeannie", locationId: "loc_directory", ghlContactId: "ghl_jeannie", channel: "sms", body: "Oh yeah yes, sorry.", ...extra }),
}));

describe("GET /api/ghl/numbers", () => {
  it("lists every account's text numbers, named, with no tokens", async () => {
    const res = await GET(new NextRequest("http://localhost/api/ghl/numbers", { headers: { authorization: "Bearer x" } }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.accounts.map((a: { name: string }) => a.name)).toEqual(["ClickUpLocal", "ClickUpLocal Directory"]);
    expect(j.numbers).toEqual([
      { number: "+15305550101", label: null, locationId: "loc_agency", locationName: "ClickUpLocal", isDefault: true },
      { number: "+15303620990", label: null, locationId: "loc_directory", locationName: "ClickUpLocal Directory", isDefault: true },
      { number: "+15303620991", label: "Derek's line", locationId: "loc_directory", locationName: "ClickUpLocal Directory", isDefault: false },
    ]);
    expect(JSON.stringify(j)).not.toContain("tok_");
  });
  it("is for the team only", async () => {
    caller = null;
    expect((await GET(new NextRequest("http://localhost/api/ghl/numbers"))).status).toBe(401);
  });
});

describe("POST /api/ghl/message, a text", () => {
  it("goes from the number Jeannie was last texted from, with her account's token", async () => {
    const res = await sendText();
    expect(res.status).toBe(200);
    expect((await res.json()).ourNumber).toBe("+15303620991");
    expect(sent).toHaveLength(1);
    expect(sent[0].auth).toBe("Bearer tok_directory");
    expect(sent[0].body).toMatchObject({ type: "SMS", contactId: "ghl_jeannie", fromNumber: "+15303620991" });
  });

  it("goes from the number picked", async () => {
    await sendText({ fromNumber: "(530) 362 0990" });
    expect(sent[0].body.fromNumber).toBe("+15303620990");
    expect(sent[0].auth).toBe("Bearer tok_directory");
  });

  it("is refused from another account's number, and nothing is sent", async () => {
    const res = await sendText({ fromNumber: "+15305550101" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ClickUpLocal/);
    expect(sent).toHaveLength(0);
  });

  it("goes from the account's default with no number known", async () => {
    resetTables({ contacts: [{ id: "ct_jeannie", ghl_contact_id: "ghl_jeannie" }], clients: [], profiles: [], messages: [] });
    await sendText();
    expect(sent[0].body.fromNumber).toBe("+15303620990");
  });
});
