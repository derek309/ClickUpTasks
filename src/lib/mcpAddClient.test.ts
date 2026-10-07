// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/core.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// add_client and update_task contact_id (Derek, 2026-10-07: "the task belongs
// to Russell, so if he doesn't have a contact, create the contact, move it
// over"). Supabase and GoHighLevel are faked by URL fragment; these check what
// is written.

const ME = "u_derek";
const RUSS = "ct_ghl_russ", WLG = "cl_ct_ghl_wlg";
let writes: { method: string; url: string; body: any }[] = [];
function fake(routes: [string, unknown][]) {
  writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = decodeURIComponent(String(url));
    const method = init?.method ?? "GET";
    if (method !== "GET") writes.push({ method, url: u, body: init?.body ? JSON.parse(init.body) : null });
    // "PATCH messages?" matches only that method; a bare fragment any method.
    const hit = routes.find(([frag]) => { const m = frag.match(/^(GET|POST|PATCH) (.*)$/); return m ? m[1] === method && u.includes(m[2]) : u.includes(frag); });
    const rows = hit ? hit[1] : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(rows), json: async () => rows } as any;
  }));
}
async function connect() {
  const server = createServer({ url: "https://db.invalid", key: "test", memberId: ME });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const call = async (c: Client, name: string, args: Record<string, unknown>) => ((await c.callTool({ name, arguments: args })) as any).content[0].text as string;
const russell = { id: RUSS, name: "Russell Lathrop", email: "russell@whitmanlandgroup.com", client_id: "c_agency" };
const patchTo = (frag: string) => writes.find((w) => w.method === "PATCH" && w.url.includes(frag))?.body;
afterEach(() => vi.unstubAllGlobals());

describe("add_client", () => {
  it("brings back a deleted client, unlinks them from the company, and moves their emails", async () => {
    fake([
      ["contacts?select", [russell]],
      [`clients?select=id,name,deleted_at&id=eq.cl_${RUSS}`, [{ id: `cl_${RUSS}`, name: "Russell Lathrop", deleted_at: "2026-10-07T13:50:00Z" }]],
      ["linked_contact_ids=cs.", [{ id: WLG, name: "Whitman Land Group", linked_contact_ids: [RUSS, "ct_other"] }]],
      ["PATCH messages?", [{ id: "m1" }, { id: "m2" }]],
    ]);
    const text = await call(await connect(), "add_client", { email: "Russell@WhitmanLandGroup.com" });
    expect(patchTo(`clients?id=eq.cl_${RUSS}`)).toMatchObject({ deleted_at: null });
    expect(patchTo(`clients?id=eq.${WLG}`)).toMatchObject({ linked_contact_ids: ["ct_other"] });
    expect(patchTo(`contacts?id=eq.${RUSS}`)).toEqual({ client_id: `cl_${RUSS}` });
    expect(patchTo("messages?")).toEqual({ client_id: `cl_${RUSS}` });
    expect(text).toContain("brought back their deleted client");
    expect(text).toContain("unlinked from Whitman Land Group");
    expect(text).toContain("2 emails moved");
    expect(writes.some((w) => w.method === "POST" && w.url.endsWith("/clients"))).toBe(false);
  });

  it("creates the client when there is none, and leaves emails alone with move_emails false", async () => {
    fake([["contacts?select", [russell]]]);
    await call(await connect(), "add_client", { contact_id: RUSS, move_emails: false });
    const made = writes.find((w) => w.method === "POST" && w.url.endsWith("/rest/v1/clients"))?.body;
    expect(made).toMatchObject({ id: `cl_${RUSS}`, name: "Russell Lathrop", type: "client", assigned_to: [ME] });
    expect(writes.some((w) => w.url.includes("messages"))).toBe(false);
  });

  it("creates the contact in GoHighLevel when nobody has the email", async () => {
    fake([
      ["ghl_tokens", [{ token: "tok" }]],
      ["leadconnectorhq.com/contacts/", { contact: { id: "NEW1" } }],
    ]);
    const text = await call(await connect(), "add_client", { email: "new@x.com", name: "new person" });
    const ghl = writes.find((w) => w.url.includes("leadconnectorhq.com/contacts/"))?.body;
    expect(ghl).toMatchObject({ email: "new@x.com", firstName: "new", lastName: "person" });
    const ct = writes.find((w) => w.method === "POST" && w.url.includes("/contacts?on_conflict=id"))?.body;
    expect(ct).toMatchObject({ id: "ct_ghl_NEW1", client_id: "c_agency", ghl_contact_id: "NEW1" });
    expect(writes.find((w) => w.method === "POST" && w.url.endsWith("/rest/v1/clients"))?.body).toMatchObject({ id: "cl_ct_ghl_NEW1", name: "New Person" });
    expect(text).toContain("created contact");
  });

  it("asks for a name before creating anyone", async () => {
    fake([]);
    expect(await call(await connect(), "add_client", { email: "nobody@x.com" })).toContain("Pass name");
    expect(writes).toHaveLength(0);
  });
});

describe("update_task contact_id", () => {
  const task = { id: "t_1", status: "todo", follow_up_at: null, client_id: WLG, project_id: "p_w", ghl_task_id: null, deleted_at: null, is_private: false };
  it("sets a person linked to the task's client", async () => {
    fake([["tasks?select", [task]], [`clients?select=name,linked_contact_id,linked_contact_ids&id=eq.${WLG}`, [{ name: "Whitman Land Group", linked_contact_id: null, linked_contact_ids: [RUSS] }]], ["PATCH tasks?", [task]]]);
    await call(await connect(), "update_task", { id: "t_1", contact_id: RUSS });
    expect(patchTo("tasks?id=eq.t_1")).toMatchObject({ contact_id: RUSS });
  });
  it("refuses someone who isn't the client's, changing nothing", async () => {
    fake([["tasks?select", [task]], [`clients?select=name,linked_contact_id,linked_contact_ids&id=eq.${WLG}`, [{ name: "Whitman Land Group", linked_contact_id: null, linked_contact_ids: [] }]]]);
    expect(await call(await connect(), "update_task", { id: "t_1", contact_id: "ct_ghl_stranger" })).toContain("add_client");
    expect(writes).toHaveLength(0);
  });
});
