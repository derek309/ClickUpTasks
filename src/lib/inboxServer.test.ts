import { describe, it, expect, vi } from "vitest";

vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: {}, adminConfigured: true }));
vi.mock("./extensionApi", () => ({ isClientVisible: async () => false }));
const { parseThreadKey, canUseThread, peerOf, linkedTaskId, GHL_SEND_TYPE, escapeLike } = await import("./inboxServer");

const va = { id: "u1", memberId: "m_justin", email: "justin@clickuplocal.com", role: "va" as const, canSendMessages: true };

describe("Inbox conversations on the server", () => {
  it("reads only well formed keys", () => {
    expect(parseThreadKey("gm:18f2a")).toEqual({ kind: "gm", id: "18f2a" });
    expect(parseThreadKey("ghl:abc_123")).toEqual({ kind: "ghl", id: "abc_123" });
    expect(parseThreadKey("chat:t1")).toBeNull();
    expect(parseThreadKey("gm:a,b.or(x)")).toBeNull();
    expect(parseThreadKey(42)).toBeNull();
  });

  it("lets a teammate act on their own mailbox only", async () => {
    const mine = [{ mailbox_member_id: "m_justin" }];
    const derek = [{ mailbox_member_id: "m_derek" }];
    expect(await canUseThread(va, { kind: "gm", id: "t" }, mine)).toBe(true);
    expect(await canUseThread(va, { kind: "gm", id: "t" }, derek)).toBe(false);
  });

  it("keeps someone else's GoHighLevel conversation out, and shares an unassigned one", async () => {
    const ref = { kind: "ghl" as const, id: "c" };
    expect(await canUseThread(va, ref, [], { assigned_member_id: null })).toBe(true);
    expect(await canUseThread(va, ref, [], { assigned_member_id: "m_justin" })).toBe(true);
    expect(await canUseThread(va, ref, [], { assigned_member_id: "m_derek" })).toBe(false);
    expect(await canUseThread({ ...va, role: "admin" }, ref, [], { assigned_member_id: "m_derek" })).toBe(true);
  });

  it("finds the other person and the linked task from the rows", () => {
    const rows = [
      { direction: "outbound", peer_address: "dale@x.co", task_id: null },
      { direction: "inbound", peer_name: "Dale", peer_address: "dale@x.co", task_id: "t_quote", client_id: null },
    ];
    expect(peerOf(rows)).toEqual({ contactId: null, clientId: null, name: "Dale", address: "dale@x.co" });
    expect(linkedTaskId(rows)).toBe("t_quote");
    expect(peerOf([], { contact_name: "Kris", phone: "+15415550142" }).address).toBe("+15415550142");
  });

  it("answers a missed call by text", () => {
    expect(GHL_SEND_TYPE.call).toBe("SMS");
    expect(GHL_SEND_TYPE.fb).toBe("FB");
  });

  it("treats % and _ in an address as letters, not wildcards", () => {
    expect(escapeLike("a_b%c@x.com")).toBe("a\\_b\\%c@x.com");
    expect(escapeLike("pam@kp.org")).toBe("pam@kp.org");
  });
});
